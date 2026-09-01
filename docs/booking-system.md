# Booking system, Google Calendar & admin backend

Detailed reference for the backend built on top of the Lovable-exported site. See `CLAUDE.md` for the high-level summary and file map — this doc goes deeper on setup and the specific mechanics.

## Setup, step by step

### 1. Install and configure

```sh
npm i
cp .env.example .env
```

### 2. Google Calendar

1. [Google Cloud Console](https://console.cloud.google.com/) → create/select a project.
2. **APIs & Services → Library** → enable **Google Calendar API**.
3. **APIs & Services → Credentials → Create Credentials → OAuth client ID** → type **Desktop app**. Copy Client ID + Secret into `.env` (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`).
4. Configure the OAuth consent screen if prompted (External is fine, "Testing" mode is fine — just add the business's own Google account as a test user).
5. Run:
   ```sh
   node scripts/get-google-refresh-token.mjs
   ```
   Opens a URL → sign in with the Google account whose calendar should be booked against → approve → script prints `GOOGLE_REFRESH_TOKEN=...` → paste into `.env`.
6. Set `GOOGLE_CALENDAR_ID` (`primary`, or a specific calendar's ID from Calendar settings → Integrate calendar).

**The app works before this is done** — `isGoogleCalendarConfigured()` (in `config.server.ts`) gates every Calendar call; if unset, availability treats the whole business day as open and booking creation just skips event creation. This was intentional so the booking flow is testable in isolation.

### 3. Business rules

In `.env`:
- `BUSINESS_TIMEZONE` (IANA name, e.g. `America/Toronto`)
- `BUSINESS_OPEN_HOUR`, `BUSINESS_CLOSE_HOUR` (24h, integers)
- `SLOT_INCREMENT_MINUTES` (how often a bookable slot starts, e.g. every 30 min)
- `ADMIN_PASSWORD` (gates `/admin`)

## How availability is computed

`src/lib/availability.server.ts` → `getAvailableSlots(date, durationMinutes)`:

1. Convert business open/close hours for `date` into UTC ISO instants (`zonedTimeToISO`).
2. Fetch Google's busy intervals for that day (`getBusyIntervals`, no-op if unconfigured) **and** local bookings for that date (`listBookingsForDate`) in parallel.
3. Walk every `SLOT_INCREMENT_MINUTES`-spaced start time between open/close; a slot survives if `[start, start+duration)` doesn't overlap any busy range from either source.
4. If the date is today, drop slots already in the past.

`zonedTimeToISO` / `minutesFromZonedISO` do timezone math via `Intl.DateTimeFormat` offset round-tripping rather than a tz library — read the inline comments in `availability.server.ts` before modifying; it's correct but easy to break by "simplifying."

## Booking flow

`src/components/BookingWidget.tsx` (client) → `src/lib/api/booking.functions.ts` (server):

1. User picks a service (`SERVICES` from `src/lib/services.ts`) and a date → `getAvailability` server fn is called (re-fires on every date/service change via `useEffect`).
2. User picks a slot, fills contact form, submits → `createBooking` server fn:
   - **Re-checks availability** right before booking (closes the race where two people grab the same slot within seconds of each other) — if the slot's gone, returns an error and the widget refetches slots.
   - `findOrCreateClient` — upserts by email.
   - `createCalendarEvent` — best-effort; failures are caught and logged, **do not** fail the booking (the shop still gets it locally and can add to Calendar by hand).
   - `addBooking` — persists locally, storing the Google event ID (if any) for later cancellation.

## Admin backend

`src/routes/admin.tsx` + `src/lib/api/admin.functions.ts`.

- Password stored in `localStorage` client-side (key `dbn_admin_password`) and sent as a plain field on every admin server-fn call; checked against `ADMIN_PASSWORD` via `assertAdmin()`.
- **Bookings tab**: full list with client info, status badges, "Complete"/"Cancel" actions. Cancelling also deletes the linked Google Calendar event (`deleteCalendarEvent`, best-effort).
- **Clients tab**: full list + a manual-add form (for phone/walk-in bookings that didn't go through `/book`).

### Hardening before going live

Explicitly deferred scope, not oversights — flagged in code comments too:

- **Auth**: real now — scrypt-hashed passwords, server-side revocable sessions in an HTTP-only cookie, `requireUser()`/`requireRole()` at the top of every admin server function. The remaining gap is rate limiting at the proxy; the login throttle is in-process and resets on restart.
- **Rate limiting**: `createBooking` has no rate limit — add one before this is public, to prevent spam bookings / Calendar-quota exhaustion.
- **Verification**: consider requiring email verification or a deposit before a booking is considered fully confirmed.

## Data storage

`src/lib/db.server.ts` is a SQLite database at `data/app.db`, using **`node:sqlite`** — the engine bundled with Node (22.13+). No native modules to compile, no database server to run, and no extra dependency; the same reasoning that made auth use `scrypt` from `node:crypto` instead of bcrypt.

Why SQLite rather than the JSON file it replaced: the JSON store re-read and re-parsed the *entire* file on every single call, so computing availability across the 3-week booking window cost ~21 whole-file reads. Those are now index seeks on `bookings(date, status)`. It also brings real transactions (a failed multi-step write rolls back instead of leaving half-applied state) and a `UNIQUE` constraint on user email and booking reference, enforced by the database rather than by remembering to check first.

Writes are wrapped in `tx()`. `node:sqlite` is synchronous and Node is single-threaded, so nothing can interleave inside a transaction — which is why the old hand-rolled write-queue mutex is gone. Don't `await` inside `tx()`; that would break the guarantee.

**Migration is automatic.** On first start, an existing `data/store.json` is imported in one transaction, then renamed to `store.json.migrated` with a copy kept at `store.json.backup`. The import only runs into a database with no users, clients or bookings, so a stale export can never overwrite live data.

**This needs a persistent, writable disk.** Works on a VPS/Render/Railway/Fly.io (mount a volume at `data/`); **will not work** on Vercel/Cloudflare Pages, where the filesystem is ephemeral or read-only and both the database and `data/uploads/` would be lost on every deploy. The Nitro preset is pinned to `node-server` in `vite.config.ts` for this reason — the scaffold defaulted to `cloudflare-module`, which would have failed at runtime rather than at build time.

If you ever outgrow it, every exported function is still an isolated async call, so swapping in Postgres is contained to this one file.

## Known gaps / good next iterations

- `SERVICES` (`src/lib/services.ts`, used by booking logic) and the richer marketing `services` array in `src/routes/index.tsx` (images, feature bullets) are two separate lists that must be kept in sync by hand today. Consider unifying.
- Booking date/time picker is hand-rolled buttons, not the shadcn `calendar.tsx`/`react-day-picker` already in the scaffold — see `CLAUDE.md` for why, and revisit once the app is confirmed running.
- No email/SMS confirmation sent to the customer beyond the Google Calendar invite (`sendUpdates: "all"` when an attendee email is present, in `google-calendar.server.ts`) — no dedicated confirmation email flow yet.
- No reschedule flow (cancel + rebook only).
