import process from "node:process";

// Server-only config. The .server.ts suffix prevents Vite from bundling
// this file into the client — values here never reach the browser.
//
// On Cloudflare Workers, env binds at REQUEST time. Module-scope reads
// (e.g. `const x = process.env.X`) resolve to undefined — always read
// process.env INSIDE a function or handler.
//
// When to use which env-access pattern:
//   - .server.ts module (this file): server-only helpers reused across
//     handlers. Wrap reads in a function so they run per-request.
//   - inline process.env inside a createServerFn handler: one-off reads
//     not reused elsewhere.
//   - import.meta.env.VITE_FOO: PUBLIC config readable from both client
//     and server (analytics IDs, public URLs). Define in .env with the
//     VITE_ prefix. Never put secrets here — they ship to the browser.

export function getServerConfig() {
  return {
    nodeEnv: process.env.NODE_ENV,
    // Add server-only values here, e.g.:
    //   databaseUrl: process.env.DATABASE_URL,
    //   stripeSecretKey: process.env.STRIPE_SECRET_KEY,

    // --- Google Calendar (OAuth2, offline/refresh-token flow) ---
    googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    googleRefreshToken: process.env.GOOGLE_REFRESH_TOKEN ?? "",
    googleCalendarId: process.env.GOOGLE_CALENDAR_ID ?? "primary",

    // NOTE: business hours, lead time, closed days and the booking window
    // used to live here. They now live in the database and are edited at
    // /admin/settings — the BUSINESS_* / BOOKING_* env vars only seed the
    // defaults on first run (see DEFAULT_SETTINGS in db.server.ts).
    //
    // ADMIN_PASSWORD is also gone: /admin is behind real accounts now
    // (hashed passwords + server-side sessions, see auth.server.ts).
  };
}

export function isGoogleCalendarConfigured(): boolean {
  const c = getServerConfig();
  return Boolean(c.googleClientId && c.googleClientSecret && c.googleRefreshToken);
}
