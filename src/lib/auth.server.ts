import { randomBytes, scrypt as _scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { getCookie, getRequestHeader, setCookie, deleteCookie } from "@tanstack/react-start/server";

import {
  createSession,
  deleteSession,
  findSession,
  findUserById,
  type User,
  type UserRole,
} from "./db.server";

// --------------------------------------------------------------------------
// Authentication. Server-only.
//
// Password hashing uses scrypt from node:crypto rather than bcrypt/argon2
// specifically to keep this project free of native dependencies (the whole
// backend is designed to run with a plain `npm i`). scrypt is memory-hard
// and a perfectly sound choice here.
//
// Sessions are opaque random tokens stored in the database and sent to the
// browser in an HTTP-only, SameSite=Lax cookie. Storing them server-side
// (rather than using a signed/sealed cookie) means sessions can actually be
// revoked — changing a password drops every other session immediately.
// --------------------------------------------------------------------------

const scrypt = promisify(_scrypt) as (
  password: string,
  salt: string,
  keylen: number,
) => Promise<Buffer>;

const KEY_LENGTH = 64;
export const SESSION_COOKIE = "dbn_session";
const SESSION_DAYS = 30;

export async function hashPassword(
  password: string,
): Promise<{ hash: string; salt: string }> {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, KEY_LENGTH);
  return { hash: derived.toString("hex"), salt };
}

export async function verifyPassword(
  password: string,
  hash: string,
  salt: string,
): Promise<boolean> {
  const derived = await scrypt(password, salt, KEY_LENGTH);
  const stored = Buffer.from(hash, "hex");
  // Length check first: timingSafeEqual throws on a length mismatch.
  if (stored.length !== derived.length) return false;
  return timingSafeEqual(stored, derived);
}

/** Minimum viable password policy. Surfaced to the user on signup/change. */
export function validatePasswordStrength(password: string): string | null {
  if (password.length < 10) return "Use at least 10 characters.";
  if (password.length > 200) return "That password is too long.";
  if (!/[a-zA-Z]/.test(password)) return "Include at least one letter.";
  if (!/[0-9]/.test(password)) return "Include at least one number.";
  return null;
}

// ---------------------------- Sessions --------------------------------

export async function startSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString();

  await createSession({
    token,
    userId,
    expiresAt,
    userAgent: getRequestHeader("user-agent")?.slice(0, 200),
  });

  setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    // Secure cookies are dropped by the browser over plain http, which would
    // break local development. Enable it everywhere except dev.
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DAYS * 86_400,
  });
}

export async function endSession(): Promise<void> {
  const token = getCookie(SESSION_COOKIE);
  if (token) await deleteSession(token);
  deleteCookie(SESSION_COOKIE, { path: "/" });
}

/** The signed-in user, or null. Never throws — use for optional auth. */
export async function getCurrentUser(): Promise<User | null> {
  const token = getCookie(SESSION_COOKIE);
  if (!token) return null;

  const session = await findSession(token);
  if (!session) return null;

  const user = await findUserById(session.userId);
  return user ?? null;
}

/**
 * The signed-in user, or throw. Every admin server function starts with
 * this — it is the single choke point for admin authorization.
 */
export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) throw new Error("UNAUTHORIZED");
  return user;
}

export async function requireRole(role: UserRole): Promise<User> {
  const user = await requireUser();
  // "owner" outranks "staff"; anything else must match exactly.
  if (user.role !== role && user.role !== "owner") throw new Error("FORBIDDEN");
  return user;
}

/** Strip secrets before a user object crosses to the client. */
export function toPublicUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
    // Just the id — the image itself is fetched separately so a session
    // check doesn't have to carry a base64 payload on every request.
    avatarPhotoId: user.avatarPhotoId,
  };
}

export type PublicUser = ReturnType<typeof toPublicUser>;

// ------------------------- Login throttling ---------------------------
//
// In-process, per-IP+email failure counter. Not a substitute for a real
// rate limiter behind a proxy, but it stops trivial online guessing on a
// single-instance deploy. Resets on restart, which is acceptable here.

const attempts = new Map<string, { count: number; first: number }>();
const WINDOW_MS = 15 * 60_000;
const MAX_ATTEMPTS = 8;

export function checkLoginThrottle(key: string): number | null {
  const entry = attempts.get(key);
  if (!entry) return null;
  if (Date.now() - entry.first > WINDOW_MS) {
    attempts.delete(key);
    return null;
  }
  if (entry.count >= MAX_ATTEMPTS) {
    return Math.ceil((WINDOW_MS - (Date.now() - entry.first)) / 60_000);
  }
  return null;
}

export function recordLoginFailure(key: string): void {
  const entry = attempts.get(key);
  if (!entry || Date.now() - entry.first > WINDOW_MS) {
    attempts.set(key, { count: 1, first: Date.now() });
  } else {
    entry.count += 1;
  }
}

export function clearLoginFailures(key: string): void {
  attempts.delete(key);
}
