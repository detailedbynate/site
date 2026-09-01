# CLAUDE.md

Context for Claude Code (or any future Claude session) picking up this project. Read this first, then `docs/` for deeper detail on a specific area.

## What this project is

**Detailed by Nate** — a mobile car detailing business website, originally scaffolded in **Lovable** (hence `.lovable/`, the Lovable-authored README intro, and the `bun.lock` alongside npm). The owner uploaded the Lovable export mid-conversation and asked to build a real booking system + backend on top of it, replacing an earlier from-scratch static-HTML mockup Claude had built before the Lovable zip existed (that mockup is not in this repo — it was a throwaway first pass; ignore it if you see it referenced anywhere else).

Everything in this repo is the **real, intended codebase**. There is no other version to reconcile.

## Stack

- **TanStack Start** (`@tanstack/react-start`) on Vite 7 — file-based routing via `@tanstack/react-router`, SSR + server functions in one Node app. Not Next.js, not plain Vite SPA.
- React 19, TypeScript, Tailwind v4 (`@tailwindcss/vite`, no `tailwind.config.js` — v4 is CSS-config based, see `src/styles.css`).
- shadcn/ui components already scaffolded in `src/components/ui/` (Radix primitives + `cva`). Use what's there before adding new UI packages.
- `motion` (Framer Motion's new package name) for animations — already used throughout `index.tsx`/`book.tsx`.
- Server functions via `createServerFn` from `@tanstack/react-start` — this is the backend pattern for this app. See "Backend architecture" below.
- **SQLite through `node:sqlite`** (Node's built-in engine, no dependency) at `data/app.db`. Requires Node >= 22.13; `engines` and `.nvmrc` pin this.

Run it:
```sh
npm i
cp .env.example .env   # then fill in Google Calendar creds — see docs/booking-system.md
npm run dev
```

## Status: it runs (as of 2026-08-30)

The "never been run" warning below is **resolved** — kept for history. `npm i`, `npx tsc --noEmit`, and `npm run build` all pass, and the booking flow was tested end-to-end in a browser. Only one fix was needed on first run: `routeTree.gen.ts` hadn't been regenerated for the `/admin` and `/book` routes (the Vite plugin does it automatically on `npm run dev`).

Verified working: homepage, `/book`, the Book Now modal, live availability (business hours − Google busy − existing bookings, with add-on duration folded in), booking submission, server-side re-validation, and `/admin` login + status updates.

**Still untested:** the Google Calendar path. Everything runs with Calendar unconfigured (all hours treated as free, event creation skipped). `scripts/get-google-refresh-token.mjs` has still never been run end-to-end — that needs the owner's own Google account.

## Critical environment note (historical)

**This project has been developed so far entirely without the ability to run `npm install` or `npm run dev`** — the sandbox that wrote most of this code had no network access (`npm install` returned `403 Forbidden` from the registry). All server-side code (`*.server.ts`, `src/lib/api/*.functions.ts`, `src/routes/admin.tsx`, `src/routes/book.tsx`, `src/components/BookingWidget.tsx`) was written carefully against the exact dependency versions pinned in `package.json`, cross-checked against the existing scaffolded patterns (e.g. `src/lib/api/example.functions.ts`, `src/lib/config.server.ts`) — but **none of it has actually been run**. No `npm run dev`, no `npm run build`, no `tsc`, no browser test.

**First priority in this new environment: run it, fix whatever breaks.** Expect:
- Possible TypeScript errors in the new files (`src/lib/*.server.ts`, `src/lib/api/*.functions.ts`, `src/routes/admin.tsx`, `src/components/BookingWidget.tsx`) — these were hand-verified for balanced braces/parens and cross-checked against neighboring code, not compiled.
- `googleapis` was added to `package.json` by hand (`"googleapis": "^144.0.0"`) — never actually installed. Version may need adjusting.
- The Google Calendar OAuth flow (`scripts/get-google-refresh-token.mjs`) has never been run end-to-end.
- react-day-picker v9 / shadcn `calendar.tsx` exists in the scaffold but was deliberately **not** used for the booking date picker (see below) — if you reach for it, check its v9 API carefully, it changed a lot from v8.

## Backend architecture (what was built, and why)

The ask: a booking system with real Google Calendar sync, plus an admin backend to view/manage clients and bookings — "partial construction" was explicitly fine, this doesn't need to be production-hardened yet.

**Design decisions and why:**

1. **No separate backend service.** TanStack Start server functions (`createServerFn`) run in the same Node process as SSR. `.server.ts`-suffixed files are tree-shaken from the client bundle automatically (confirmed via the existing `config.server.ts` comment in the scaffold) — that's where all secrets and Google API calls live.

2. **SQLite via `node:sqlite`, no dependencies.** `src/lib/db.server.ts` is a real database at `data/app.db`, using the SQLite engine built into Node (22.13+). No native modules to compile, no database server, no new package — the same reasoning that made auth use `scrypt` from `node:crypto` rather than bcrypt.

   It replaced a JSON file (`data/store.json`) that re-read and re-parsed the *whole* file on every call — computing availability across the 3-week window meant ~21 full-file reads, which are now index seeks on `bookings(date, status)`. It also brings real transactions and `UNIQUE` constraints on user email and booking reference, enforced by the database instead of by remembering to check first.

   Writes go through `tx()`. `node:sqlite` is synchronous and Node is single-threaded, so nothing interleaves inside a transaction — which is why the old write-queue mutex is gone. **Do not `await` inside `tx()`**, that breaks the guarantee.

   **Migration is automatic and safe.** On first start an existing `store.json` is imported in one transaction, then renamed to `store.json.migrated` with a copy at `store.json.backup`. The import only runs into a database holding no users, clients or bookings, so a stale export can never clobber live data. An unreadable database throws rather than silently starting empty (that bug destroyed test data once already).

   **Still needs a persistent disk** — fine on a VPS / Render / Railway / Fly.io (mount a volume at `data/`), still impossible on Vercel/Cloudflare. The Nitro preset is pinned to `node-server` in `vite.config.ts` for exactly this reason; the scaffold defaulted to `cloudflare-module`, which would have failed at runtime rather than at build time.

3. **Google Calendar: single-account OAuth2 refresh-token flow, not per-customer OAuth.** Customers never see a Google login — the business owner authorizes once (via `scripts/get-google-refresh-token.mjs`, a standalone local script), and the resulting refresh token lives in `.env` as `GOOGLE_REFRESH_TOKEN`. Availability is computed by calling `freebusy.query` against the configured calendar; confirmed bookings call `events.insert`. All in `src/lib/google-calendar.server.ts`.

4. **Google Calendar is optional at runtime, not required.** If `GOOGLE_CLIENT_ID`/`SECRET`/`REFRESH_TOKEN` aren't set, `isGoogleCalendarConfigured()` returns false and `getBusyIntervals`/`createCalendarEvent` short-circuit (treat everything as free / skip event creation) rather than throwing. This was deliberate so the booking flow is testable immediately without making Google setup a blocker.

5. **Admin auth is real now.** The old shared-password scheme is gone. `/admin` is behind accounts:
   - Passwords hashed with **scrypt** (`node:crypto`) — chosen over bcrypt/argon2 to keep the project free of native deps. 16-byte salt, 64-byte key, `timingSafeEqual` compare.
   - Sessions are opaque 32-byte random tokens stored **server-side** in the DB and sent as an **HTTP-only, SameSite=Lax** cookie (`Secure` in production). Server-side storage is what makes revocation possible — changing a password drops every other session instantly.
   - `requireUser()` / `requireRole()` in `auth.server.ts` are the single choke point; **every** admin server function starts with one. The client-side redirect in `admin.tsx` is convenience only, not the security boundary.
   - Login is throttled per IP+email (8 tries / 15 min, in-process) and returns an identical message for a wrong password and an unknown email, so accounts can't be enumerated.
   - **First-run:** with zero users, `/login` shows a setup screen that creates the owner account. `setupOwner` refuses once any user exists.
   - **Forgot the password?** Stop the server, run `DELETE FROM users;` against `data/app.db` (e.g. `node -e "new (require('node:sqlite').DatabaseSync)('data/app.db').exec('DELETE FROM users')"`), restart — the setup screen comes back.

6. **Business rules live in the database, not env vars.** Hours, closed days, lead time, booking window, travel fee and the business contact details are rows in the `settings` table, edited at `/admin/settings`, read via `getSettings()`. The `BUSINESS_*` / `BOOKING_*` env vars only seed `DEFAULT_SETTINGS` on first run. Same for the **service catalog** — packages and add-ons are DB records edited at `/admin/services` and `/admin/addons`; `src/lib/services.ts` now only holds the seed defaults, the shared types, and `quote()`. The booking wizard fetches the catalog via `getCatalog()` rather than importing it, so a price change takes effect with no redeploy.

7. **Timezone handling has no external dependency.** `src/lib/availability.server.ts` converts business-hours wall-clock times to UTC ISO strings using `Intl.DateTimeFormat` offset lookups rather than pulling in `date-fns-tz` or similar (the project already has plain `date-fns`, not the tz variant). Read the comment above `zonedTimeToISO` before touching this — it's correct but non-obvious (computes the zone's offset for the specific date by round-tripping through `Intl`, which handles DST correctly).

8. **Booking UI is a 6-step wizard (`src/components/booking/`), from a second Lovable export.** The owner built a richer booking flow in Lovable ("nate-s-booking-flow") and asked for it to be merged in. It replaced the original hand-built `BookingWidget.tsx` (deleted). Steps: Service → Add-ons → Location → Date & time → Your info → Review. The export's own mock data was thrown away — every value is now server-driven. Two deliberate changes from the export: its Express/Signature/Ceramic packages were dropped in favour of the site's real Silver/Gold/Diamond, and its "choose your detailer" step (which listed a fictional second employee) was removed, since this is a one-person business.

   The wizard renders in two places from one component: inline on `/book`, and as an overlay via `BookingModalProvider` (mounted in `__root.tsx`) so every "Book Now" button opens it **without navigating**. Package cards call `open("diamond")` to preselect a tier and skip to step 2.

9. **Service catalog lives in one shared file:** `src/lib/services.ts` — packages (Silver/Gold/Diamond), `ADD_ONS`, `TRAVEL_FEE`, `VEHICLE_COLORS`, and the `quote()` function that turns a selection into `{price, durationMinutes}`. Imported by both the client (the wizard's running total) and the server (`booking.functions.ts` recomputes the quote and **never trusts the client's numbers**; `availability.server.ts` uses the duration to size the calendar block). If you add/change packages or add-ons, this is the only file to touch — just keep it in sync with the marketing copy in `src/routes/index.tsx`'s `services` array, which is a **separate, unlinked** array (richer marketing copy: images, descriptions, feature bullets) that was already in the Lovable scaffold. The homepage "Book {title}" buttons map `title.toLowerCase()` to a `ServiceId`, so renaming a package there requires updating `services.ts` to match. Worth unifying later.

10. **Availability is computed for a whole 3-week window, not one day.** `getAvailableDays()` in `availability.server.ts` powers the calendar's greyed-out days, each with a reason (`closed` / `booked` / `lead-time`). Days ruled out by a static rule short-circuit before hitting Google Calendar, so it costs one freebusy call per *candidate* day, not per day shown. Lead time, closed weekdays, and window length are env-configurable (`BOOKING_LEAD_DAYS`, `CLOSED_DAYS`, `BOOKING_WINDOW_DAYS`) — defaults are 1 day's notice and closed Sundays, matching the Mon–Sat hours on the site.

11. **Finance is a real P&L, and every figure traces to a record.** `getFinance()` in
    `finance.functions.ts` computes:

    ```
    revenue      completed jobs only (price − discount + tip)
    − cogs       expenses typed "cogs" — supplies consumed doing the work
    = gross profit
    − operating  expenses typed "operating" — fuel, insurance, ads, wages
    = net profit
      equipment  durable purchases, reported but deliberately OUTSIDE net, so one
                 machine doesn't make a good month look like a disaster
    ```

    Three rules worth keeping:
    - **Everything is scoped to the selected window.** Totals, categories, vendors and
      per-package figures all cover the same N months as the chart, so the headline always
      reconciles with the bars. Records dated outside the window are reported separately
      (`outside`) rather than silently dropped. An earlier version had all-time totals over a
      windowed chart, which could never add up.
    - **Nothing is estimated except one clearly-labelled thing**: per-package margin uses the
      optional `materialCost` on each service. It never touches the headline P&L.
    - **Agent pay is an estimate too and is NOT in the P&L.** Record real wages as an
      expense; reported profit should only ever reflect money that actually moved.

12. **Assets and expenses are one action, not two.** `restockAsset()` raises stock *and* writes
    the expense in a single transaction, so the shelf and the ledger cannot drift. Consumables
    book as `cogs`, equipment as `equipment`. Note the ordering trap: the stock update happens
    inside `addExpense`, so re-read the asset before writing anything else back to it — writing
    a pre-restock snapshot silently undoes the stock you just added.

13. **Coupon redemption is server-authoritative.** `evaluateCoupon()` in
    `booking.functions.ts` is the single implementation, used by BOTH the live preview the
    customer sees (`checkCoupon`) and the real booking — so the quoted discount and the charged
    discount can never disagree. The subtotal it prices against is always recomputed on the
    server; a client-supplied total could be forged to inflate a percentage. `redeemCoupon()`
    re-checks the usage cap *inside its transaction*, so two bookings racing for the last use of
    a limited code can't both win. A code that expires between preview and submit is simply not
    applied — the booking still completes at full price rather than failing, and the response
    reports which code (if any) was actually honoured.

14. **Admin light/dark.** `useAdminTheme()` applies `admin-light` to the shell via a **callback
    ref held in state**, not `useRef`. Two reasons, both learned the hard way: the class can't
    live in React's `className` because the server can't know the preference (it would either
    flash the wrong theme or trip a hydration mismatch), and a plain ref is still `null` while
    the layout shows its "checking session" screen — the effect then never re-ran once the real
    element mounted, leaving light mode stuck on dark.

    All the admin's surfaces route through a token ladder (`--line-1..3`, `--fill-1..3`) defined
    in `styles.css`. The 202 hardcoded `white/[0.0x]` utilities were migrated to it, because
    white-on-dark hairlines are invisible on a light ground. **Use the tokens for any new admin
    surface** — a raw `bg-white/[0.05]` will look fine in dark mode and disappear in light.

15. **Page and tab transitions.** Route changes used to use `AnimatePresence mode="wait"`, which
    unmounts the old page, waits out its exit, and only then mounts the new one — leaving the
    container empty and collapsed to zero height in between, which is what made switching
    sections visibly jump. Now: no exit, no waiting, a `min-h` floor on `<main>`, and `Spinner`
    reserves 58vh so the layout doesn't snap again when data lands. Tab groups use
    `TabBar`, whose active pill is one element shared across tabs via `layoutId`, so Motion
    tweens it between options instead of hard-cutting a background.

16. **Stripe and webhooks are real, and deliberately narrow.** `stripe.server.ts` talks to
    Stripe's REST API with plain `fetch` (no SDK, same reasoning as Resend over nodemailer). It
    verifies a key by asking Stripe whose account it is — a real check, not a format test — and
    creates a hosted Payment Link for a booking's balance. It does NOT hold card details, run an
    on-page checkout, or consume inbound Stripe webhooks; marking a job paid is still manual.
    Outgoing webhooks POST booking events to any URL, HMAC-SHA256 signed in `x-dbn-signature`,
    https-only, fire-and-forget with an 8s timeout — an unreachable endpoint must never take a
    booking down with it.

18. **Number inputs select on focus.** Every numeric field is controlled and shows `0` when
    empty; clicking to the LEFT of that zero and typing `5` produced `50`. One delegated
    `focusin` listener in `admin.tsx` selects the contents of any `input[type=number]`, so the
    first keystroke replaces it. Done by delegation rather than on ~30 inputs so it also covers
    anything added later. Note `selectionStart` is always `null` on number inputs — the fix is
    verified by whether typing replaces, not by reading the selection.

19. **The public site no longer ships stock photography as its own work.** The bundled
    before/after JPEGs are gone from both the homepage and Results; only pairs uploaded under
    Admin → SEO & branding appear, and each carries its own subtitle, description and package
    label. The homepage section hides entirely when there are none. Testimonials moved the same
    way — the six hardcoded reviews are now seeded DB rows, editable at /admin/testimonials, so
    the design is unchanged but the words are the owner’s.

20. **CSV import of past jobs.** Parsed in the browser (the file never leaves the machine — only
    parsed rows are sent), column names matched through an alias table so a foreign export still
    works, previewed with a dry run before anything is written, and de-duplicated on
    date+time+customer so re-running the same file is safe. Imported jobs are marked paid, since
    otherwise Payments would show years of phantom debt.

22. **Light mode is marked on `<html>`, not just the admin root.** Seven elements re-declare
    `admin-theme` on themselves — the mobile drawer, the slide-over detail panel and every
    modal — and a re-declared block resets the palette to its dark defaults. The modals are
    also portalled to `<body>`, so they sit outside the admin root entirely. Toggling the class
    on the root element alone therefore left the drawer and every overlay stuck dark. The fix
    is the `:root.admin-light .admin-theme` selectors in styles.css paired with a class on
    `documentElement`, removed on unmount so the marketing site is never tinted. **Any new
    element that sets its own `admin-theme` class is covered automatically.**

23. **CSS gotcha — `items-end` on a bar-chart row collapses every bar.** A flex row with
    `items-end` sizes its children to their content, so a bar's `height: N%` resolves against
    a few pixels instead of the container. Three charts shipped looking flat because of it.
    Use `items-stretch` on the row and `items-end` only on the inner bar area.

24. **Homepage copy lives in the database.** Reviews, the FAQ and the hero background are all
    editable (Reviews & FAQ, and SEO & branding). The arrays still in `index.tsx` are named
    `fallback*` and are only used when a table comes back empty. Do not edit them expecting the
    site to change.

25. **CSS gotcha — use `overflow: clip`, not `hidden`, on anything with a translated `::after`.** The `sheen` and `btn-liquid` utilities have a decorative `::after` at `translateX(-120%)`. A transform contributes to an element's *scrollable overflow region*, and `overflow: hidden` still creates a scroll container — so focusing a child (tabbing to a time slot) made the browser scroll the whole wizard panel ~250px sideways and shove its content out of view. `overflow: clip` clips identically but never becomes scrollable. There are comments on both utilities in `styles.css`; don't "tidy" them back to `hidden`.

## File map — everything added/changed this session

```
src/lib/services.ts                    Seed catalog + shared types + quote() maths
src/lib/config.server.ts               Google creds only (business rules moved to the DB)
src/lib/db.server.ts                   SQLite (node:sqlite): clients, bookings, users,
                                       sessions, services, addOns, coupons, photos,
                                       emailRules/Log, formFields, gallery, settings
                                       + schema, transactions, store.json import
src/lib/auth.server.ts                 scrypt hashing, sessions, requireUser/requireRole, throttle
src/lib/google-calendar.server.ts      OAuth2 client, freebusy query, event create/delete
src/lib/availability.server.ts         Slot computation + getAvailableDays() for the calendar
src/lib/api/auth.functions.ts          setupOwner, login, logout, getMe, changePassword, team
src/lib/api/booking.functions.ts       Public: getCatalog, getBookableDays, getAvailability, createBooking
src/lib/api/admin.functions.ts         Session-guarded: dashboard, appointments, customers,
                                       catalog CRUD, settings, coupons
src/components/booking/*               The 6-step booking wizard + modal (see #8)
src/components/admin/ui.tsx            Shared admin primitives (GlassCard, StatTile, Button…)
src/components/admin/CatalogEditor.tsx One editor powering both Services and Add-ons
src/components/admin/PlannedSection.tsx Honest placeholder for unbuilt sections
src/routes/login.tsx                   Sign-in + first-run owner setup
src/routes/admin.tsx                   Admin layout: sidebar, auth guard, page transitions
src/routes/admin.index.tsx             Dashboard (stats, revenue chart, today, upcoming)
src/routes/admin.appointments.tsx      List, filter, cancel/complete/restore, reschedule, detail drawer
src/routes/admin.calendar.tsx          Month grid of booked jobs
src/routes/admin.customers.tsx         CRUD + lifetime value / last visit
src/routes/admin.services.tsx          Package catalog editor
src/routes/admin.addons.tsx            Add-on catalog editor
src/routes/admin.coupons.tsx           Discount codes (creation works; redemption not wired yet)
src/routes/admin.settings.tsx          Business info, hours, booking rules, profile, password
src/routes/admin.finance.tsx           P&L: revenue − COGS = gross − operating = net, expense
                                       ledger, spend by category, per-package margin
src/routes/admin.payments.tsx          Balances owed, record a payment/tip, mark refunded
src/routes/admin.assets.tsx            Equipment + consumables, stock levels, restock-with-expense
src/routes/admin.agents.tsx            Staff roster, pay setup, per-person jobs/hours/revenue
src/routes/admin.locations.tsx         Shops and mobile zones with per-zone travel fees
src/lib/api/finance.functions.ts       Expense CRUD + getFinance() period P&L
src/lib/api/operations.functions.ts    Agents, locations, assets CRUD + job assignment
src/components/admin/EditorModal.tsx   Shared create/edit dialog (portalled to <body>)
src/components/admin/AvatarPicker.tsx   Profile pictures (downscaled client-side)
src/components/admin/AppointmentImport.tsx CSV import of past jobs
src/lib/api/content.functions.ts       Testimonials + profile pictures
src/lib/api/appointments.functions.ts  Price breakdown, editing, CSV import
src/routes/admin.testimonials.tsx      Homepage reviews: add / edit / reorder / hide
src/components/admin/theme.tsx         Light/dark for the admin shell (see #14)
src/components/admin/TabBar.tsx        Segmented control with a sliding pill (see #15)
src/lib/stripe.server.ts               Stripe REST via fetch: verify key, create payment link
src/lib/webhooks.server.ts             Outgoing signed webhooks on booking events
src/routes/__root.tsx                  Mounts BookingModalProvider around <Outlet/>
src/routes/index.tsx                   Book Now buttons open the modal instead of navigating
src/routes/book.tsx                    Renders BookingWizard inline
src/styles.css                         Brand tokens mapped to the dark theme, glass utilities
```

**Deleted:** `src/components/BookingWidget.tsx` (superseded by `src/components/booking/`).

Untouched from the Lovable export: `src/routes/index.tsx` (homepage), `src/routes/results.tsx` (before/after gallery), `src/components/BeforeAfter.tsx`, all of `src/components/ui/*`, `src/routes/__root.tsx`, `src/router.tsx`, `src/server.ts`, `src/start.ts`, and the Lovable/Vite/Nitro config files.

## Conventions already established in this codebase (follow these)

- Server-only code goes in a `*.server.ts` file, or is imported dynamically **inside** a `createServerFn` handler (`await import("../db.server")`) — never at module scope in a file that's also imported client-side. This is what keeps secrets and `googleapis` out of the browser bundle. See `src/lib/api/booking.functions.ts` for the canonical pattern; every `.functions.ts` file follows it. (The scaffold’s `example.functions.ts` was deleted — it was unused and exposed `nodeEnv` on an unauthenticated endpoint.)
- `getServerConfig()` in `src/lib/config.server.ts` is the single place env vars are read — always read inside a function, never at module scope (comment in that file explains why: Cloudflare Workers bind env at request time).
- Path alias `@/*` → `src/*` (see `tsconfig.json`).
- File-based routing: **do not** hand-edit `src/routeTree.gen.ts`. Adding a route = adding a file under `src/routes/`; see `src/routes/README.md`.
- Tailwind v4 — no `tailwind.config.js` to edit; theme tokens live in CSS. Check `src/styles.css` before assuming a Tailwind v3 workflow.

## Immediate next steps (pick up here)

1. **Create your admin account.** Visit `/login` — with an empty database it shows a first-run setup screen. That account becomes the owner.
2. **Google Calendar.** Run `node scripts/get-google-refresh-token.mjs`, fill `GOOGLE_*` in `.env`, and retest — this is the last unverified path. Confirm a booking creates a real event, that a busy block removes slots, and that cancelling deletes the event.
3. **Real contact details.** `/admin/settings` holds the business name/phone/email now, but the hardcoded Lovable placeholders `(555) 123-4567` and `book@detailedbynate.com` still appear in the `index.tsx` and `book.tsx` footers — wire those to `getCatalog().business` or edit them.
4. **Confirmation email/SMS.** Nothing is sent. The confirmation screen says one is coming, and only the Google Calendar invite actually goes out (when configured). Wire an email provider or soften the copy.
5. **Coupon redemption is done** — there's a code field on the booking wizard's Review step, and
   redemptions are counted. What's still missing is per-customer limits ("one use per email").

5b. **Locations are admin-side only.** Zones carry their own travel fee for planning and
    reporting, but the public booking form still offers the plain mobile/shop choice and the
    single default travel fee from Settings. Wiring zones into the customer-facing wizard is a
    separate change.
6. **Before a real domain:** rate-limiting at the proxy (the in-process login throttle resets on restart) and a deposit/no-show policy. Deploy only where `data/` is a persistent volume — Vercel/Cloudflare will lose the database *and* every uploaded photo on each deploy; use a VPS/Render/Railway/Fly. Build with `npm run build`, start with `npm start`.

## Design system reference (for future visual work)

The homepage/booking pages follow a deliberate dark automotive design direction (from the Lovable brief, extended by Claude): near-black background, glow/gradient accents, condensed display type. See `docs/design-notes.md` for the fuller rationale if doing more visual design work — useful context so new pages/sections stay consistent rather than drifting toward generic AI-default styling (cream+serif, or black+neon-green — both explicitly things to avoid per the design process used).

## Full conversation history

`docs/session-log.md` has a fuller narrative of how this session went, including the earlier discarded static-HTML mockup and the reasoning behind switching to the Lovable export. Read it if `CLAUDE.md` doesn't answer a "why was this done this way" question.
