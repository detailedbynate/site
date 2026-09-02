import { getRequestHeader } from "@tanstack/react-start/server";

// --------------------------------------------------------------------------
// Rate limiting for the PUBLIC endpoints.
//
// Login has had its own failure throttle since auth was built. Everything a
// stranger can reach without signing in had nothing, which left two real
// holes:
//
//   - Coupon codes could be enumerated. checkCoupon answers "that code isn't
//     valid" or gives a discount, so a script can work through candidate
//     codes as fast as the server will answer and find every live one.
//   - Bookings could be spammed. Each one writes a row, fires a confirmation
//     email, and creates a Google Calendar event — so a loop costs the shop
//     real money and fills a real calendar.
//
// In-process and per-IP, matching the login throttle. It resets on restart
// and does not span instances, which is honest for a single-container
// deploy; a proxy-level limit is still the right thing in front of a real
// domain. This stops a script, not a determined attacker with addresses to
// spare.
// --------------------------------------------------------------------------

type Bucket = { count: number; first: number };

const buckets = new Map<string, Bucket>();

/** Drop expired buckets so a long-running process doesn't grow unbounded. */
function sweep(now: number) {
  if (buckets.size < 5000) return;
  for (const [key, b] of buckets) {
    if (now - b.first > 60 * 60_000) buckets.delete(key);
  }
}

/**
 * The caller's IP, as far as we can tell.
 *
 * Behind Railway's proxy the socket address is the proxy, so the forwarded
 * header is what identifies the caller. It is trivially spoofable by anyone
 * talking to the origin directly — which is exactly why this is a speed bump
 * and not a security control.
 */
export function callerKey(): string {
  const forwarded = getRequestHeader("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return getRequestHeader("x-real-ip") ?? "unknown";
}

/**
 * Allow this action, or throw with a plain-English wait.
 *
 * `name` scopes the bucket, so using up the coupon allowance doesn't also
 * block booking.
 */
export function rateLimit(
  name: string,
  opts: { max: number; windowMs: number; message?: string },
): void {
  const now = Date.now();
  sweep(now);

  const key = `${name}:${callerKey()}`;
  const bucket = buckets.get(key);

  if (!bucket || now - bucket.first > opts.windowMs) {
    buckets.set(key, { count: 1, first: now });
    return;
  }

  bucket.count += 1;
  if (bucket.count > opts.max) {
    const mins = Math.max(1, Math.ceil((opts.windowMs - (now - bucket.first)) / 60_000));
    throw new Error(
      opts.message ?? `Too many attempts. Please try again in ${mins} minute${mins === 1 ? "" : "s"}.`,
    );
  }
}

/** Forget one caller's bucket — used after a booking genuinely succeeds. */
export function clearRateLimit(name: string): void {
  buckets.delete(`${name}:${callerKey()}`);
}
