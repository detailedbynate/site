import { createCipheriv, createECDH, createHmac, createPrivateKey, randomBytes, sign, type ECDH } from "node:crypto";

import type { Booking } from "./db.server";

// --------------------------------------------------------------------------
// Server-only. Phone notifications for the shop owner via the Web Push
// standard — what an iPhone (iOS 16.4+, admin added to the Home Screen),
// Android and desktop browsers all speak.
//
// Implemented on node:crypto rather than the `web-push` package, for the same
// reason as Stripe-over-fetch: the protocol is two short RFCs, and this repo
// carries both an npm and a bun lockfile, so a new dependency is a second
// lockfile that has to be kept in step or the deploy breaks.
//
//   RFC 8291  message encryption (aes128gcm): only the device can read it
//   RFC 8292  VAPID: proves to Apple/Google that the message is from us
//
// Every send is fire-and-forget. A push service being slow or down must never
// hold up, let alone fail, the booking that triggered it.
// --------------------------------------------------------------------------

const b64url = (buf: Buffer | Uint8Array) => Buffer.from(buf).toString("base64url");
const unb64url = (s: string) => Buffer.from(s, "base64url");

/**
 * Push services we will POST to. The endpoint comes from the browser, so
 * without this an admin session could make the server request any URL.
 */
const PUSH_HOSTS = [
  /(^|\.)push\.apple\.com$/,
  /^fcm\.googleapis\.com$/,
  /^android\.googleapis\.com$/,
  /(^|\.)push\.services\.mozilla\.com$/,
  /(^|\.)notify\.windows\.com$/,
];

export function isAllowedEndpoint(endpoint: string): boolean {
  try {
    const u = new URL(endpoint);
    return u.protocol === "https:" && PUSH_HOSTS.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
}

/** The server's VAPID key pair, created once and kept in the database. */
export async function vapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  const { getPushKeys, savePushKeysIfAbsent } = await import("./db.server");
  const existing = await getPushKeys();
  if (existing) return existing;
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  await savePushKeysIfAbsent({
    publicKey: b64url(ecdh.getPublicKey()), // 65-byte uncompressed point
    privateKey: b64url(ecdh.getPrivateKey()),
  });
  return (await getPushKeys())!;
}

/** A signed VAPID token for one push service origin, valid 12 hours. */
export function vapidAuthorization(endpoint: string, keys: { publicKey: string; privateKey: string }, subject: string) {
  const pub = unb64url(keys.publicKey);
  // ECDH.getPrivateKey() drops leading zero bytes, so ~1 key in 256 comes back
  // 31 bytes long — and a P-256 JWK refuses anything but 32, which would fail
  // every send forever (the key is stored once). Pad it, as web-push does.
  // Padding at use, not just at generation, also repairs a key already saved.
  let d = unb64url(keys.privateKey);
  if (d.length < 32) d = Buffer.concat([Buffer.alloc(32 - d.length), d]);
  const key = createPrivateKey({
    key: {
      kty: "EC",
      crv: "P-256",
      d: b64url(d),
      x: b64url(pub.subarray(1, 33)),
      y: b64url(pub.subarray(33, 65)),
    },
    format: "jwk",
  });
  const header = b64url(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64url(
    Buffer.from(
      JSON.stringify({
        aud: new URL(endpoint).origin,
        exp: Math.floor(Date.now() / 1000) + 12 * 3600,
        sub: subject,
      }),
    ),
  );
  // JWS wants the raw r||s signature, not DER — hence ieee-p1363.
  const signature = sign("sha256", Buffer.from(`${header}.${claims}`), { key, dsaEncoding: "ieee-p1363" });
  return `vapid t=${header}.${claims}.${b64url(signature)}, k=${keys.publicKey}`;
}

const hmac = (key: Buffer, data: Buffer) => createHmac("sha256", key).update(data).digest();

/**
 * Encrypt a payload for one device (RFC 8291, aes128gcm, single record).
 * Exported so the round trip can be tested against an independent decoder.
 */
export function encryptPayload(
  plaintext: Buffer,
  p256dh: string,
  auth: string,
  // Injectable only for tests; production always uses a fresh key and salt.
  ephemeral?: ECDH,
  salt: Buffer = randomBytes(16),
): Buffer {
  const uaPublic = unb64url(p256dh);
  const authSecret = unb64url(auth);
  const as = ephemeral ?? createECDH("prime256v1");
  if (!ephemeral) as.generateKeys();
  const asPublic = as.getPublicKey();
  const ecdhSecret = as.computeSecret(uaPublic);

  // IKM = HKDF(auth_secret, ecdh_secret, "WebPush: info" || 0 || ua || as, 32)
  const prkKey = hmac(authSecret, ecdhSecret);
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic, Buffer.from([1])]);
  const ikm = hmac(prkKey, keyInfo);

  // CEK and nonce from HKDF(salt, IKM)
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.concat([Buffer.from("Content-Encoding: aes128gcm\0"), Buffer.from([1])])).subarray(0, 16);
  const nonce = hmac(prk, Buffer.concat([Buffer.from("Content-Encoding: nonce\0"), Buffer.from([1])])).subarray(0, 12);

  // One record: the payload, then the 0x02 "last record" delimiter.
  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([plaintext, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);

  // Header: salt(16) | record size(4) | key id length(1) | key id (our public key)
  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, body]);
}

export interface PushMessage {
  title: string;
  body: string;
  /** Where tapping the notification lands, e.g. /admin/calendar?date=… */
  url: string;
  /** Same tag replaces rather than stacks (e.g. one booking's updates). */
  tag?: string;
}

type Target = { endpoint: string; p256dh: string; auth: string };

export type Delivery = { result: "ok" | "gone" | "failed"; detail: string };

/**
 * Deliver to one device. "gone" means the push service says the subscription
 * no longer exists (app removed, permission revoked) so the caller can forget
 * it. `detail` carries the push service's own reason on failure — Apple
 * answers e.g. 403 {"reason":"BadJwtToken"} — which used to go only to the
 * server log, so a failure looked exactly like nothing happening.
 */
async function deliver(target: Target, message: PushMessage, subject: string): Promise<Delivery> {
  if (!isAllowedEndpoint(target.endpoint)) return { result: "gone", detail: "Unsupported push service" };
  try {
    // Inside the try: a malformed device key or signing problem is reported
    // as this device's error, not thrown past the caller.
    const keys = await vapidKeys();
    const body = encryptPayload(Buffer.from(JSON.stringify(message)), target.p256dh, target.auth);
    const res = await fetch(target.endpoint, {
      method: "POST",
      headers: {
        Authorization: vapidAuthorization(target.endpoint, keys, subject),
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        TTL: String(24 * 3600),
        Urgency: "high",
      },
      body: new Uint8Array(body),
      signal: AbortSignal.timeout(8000),
    });
    const text = res.ok ? "" : (await res.text().catch(() => "")).trim().slice(0, 200);
    if (res.status === 404 || res.status === 410) return { result: "gone", detail: `${res.status} ${text}`.trim() };
    if (!res.ok) {
      console.error("Push rejected:", res.status, text);
      return { result: "failed", detail: `${res.status} ${text || res.statusText}`.trim() };
    }
    return { result: "ok", detail: String(res.status) };
  } catch (err) {
    console.error("Push failed:", err);
    return { result: "failed", detail: err instanceof Error ? err.message : "Network error" };
  }
}

async function subjectFor(): Promise<string> {
  const { getSettings } = await import("./db.server");
  const s = await getSettings();
  // Apple rejects VAPID tokens without a usable contact — and a mailto with
  // stray whitespace, and localhost URLs. A trimmed mailto is always accepted.
  const email = (s.contactEmail || "").trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return `mailto:${email}`;
  const site = (s.siteUrl || "").trim();
  if (/^https:\/\/[^/]+/.test(site) && !/localhost|127\.0\.0\.1/.test(site)) return site.replace(/\/+$/, "");
  return "mailto:owner@detailedbynate.com";
}

/** Record how a delivery went against the device, forgetting gone ones. */
async function settle(endpoint: string, d: Delivery): Promise<void> {
  const { deletePushSubscription, markPushDelivered, markPushFailed } = await import("./db.server");
  if (d.result === "ok") await markPushDelivered(endpoint);
  else if (d.result === "gone") await deletePushSubscription(endpoint);
  else await markPushFailed(endpoint, d.detail);
}

/** Send to every registered device; forget the ones that are gone. */
export async function sendToAll(message: PushMessage): Promise<{ sent: number; failed: number }> {
  const { listPushSubscriptions } = await import("./db.server");
  const subs = await listPushSubscriptions();
  if (!subs.length) return { sent: 0, failed: 0 };
  const subject = await subjectFor();
  const results = await Promise.all(subs.map((s) => deliver(s, message, subject)));
  await Promise.all(results.map((d, i) => settle(subs[i]!.endpoint, d)));
  return {
    sent: results.filter((d) => d.result === "ok").length,
    failed: results.filter((d) => d.result === "failed").length,
  };
}

export async function sendToOne(target: Target, message: PushMessage): Promise<Delivery> {
  const d = await deliver(target, message, await subjectFor());
  await settle(target.endpoint, d);
  return d;
}

export type PushEvent = "booking_created" | "booking_cancelled" | "booking_rescheduled";
/** Who caused it. Your own changes in the admin only notify if you opted in. */
export type PushSource = "customer" | "admin";

/**
 * Tell the owner's phone about a booking event, if they asked for that kind.
 * Never throws — callers fire this and move on.
 */
export async function notifyOwner(
  event: PushEvent,
  booking: Booking,
  source: PushSource = "customer",
): Promise<void> {
  try {
    const { getSettings, findClientById } = await import("./db.server");
    const settings = await getSettings();
    const events = settings.pushEvents ?? [];
    if (!events.includes(event)) return;
    if (source === "admin" && !events.includes("own_changes")) return;

    const client = booking.clientId ? await findClientById(booking.clientId) : undefined;
    const name = client?.name ?? "A customer";
    const when = new Date(`${booking.date}T12:00:00`).toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
    const [h, m] = booking.startTime.split(":").map(Number);
    const time = `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
    const price = booking.totalPrice ? ` · $${booking.totalPrice - (booking.discount ?? 0)}` : "";

    const title =
      event === "booking_created"
        ? `New booking · ${booking.serviceTitle}`
        : event === "booking_cancelled"
          ? `Cancelled · ${booking.serviceTitle}`
          : `Rescheduled · ${booking.serviceTitle}`;
    const body =
      event === "booking_rescheduled"
        ? `${name} moved to ${when}, ${time}`
        : `${name} · ${when}, ${time}${event === "booking_created" ? price : ""}`;

    await sendToAll({
      title,
      body,
      url: `/admin/calendar?date=${booking.date}`,
      tag: `booking-${booking.id}`,
    });
  } catch (err) {
    console.error("Phone notification failed:", err);
  }
}
