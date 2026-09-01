import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// Everything server-only is imported *inside* the handlers so it is
// tree-shaken out of the client bundle. See booking.functions.ts for the same pattern on the public side.

const emailSchema = z.string().email().max(255);

/**
 * Is there an owner account yet? Drives the first-run setup screen so the
 * very first visitor to /login is asked to create the account rather than
 * being locked out. Returns only a boolean — no user data.
 */
export const getAuthStatus = createServerFn({ method: "GET" }).handler(async () => {
  const { countUsers } = await import("../db.server");
  const { getCurrentUser, toPublicUser } = await import("../auth.server");

  const [total, user] = await Promise.all([countUsers(), getCurrentUser()]);
  return {
    needsSetup: total === 0,
    user: user ? toPublicUser(user) : null,
  };
});

/** Who am I? Used by the admin layout to guard every page. */
export const getMe = createServerFn({ method: "GET" }).handler(async () => {
  const { getCurrentUser, toPublicUser } = await import("../auth.server");
  const user = await getCurrentUser();
  return { user: user ? toPublicUser(user) : null };
});

/**
 * Create the first owner account. Only works while zero users exist, so
 * this can't be used to add accounts later — that's addUser() below, which
 * requires an authenticated owner.
 */
export const setupOwner = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      name: z.string().min(2).max(80),
      email: emailSchema,
      password: z.string().min(1).max(200),
    }),
  )
  .handler(async ({ data }) => {
    const { countUsers, createUser } = await import("../db.server");
    const { hashPassword, validatePasswordStrength, startSession, toPublicUser } = await import(
      "../auth.server"
    );

    if ((await countUsers()) > 0) {
      throw new Error("Setup has already been completed. Sign in instead.");
    }

    const weak = validatePasswordStrength(data.password);
    if (weak) throw new Error(weak);

    const { hash, salt } = await hashPassword(data.password);
    const user = await createUser({
      email: data.email,
      name: data.name,
      role: "owner",
      passwordHash: hash,
      passwordSalt: salt,
    });

    await startSession(user.id);
    return { user: toPublicUser(user) };
  });

export const login = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      email: emailSchema,
      password: z.string().min(1).max(200),
    }),
  )
  .handler(async ({ data }) => {
    const { findUserByEmail, touchUserLogin } = await import("../db.server");
    const {
      verifyPassword,
      startSession,
      toPublicUser,
      checkLoginThrottle,
      recordLoginFailure,
      clearLoginFailures,
    } = await import("../auth.server");
    const { getRequestIP } = await import("@tanstack/react-start/server");

    const key = `${getRequestIP({ xForwardedFor: true }) ?? "local"}:${data.email.toLowerCase()}`;
    const blockedFor = checkLoginThrottle(key);
    if (blockedFor !== null) {
      throw new Error(`Too many attempts. Try again in ${blockedFor} minute(s).`);
    }

    const user = await findUserByEmail(data.email);
    // Deliberately identical message whether the email or the password is
    // wrong, so this can't be used to enumerate accounts.
    const generic = "That email and password don't match.";

    if (!user) {
      recordLoginFailure(key);
      throw new Error(generic);
    }

    const ok = await verifyPassword(data.password, user.passwordHash, user.passwordSalt);
    if (!ok) {
      recordLoginFailure(key);
      throw new Error(generic);
    }

    clearLoginFailures(key);
    await startSession(user.id);
    await touchUserLogin(user.id);
    return { user: toPublicUser(user) };
  });

export const logout = createServerFn({ method: "POST" }).handler(async () => {
  const { endSession } = await import("../auth.server");
  await endSession();
  return { ok: true };
});

export const changePassword = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      currentPassword: z.string().min(1).max(200),
      newPassword: z.string().min(1).max(200),
    }),
  )
  .handler(async ({ data }) => {
    const { updateUserPassword } = await import("../db.server");
    const {
      requireUser,
      verifyPassword,
      hashPassword,
      validatePasswordStrength,
      startSession,
    } = await import("../auth.server");

    const user = await requireUser();

    const ok = await verifyPassword(data.currentPassword, user.passwordHash, user.passwordSalt);
    if (!ok) throw new Error("Your current password is incorrect.");

    const weak = validatePasswordStrength(data.newPassword);
    if (weak) throw new Error(weak);

    const { hash, salt } = await hashPassword(data.newPassword);
    // This drops every session for the user, including this one...
    await updateUserPassword(user.id, hash, salt);
    // ...so immediately issue a fresh one to keep them signed in here.
    await startSession(user.id);

    return { ok: true };
  });

export const updateProfile = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      name: z.string().min(2).max(80),
      email: emailSchema,
    }),
  )
  .handler(async ({ data }) => {
    const { updateUserProfile } = await import("../db.server");
    const { requireUser, toPublicUser } = await import("../auth.server");

    const user = await requireUser();
    const updated = await updateUserProfile(user.id, data);
    if (!updated) throw new Error("Account not found.");
    return { user: toPublicUser(updated) };
  });

/** Team management — owner only. */
export const listTeam = createServerFn({ method: "GET" }).handler(async () => {
  const { listUsers } = await import("../db.server");
  const { requireRole, toPublicUser } = await import("../auth.server");

  await requireRole("owner");
  return { users: (await listUsers()).map(toPublicUser) };
});

export const addUser = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      name: z.string().min(2).max(80),
      email: emailSchema,
      password: z.string().min(1).max(200),
      role: z.enum(["owner", "staff"]),
    }),
  )
  .handler(async ({ data }) => {
    const { createUser } = await import("../db.server");
    const { requireRole, hashPassword, validatePasswordStrength, toPublicUser } = await import(
      "../auth.server"
    );

    await requireRole("owner");

    const weak = validatePasswordStrength(data.password);
    if (weak) throw new Error(weak);

    const { hash, salt } = await hashPassword(data.password);
    const user = await createUser({
      email: data.email,
      name: data.name,
      role: data.role,
      passwordHash: hash,
      passwordSalt: salt,
    });
    return { user: toPublicUser(user) };
  });

export const setUserRole = createServerFn({ method: "POST" })
  .inputValidator(z.object({ userId: z.string().min(1), role: z.enum(["owner", "staff"]) }))
  .handler(async ({ data }) => {
    const { updateUserRole } = await import("../db.server");
    const { requireRole, toPublicUser } = await import("../auth.server");

    await requireRole("owner");
    const user = await updateUserRole(data.userId, data.role);
    if (!user) throw new Error("Account not found.");
    return { user: toPublicUser(user) };
  });

export const removeUser = createServerFn({ method: "POST" })
  .inputValidator(z.object({ userId: z.string().min(1) }))
  .handler(async ({ data }) => {
    const { deleteUser } = await import("../db.server");
    const { requireRole } = await import("../auth.server");

    const me = await requireRole("owner");
    // Removing yourself would drop your own session mid-request.
    if (me.id === data.userId) throw new Error("You can't remove your own account.");
    await deleteUser(data.userId);
    return { ok: true };
  });

/** Owner-initiated password reset for a teammate who's locked out. */
export const resetUserPassword = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({ userId: z.string().min(1), newPassword: z.string().min(1).max(200) }),
  )
  .handler(async ({ data }) => {
    const { adminSetUserPassword } = await import("../db.server");
    const { requireRole, hashPassword, validatePasswordStrength } = await import("../auth.server");

    await requireRole("owner");
    const weak = validatePasswordStrength(data.newPassword);
    if (weak) throw new Error(weak);

    const { hash, salt } = await hashPassword(data.newPassword);
    await adminSetUserPassword(data.userId, hash, salt);
    return { ok: true };
  });
