# Nate's Shine Studio

Build me a modern car detailing website with a book now button and fluid animations and everything, make it a darker website but have glow and stuff the name of the company is Detailed by Nate add the effect where numbers gradually go up and it says 150+ clients served also add a 5 star review thing and a section where i can add the reviews and have it has an animation add sample text inside the review boxes. also add a faq at  the bottom.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://glow-and-go-detailing.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/363bd282-394f-4d8c-88c0-c6013ee75cb2).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## Booking system + Google Calendar + admin (added on top of Lovable's build)

This adds a real booking flow on `/book`, a Google Calendar sync, and a
password-gated admin dashboard at `/admin` for managing clients and
bookings. It's built as TanStack Start server functions (`src/lib/api/*.functions.ts`),
so it runs in the same Node process as the site — no separate backend to
stand up.

### 1. Install and set up your `.env`

```sh
npm i
cp .env.example .env
```

### 2. Connect Google Calendar

1. In the [Google Cloud Console](https://console.cloud.google.com/), create or pick a project.
2. **APIs & Services → Library** → enable the **Google Calendar API**.
3. **APIs & Services → Credentials → Create Credentials → OAuth client ID** → application type **Desktop app**. Copy the Client ID and Client Secret into `.env` as `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
4. If prompted, configure the OAuth consent screen (External is fine; you can leave it in "Testing" mode and just add your own Google account as a test user).
5. Run the one-time helper script to mint a refresh token:
   ```sh
   node scripts/get-google-refresh-token.mjs
   ```
   It prints a URL — open it, sign in with the Google account whose calendar you want to book against, approve access, then copy the `GOOGLE_REFRESH_TOKEN=...` line it prints into `.env`.
6. Set `GOOGLE_CALENDAR_ID` — `primary` uses that account's main calendar, or use a specific calendar's ID from **Calendar settings → Integrate calendar**.

Until this is configured, the booking form still works — every hour in
business hours shows as open (Google Calendar is just skipped), and
bookings save locally. Fill in `.env` when you're ready to sync for real.

### 3. Set business hours and admin password

Also in `.env`:

- `BUSINESS_TIMEZONE`, `BUSINESS_OPEN_HOUR`, `BUSINESS_CLOSE_HOUR`, `SLOT_INCREMENT_MINUTES` — control what slots show on `/book`.
- `ADMIN_PASSWORD` — whatever you want to gate `/admin` with.

### 4. Run it

```sh
npm run dev
```

- `/book` — the live booking form (package → date → open time slot → contact info). Confirmed bookings create a Google Calendar event automatically and save the client + booking locally.
- `/admin` — sign in at `/login` to manage bookings (mark complete/cancelled — cancelling also removes the Calendar event), customers, the service catalog, settings and automation. On a fresh database `/login` shows a one-time setup screen that creates the owner account.

### Where things are stored

Everything is in a SQLite database at `data/app.db`, via
`src/lib/db.server.ts`. It uses **`node:sqlite`** — the engine built into
Node itself — so there are no native modules to compile and no database
server to run. Uploaded photos are real files under `data/uploads/`.

This needs a **persistent, writable disk**. It works on a VPS, Railway,
Render or Fly.io (mount a volume at `data/`). It will **not** work on
serverless hosts with an ephemeral or read-only filesystem (Vercel,
Cloudflare Pages) — the database and every photo would vanish on each
deploy. The production build targets `node-server` for this reason (see
`vite.config.ts`); build with `npm run build` and start with `npm start`.

Upgrading from an older checkout that used `data/store.json`? Nothing to
do: the JSON file is imported automatically the first time the server
starts, and the original is kept as `data/store.json.backup`.

### Hardening before going live

This is a working demo/first pass, not a production-secure backend yet:

- **Admin auth is real**: scrypt-hashed passwords and server-side,
  revocable sessions in an HTTP-only cookie. What's still missing is
  rate limiting at the proxy — the login throttle is in-process, so it
  resets whenever the server restarts.
- Add rate limiting to `/book`'s `createBooking` call so it can't be spammed.
- Consider requiring email verification or a deposit before confirming a booking.
- Back up `data/` — it holds the database *and* the uploaded photos.
