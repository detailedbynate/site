import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { randomBytes, randomUUID } from "node:crypto";
import { DatabaseSync, type StatementSync } from "node:sqlite";

import { DEFAULT_ADD_ONS, DEFAULT_SERVICES, type LocationChoice } from "./services";

// --------------------------------------------------------------------------
// SQLite-backed store, using node:sqlite — the database engine built into
// Node itself (>= 22.5). That matters here: it means a real, transactional,
// indexed database with ZERO dependencies and zero infrastructure. No
// node-gyp, no prebuilt binaries, no Postgres to host. It is the same
// reasoning that made auth use scrypt from node:crypto instead of bcrypt.
//
// This replaced a JSON file that was read and re-parsed in full on every
// single call. Computing availability across the 3-week booking window meant
// ~21 whole-file reads; now it is 21 index seeks against `date`.
//
// Everything below keeps the exact function signatures the JSON version had,
// so no caller in src/lib/api ever changed.
//
// Data lives in <project-root>/data/app.db (gitignored). Serverless hosts
// with ephemeral or read-only filesystems (Vercel, Cloudflare) still will not
// work — the file must survive between requests. Use a host with a real
// persistent disk (Railway/Render/Fly/a VPS) and mount it at `data/`.
//
// NOTE: node:sqlite prints an ExperimentalWarning at boot. The warning is
// about the JS API surface possibly changing between Node majors, not about
// data safety — SQLite itself is the most-deployed database in the world.
// Pin the Node major (see `engines` in package.json) and it cannot surprise
// you mid-deploy.
// --------------------------------------------------------------------------

// ------------------------------ Types ---------------------------------

export interface Client {
  id: string;
  name: string;
  email: string;
  phone: string;
  notes?: string;
  createdAt: string;
}

export type BookingStatus = "confirmed" | "completed" | "cancelled";
export type PaymentStatus = "unpaid" | "partial" | "paid" | "refunded";

export interface Vehicle {
  make: string;
  model: string;
  year: string;
  color: string;
}

export interface Booking {
  id: string;
  clientId: string;
  serviceId: string;
  serviceTitle: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:mm, 24h, in businessTimezone
  durationMinutes: number; // service + add-ons, i.e. the real block booked
  status: BookingStatus;
  /** Short human reference shown to the customer, e.g. "DBN-4821". */
  reference: string;
  addOnIds: string[];
  addOnTitles: string[];
  location: LocationChoice;
  address?: string;
  vehicle?: Vehicle;
  totalPrice: number;
  /** Cash/e-transfer tip recorded after the job. Adds to revenue. */
  tip?: number;
  discount?: number;
  paymentStatus: PaymentStatus;
  amountPaid?: number;
  paymentMethod?: string;
  /** Ids into the `photos` collection — before/after shots of the car. */
  photoIds?: string[];
  /** Answers to custom form fields, keyed by field id. */
  customFields?: Record<string, string>;
  notes?: string;
  /** Set when an admin cancels, for the record. */
  cancelledAt?: string;
  cancelReason?: string;
  googleEventId?: string;
  /** Unguessable token letting the customer open this booking from a link. */
  manageToken?: string;
  /** Deposit taken at booking time, and the Stripe link it was taken through. */
  depositAmount?: number;
  depositPaidAt?: string;
  depositUrl?: string;
  depositLinkId?: string;
  /** Fee for cancelling inside the free window. */
  cancelFeeAmount?: number;
  cancelFeePaidAt?: string;
  cancelFeeUrl?: string;
  cancelFeeLinkId?: string;
  /** Which staff member is doing the job (see `agents`). */
  agentId?: string;
  /** Which shop/zone it belongs to (see `locations`). */
  locationId?: string;
  createdAt: string;
}

export type UserRole = "owner" | "staff";

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  /** scrypt hash — see auth.server.ts. Never leaves the server. */
  passwordHash: string;
  passwordSalt: string;
  createdAt: string;
  lastLoginAt?: string;
  /** Row id in `photos` used as their profile picture. */
  avatarPhotoId?: string;
}

/** A logged-in browser session. Token lives in an HTTP-only cookie. */
export interface Session {
  token: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
  userAgent?: string;
}

export interface ServiceRecord {
  id: string;
  title: string;
  subtitle: string;
  priceValue: number;
  durationMinutes: number;
  /** Short selling points, shown as pills on the booking form. */
  features: string[];
  /** Longer marketing copy for the homepage card. */
  description: string;
  /** Hidden services stay bookable for existing bookings but aren't offered. */
  active: boolean;
  sortOrder: number;
  /**
   * Estimated product cost to deliver one job of this package. Powers the
   * per-package margin estimate only — the headline P&L is always built from
   * real recorded expenses, so this can never inflate reported profit.
   */
  materialCost: number;
}

export interface AddOnRecord {
  id: string;
  name: string;
  detail: string;
  price: number;
  durationMinutes: number;
  active: boolean;
  sortOrder: number;
}

/** One day's trading hours. `open: false` means closed that day. */
export interface DaySchedule {
  open: boolean;
  openHour: number;
  closeHour: number;
}

/** Seven entries, index 0 = Sunday. */
export type WeekSchedule = DaySchedule[];

export interface Settings {
  businessName: string;
  contactEmail: string;
  contactPhone: string;
  serviceArea: string;
  timezone: string;
  openHour: number;
  closeHour: number;
  slotIncrementMinutes: number;
  leadDays: number;
  /** 0=Sun … 6=Sat */
  closedDays: number[];
  bookingWindowDays: number;
  travelFee: number;
  /**
   * Dead time kept either side of anything already on the day — a booked job,
   * a Google Calendar event, or a block of time off. Pack-up, travel and
   * setup: without it the form would offer a slot starting the minute the
   * previous thing ends.
   */
  bufferMinutes: number;

  // --- Deposits ---
  /** Take a deposit at booking. Off by default; nothing changes until set. */
  depositEnabled: boolean;
  /** "percent" reads depositValue as 0-100 of the total; "fixed" as dollars. */
  depositType: "percent" | "fixed";
  depositValue: number;

  // --- Cancellation policy ---
  /** Let customers cancel and reschedule themselves from a link. */
  selfServiceEnabled: boolean;
  /** Free cancellation up to this many hours before the start. */
  cancelFreeHours: number;
  /** Inside cancelFreeHours, charge this to cancel. 0 = free anyway. */
  cancelFeeType: "percent" | "fixed";
  cancelFeeValue: number;
  /**
   * Inside this many hours, online cancellation is refused outright — they
   * have to call. Set below cancelFreeHours or it swallows the fee window.
   */
  cancelLockHours: number;
  /** Customers may move a booking until this many hours before it starts. */
  rescheduleMinHours: number;
  /**
   * Hard cap on jobs accepted per day, whatever the clock says. 0 = no cap.
   * Slot maths alone will happily sell four details in a day that you only
   * want to do two in.
   */
  maxJobsPerDay: number;
  /**
   * Base weekly hours — the schedule BEFORE Google Calendar busy blocks and
   * existing bookings are subtracted. This is the source of truth for what
   * you are open; Calendar only ever removes time from it, never adds.
   */
  weeklySchedule: WeekSchedule;
  /**
   * Mobile jobs often run a shorter day (travel, daylight). When enabled,
   * customers choosing mobile see these hours instead of the shop ones.
   */
  mobileScheduleEnabled: boolean;
  mobileSchedule: WeekSchedule;
  /**
   * Public URL of the live site. Used for the Google OAuth redirect URI and
   * SEO canonical/OG tags. Left blank, both fall back to the address of the
   * incoming request, which is right in dev and behind most proxies.
   */
  siteUrl: string;

  // --- SEO / branding ---
  siteTitle: string;
  siteTagline: string;
  siteDescription: string;
  siteKeywords: string;
  ogImageUrl: string;
  faviconUrl: string;
  /** Row id in `photos` for the homepage hero background. Blank = bundled. */
  heroPhotoId: string;
  /**
   * The headline over the hero. Split in two so the second half keeps the
   * accent colour it has in the design.
   */
  heroHeadline: string;
  heroHeadlineAccent: string;
  heroSubtext: string;
  /** The three counters under the hero. Rating is fixed at 5.0. */
  statClients: number;
  statVehicles: number;
  twitterHandle: string;

  // --- Calendar event templates ({{vars}}, same set as emails) ---
  calendarEventTitle: string;
  calendarEventDescription: string;

  /** Google Calendar — configured from /admin/integrations, not env. */
  googleClientId: string;
  googleClientSecret: string;
  googleRefreshToken: string;
  googleCalendarId: string;
  /** Which Google account is connected, for display only. */
  googleAccountEmail: string;
  /**
   * Why the last calendar call failed. Calendar work is deliberately
   * non-fatal, so without this a broken connection is completely silent.
   */
  googleLastError: string;
  googleLastErrorAt: string;
  /** Resend API key — HTTP only, so no SMTP dependency. */
  resendApiKey: string;
  emailFrom: string;
  /** Sender display name. Sent as: Name <address>. Blank = address only. */
  emailFromName: string;
  /**
   * Logo at the top of every email. Must be a public https URL — mail
   * clients don't load relative paths, and Gmail strips data: images.
   */
  emailLogoUrl: string;
  emailReplyTo: string;

  /**
   * Stripe. Secret key is used server-side only, to create payment links for
   * outstanding balances. The publishable key is safe to expose but isn't
   * needed until there's an on-page card form.
   */
  stripeSecretKey: string;
  stripePublishableKey: string;
  /** Account name Stripe reported when the key was last verified. */
  stripeAccountName: string;
  /** Currency payment links are created in. */
  stripeCurrency: string;

  /**
   * Outgoing webhook. Every booking event is POSTed here as JSON, so the shop
   * can wire bookings into Zapier/Make/n8n or anything else without this app
   * needing to know about that service.
   */
  webhookUrl: string;
  webhookSecret: string;
  webhookEvents: string[];
}

export interface Photo {
  id: string;
  bookingId?: string;
  clientId?: string;
  /** "before" | "after" | "other" — lets the UI group them. */
  kind: "before" | "after" | "other";
  mime: string;
  size: number;
  caption?: string;
  createdAt: string;
}

export type EmailTrigger =
  | "booking_confirmed"
  | "reminder"
  | "after_service"
  | "booking_cancelled";

export interface EmailRule {
  /** Built-in ids match EmailTrigger; custom rules get a uuid. */
  id: string;
  /** Which event fires it. Custom rules reuse the same trigger points. */
  trigger?: EmailTrigger;
  name?: string;
  custom?: boolean;
  enabled: boolean;
  subject: string;
  body: string;
  /** For time-based rules: hours before (reminder) or after (follow-up). */
  offsetHours: number;
}

export interface EmailLogEntry {
  id: string;
  to: string;
  subject: string;
  trigger: EmailTrigger;
  status: "sent" | "failed" | "skipped";
  error?: string;
  bookingId?: string;
  createdAt: string;
}

export type FieldType = "text" | "textarea" | "select" | "checkbox" | "number" | "date";

export interface FormField {
  id: string;
  label: string;
  type: FieldType;
  required: boolean;
  placeholder?: string;
  helpText?: string;
  /** For "select" — the choices offered. */
  options: string[];
  /** Empty = show for every package; otherwise only these service ids. */
  onlyForServices: string[];
  active: boolean;
  sortOrder: number;
}

/** A before/after pair shown on the public site. */
export interface GalleryPair {
  id: string;
  label: string;
  beforePhotoId: string;
  afterPhotoId: string;
  sortOrder: number;
  active: boolean;
  /** Short subtitle, e.g. "Black sedan hood". */
  detail: string;
  /** Paragraph shown under the slider on the Results page. */
  description: string;
  /** Which package did the work, e.g. "Diamond". */
  packageLabel: string;
}

/** A customer review shown on the homepage. */
/** One homepage FAQ entry. */
export interface Faq {
  id: string;
  question: string;
  answer: string;
  active: boolean;
  sortOrder: number;
  createdAt: string;
}

export interface Testimonial {
  id: string;
  name: string;
  vehicle: string;
  rating: number;
  text: string;
  active: boolean;
  sortOrder: number;
  createdAt: string;
}

/** A staff member. Optionally linked to a login account (`userId`). */
export interface AgentRecord {
  id: string;
  name: string;
  email: string;
  phone: string;
  title: string;
  /** How they're paid — drives the labour-cost estimate on the P&L. */
  payType: "none" | "hourly" | "commission";
  /** Dollars per hour, or percent of the job, depending on payType. */
  payRate: number;
  /** Dot colour so a schedule can tell people apart at a glance. */
  color: string;
  userId?: string;
  notes?: string;
  active: boolean;
  sortOrder: number;
  createdAt: string;
  /** Row id in `photos` used as their profile picture. */
  avatarPhotoId?: string;
}

/** A shop/bay ("shop") or a mobile service area ("zone"). */
export interface LocationRecord {
  id: string;
  name: string;
  kind: "shop" | "zone";
  address: string;
  city: string;
  postalCode: string;
  /** Zones can charge their own travel fee instead of the global one. */
  travelFee: number;
  radiusKm: number;
  notes?: string;
  active: boolean;
  sortOrder: number;
  createdAt: string;
}

export type AssetKind = "equipment" | "consumable";

export interface AssetRecord {
  id: string;
  name: string;
  kind: AssetKind;
  category: string;
  /** Unit consumables are counted in — "bottle", "pad", "L". */
  unit: string;
  unitCost: number;
  quantity: number;
  /** Warn when quantity falls to or below this. Consumables only. */
  reorderLevel: number;
  supplier?: string;
  notes?: string;
  active: boolean;
  createdAt: string;
}

/**
 * Where a cost lands on the P&L:
 * - `cogs`      — consumed delivering jobs. Subtracted to get GROSS profit.
 * - `operating` — running the business (fuel, insurance, ads). After gross.
 * - `equipment` — durable purchases. Kept separate so one big machine
 *                 doesn't look like a catastrophic month.
 */
export type ExpenseType = "cogs" | "operating" | "equipment";

export interface ExpenseRecord {
  id: string;
  date: string;
  description: string;
  category: string;
  vendor?: string;
  type: ExpenseType;
  amount: number;
  quantity?: number;
  unitCost?: number;
  /** Set when this purchase restocked a consumable. */
  assetId?: string;
  /** Set when the cost belongs to one specific job. */
  bookingId?: string;
  paymentMethod?: string;
  notes?: string;
  createdAt: string;
}

export const EXPENSE_CATEGORIES = [
  "Chemicals & supplies",
  "Equipment",
  "Fuel & travel",
  "Vehicle",
  "Insurance",
  "Marketing",
  "Software & fees",
  "Rent & utilities",
  "Wages",
  "Other",
] as const;

export interface Coupon {
  id: string;
  code: string;
  /** "percent" takes `value` as 0-100; "fixed" takes it as dollars. */
  type: "percent" | "fixed";
  value: number;
  active: boolean;
  timesUsed: number;
  maxUses?: number;
  /** One redemption per customer email, on top of any total cap. */
  oncePerCustomer?: boolean;
  expiresAt?: string;
  createdAt: string;
}

export function defaultWeek(openHour: number, closeHour: number, closedDays: number[]): WeekSchedule {
  return Array.from({ length: 7 }, (_, day) => ({
    open: !closedDays.includes(day),
    openHour,
    closeHour,
  }));
}

export const DEFAULT_SETTINGS: Settings = {
  businessName: "Detailed by Nate",
  contactEmail: "book@detailedbynate.com",
  contactPhone: "(555) 123-4567",
  serviceArea: "Sault Ste. Marie area",
  timezone: process.env.BUSINESS_TIMEZONE ?? "America/Toronto",
  bufferMinutes: Number(process.env.BOOKING_BUFFER_MINUTES ?? 30),
  depositEnabled: false,
  depositType: "percent" as const,
  depositValue: 25,
  selfServiceEnabled: true,
  cancelFreeHours: 24,
  cancelFeeType: "percent" as const,
  cancelFeeValue: 0,
  cancelLockHours: 0,
  rescheduleMinHours: 24,
  maxJobsPerDay: Number(process.env.BOOKING_MAX_PER_DAY ?? 0),
  openHour: Number(process.env.BUSINESS_OPEN_HOUR ?? 8),
  closeHour: Number(process.env.BUSINESS_CLOSE_HOUR ?? 18),
  slotIncrementMinutes: Number(process.env.SLOT_INCREMENT_MINUTES ?? 30),
  leadDays: Number(process.env.BOOKING_LEAD_DAYS ?? 1),
  closedDays: [0],
  bookingWindowDays: Number(process.env.BOOKING_WINDOW_DAYS ?? 21),
  travelFee: 25,
  weeklySchedule: defaultWeek(
    Number(process.env.BUSINESS_OPEN_HOUR ?? 8),
    Number(process.env.BUSINESS_CLOSE_HOUR ?? 18),
    [0],
  ),
  mobileScheduleEnabled: false,
  mobileSchedule: defaultWeek(
    Number(process.env.BUSINESS_OPEN_HOUR ?? 9),
    Number(process.env.BUSINESS_CLOSE_HOUR ?? 17),
    [0],
  ),
  siteUrl: "",
  siteTitle: "Detailed by Nate — Premium Auto Detailing",
  siteTagline: "Make your car look untouchable.",
  siteDescription:
    "Premium mobile auto detailing. Hand-washed, ceramic-coated, showroom-perfect. Book online in under 60 seconds.",
  siteKeywords: "auto detailing, car detailing, ceramic coating, mobile detailing",
  ogImageUrl: "",
  faviconUrl: "",
  heroPhotoId: "",
  heroHeadline: "Make your car",
  heroHeadlineAccent: "look untouchable.",
  heroSubtext:
    "Concours-grade paint correction, ceramic coatings and interior restoration — done in-studio with obsessive attention to every reflection.",
  statClients: 150,
  statVehicles: 200,
  twitterHandle: "",
  calendarEventTitle: "{{service}} — {{fullName}}",
  calendarEventDescription: `Service: {{service}}
Add-ons: {{addOns}}
Total: {{total}}
Reference: {{reference}}

Client: {{fullName}}
Phone: {{phone}}
Email: {{email}}
Vehicle: {{vehicle}}
Where: {{location}}

Notes: {{notes}}`,
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
  googleRefreshToken: process.env.GOOGLE_REFRESH_TOKEN ?? "",
  googleCalendarId: process.env.GOOGLE_CALENDAR_ID ?? "primary",
  googleAccountEmail: "",
  googleLastError: "",
  googleLastErrorAt: "",
  resendApiKey: process.env.RESEND_API_KEY ?? "",
  emailFrom: process.env.EMAIL_FROM ?? "",
  emailFromName: "",
  emailLogoUrl: "",
  emailReplyTo: "",
  stripeSecretKey: process.env.STRIPE_SECRET_KEY ?? "",
  stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY ?? "",
  stripeAccountName: "",
  stripeCurrency: "cad",
  webhookUrl: "",
  webhookSecret: "",
  webhookEvents: ["booking_created", "booking_cancelled", "booking_completed"],
};

/**
 * The reviews that used to be hardcoded on the homepage. Seeded on first run
 * so the page looks identical to before, but every one is now editable and
 * deletable from /admin/testimonials.
 */
export const DEFAULT_TESTIMONIALS: Omit<Testimonial, "createdAt">[] = [
  {
    id: "seed-marcus",
    name: "Marcus T.",
    vehicle: "BMW M4 Competition",
    rating: 5,
    text: "Nate transformed my M4. Paint correction was flawless — looks better than the day I drove it off the lot. Genuine craftsman.",
    active: true,
    sortOrder: 0,
  },
  {
    id: "seed-sofia",
    name: "Sofia R.",
    vehicle: "Tesla Model 3",
    rating: 5,
    text: "Booked the ceramic coating package. Water beads off like magic and the interior smells brand new. Worth every dollar.",
    active: true,
    sortOrder: 1,
  },
  {
    id: "seed-devon",
    name: "Devon K.",
    vehicle: "Ford F-150 Raptor",
    rating: 5,
    text: "Truck was a mud-caked disaster after a weekend in Moab. Came back showroom clean inside and out. Insane attention to detail.",
    active: true,
    sortOrder: 2,
  },
  {
    id: "seed-aisha",
    name: "Aisha P.",
    vehicle: "Porsche 911 Carrera",
    rating: 5,
    text: "I'm picky about who touches my 911. Nate is the only detailer I trust now. Hand wash, no swirl marks, perfect every visit.",
    active: true,
    sortOrder: 3,
  },
  {
    id: "seed-jordan",
    name: "Jordan L.",
    vehicle: "Audi RS5",
    rating: 5,
    text: "On-time, professional, and the results speak for themselves. The deep interior clean pulled stains I thought were permanent.",
    active: true,
    sortOrder: 4,
  },
  {
    id: "seed-riley",
    name: "Riley M.",
    vehicle: "Jeep Wrangler",
    rating: 5,
    text: "Got the full detail before selling — sold it for $2k over asking. Buyers couldn't believe the condition. Thanks Nate.",
    active: true,
    sortOrder: 5,
  },
];

/** The FAQ that used to be hardcoded on the homepage. Seeded on first run. */
export const DEFAULT_FAQS: Omit<Faq, "createdAt">[] = [
  {
    id: "seed-duration",
    question: "How long does a full detail take?",
    answer:
      "A standard full detail runs 3–5 hours depending on vehicle size and condition. Ceramic coatings require an additional cure day.",
    active: true,
    sortOrder: 0,
  },
  {
    id: "seed-mobile",
    question: "Do you come to me?",
    answer:
      "Yes — mobile service is available throughout the area. I bring water, power, and every product needed.",
    active: true,
    sortOrder: 1,
  },
  {
    id: "seed-ceramic",
    question: "What's included in the ceramic coating package?",
    answer:
      "Full decontamination wash, clay bar, single-stage paint correction, panel wipe, and a professional 9H ceramic coating with warranty.",
    active: true,
    sortOrder: 2,
  },
  {
    id: "seed-prepare",
    question: "How should I prepare my vehicle?",
    answer:
      "Just remove personal belongings. I handle everything else — from cup-holder gunk to dog hair embedded in the seats.",
    active: true,
    sortOrder: 3,
  },
  {
    id: "seed-maintenance",
    question: "Do you offer maintenance packages?",
    answer:
      "Absolutely. Monthly and bi-weekly maintenance plans keep your finish protected and save you money long-term.",
    active: true,
    sortOrder: 4,
  },
];

export const DEFAULT_EMAIL_RULES: EmailRule[] = [
  {
    id: "booking_confirmed",
    enabled: true,
    offsetHours: 0,
    subject: "You're booked in — {{service}} on {{date}}",
    body: `Hi {{name}},

You're all set. Here's everything for your {{service}} detail.

{{details}}

{{depositLink}}

{{policy}}

{{manageLink}}

— {{business}}`,
  },
  {
    id: "reminder",
    enabled: true,
    offsetHours: 24,
    subject: "Tomorrow: your {{service}} detail",
    body: `Hi {{name}},

Quick reminder — your {{service}} is booked for {{date}} at {{time}}.

{{location}}

Please clear any personal items from the car before I arrive.

— {{business}}`,
  },
  {
    id: "after_service",
    enabled: false,
    offsetHours: 24,
    subject: "How did we do?",
    body: `Hi {{name}},

Thanks for choosing {{business}}. Hope the {{vehicle}} is looking sharp.

If you have a moment, I'd really appreciate a quick review — it helps a lot.

— {{business}}`,
  },
  {
    id: "booking_cancelled",
    enabled: true,
    offsetHours: 0,
    subject: "Your booking has been cancelled",
    body: `Hi {{name}},

Your {{service}} on {{date}} at {{time}} has been cancelled.

Reference: {{reference}}

Get in touch any time to rebook.

— {{business}}`,
  },
];

// -------------------------- Connection --------------------------------

const DATA_DIR = path.join(process.cwd(), "data");
const DB_FILE = path.join(DATA_DIR, "app.db");
const LEGACY_JSON = path.join(DATA_DIR, "store.json");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS clients (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  email        TEXT NOT NULL,
  phone        TEXT NOT NULL,
  notes        TEXT,
  createdAt    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_clients_email   ON clients(email COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_clients_created ON clients(createdAt DESC);

CREATE TABLE IF NOT EXISTS bookings (
  id              TEXT PRIMARY KEY,
  clientId        TEXT NOT NULL,
  serviceId       TEXT NOT NULL,
  serviceTitle    TEXT NOT NULL,
  date            TEXT NOT NULL,
  startTime       TEXT NOT NULL,
  durationMinutes INTEGER NOT NULL,
  status          TEXT NOT NULL,
  reference       TEXT NOT NULL,
  addOnIds        TEXT NOT NULL DEFAULT '[]',
  addOnTitles     TEXT NOT NULL DEFAULT '[]',
  location        TEXT NOT NULL,
  address         TEXT,
  vehicle         TEXT,
  totalPrice      REAL NOT NULL,
  tip             REAL,
  discount        REAL,
  paymentStatus   TEXT NOT NULL DEFAULT 'unpaid',
  amountPaid      REAL,
  paymentMethod   TEXT,
  photoIds        TEXT,
  customFields    TEXT,
  notes           TEXT,
  cancelledAt     TEXT,
  cancelReason    TEXT,
  googleEventId   TEXT,
  createdAt       TEXT NOT NULL
);
-- The hot path: availability asks "what is booked on this day?" once per
-- candidate day across the whole booking window.
CREATE INDEX IF NOT EXISTS idx_bookings_date_status ON bookings(date, status);
CREATE INDEX IF NOT EXISTS idx_bookings_client      ON bookings(clientId);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_ref  ON bookings(reference);

CREATE TABLE IF NOT EXISTS users (
  id           TEXT PRIMARY KEY,
  email        TEXT NOT NULL,
  name         TEXT NOT NULL,
  role         TEXT NOT NULL,
  passwordHash TEXT NOT NULL,
  passwordSalt TEXT NOT NULL,
  createdAt    TEXT NOT NULL,
  lastLoginAt  TEXT
);
-- Enforces "one account per email" in the database rather than trusting the
-- application to check first.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS sessions (
  token     TEXT PRIMARY KEY,
  userId    TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  expiresAt TEXT NOT NULL,
  userAgent TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user    ON sessions(userId);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expiresAt);

CREATE TABLE IF NOT EXISTS services (
  id              TEXT PRIMARY KEY,
  title           TEXT NOT NULL,
  subtitle        TEXT NOT NULL,
  priceValue      REAL NOT NULL,
  durationMinutes INTEGER NOT NULL,
  features        TEXT NOT NULL DEFAULT '[]',
  description     TEXT NOT NULL DEFAULT '',
  active          INTEGER NOT NULL DEFAULT 1,
  sortOrder       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS addOns (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  detail          TEXT NOT NULL,
  price           REAL NOT NULL,
  durationMinutes INTEGER NOT NULL,
  active          INTEGER NOT NULL DEFAULT 1,
  sortOrder       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS coupons (
  id        TEXT PRIMARY KEY,
  code      TEXT NOT NULL,
  type      TEXT NOT NULL,
  value     REAL NOT NULL,
  active    INTEGER NOT NULL DEFAULT 1,
  timesUsed INTEGER NOT NULL DEFAULT 0,
  maxUses   INTEGER,
  expiresAt TEXT,
  createdAt TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_coupons_code ON coupons(code COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS photos (
  id        TEXT PRIMARY KEY,
  bookingId TEXT,
  clientId  TEXT,
  kind      TEXT NOT NULL,
  mime      TEXT NOT NULL,
  size      INTEGER NOT NULL,
  caption   TEXT,
  createdAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_photos_booking ON photos(bookingId);
CREATE INDEX IF NOT EXISTS idx_photos_client  ON photos(clientId);

CREATE TABLE IF NOT EXISTS emailRules (
  id          TEXT PRIMARY KEY,
  trigger     TEXT,
  name        TEXT,
  custom      INTEGER NOT NULL DEFAULT 0,
  enabled     INTEGER NOT NULL DEFAULT 1,
  subject     TEXT NOT NULL,
  body        TEXT NOT NULL,
  offsetHours INTEGER NOT NULL DEFAULT 0,
  seq         INTEGER
);

CREATE TABLE IF NOT EXISTS emailLog (
  id        TEXT PRIMARY KEY,
  seq       INTEGER,
  "to"      TEXT NOT NULL,
  subject   TEXT NOT NULL,
  trigger   TEXT NOT NULL,
  status    TEXT NOT NULL,
  error     TEXT,
  bookingId TEXT,
  createdAt TEXT NOT NULL
);
-- Backs hasEmailBeenSent(), which runs before every automated send.
CREATE INDEX IF NOT EXISTS idx_emaillog_booking ON emailLog(bookingId, trigger, status);
CREATE INDEX IF NOT EXISTS idx_emaillog_seq     ON emailLog(seq DESC);

CREATE TABLE IF NOT EXISTS formFields (
  id              TEXT PRIMARY KEY,
  label           TEXT NOT NULL,
  type            TEXT NOT NULL,
  required        INTEGER NOT NULL DEFAULT 0,
  placeholder     TEXT,
  helpText        TEXT,
  options         TEXT NOT NULL DEFAULT '[]',
  onlyForServices TEXT NOT NULL DEFAULT '[]',
  active          INTEGER NOT NULL DEFAULT 1,
  sortOrder       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS gallery (
  id             TEXT PRIMARY KEY,
  label          TEXT NOT NULL,
  beforePhotoId  TEXT NOT NULL,
  afterPhotoId   TEXT NOT NULL,
  sortOrder      INTEGER NOT NULL DEFAULT 0,
  active         INTEGER NOT NULL DEFAULT 1
);

-- Settings are key/value rather than one wide row: adding a new setting is
-- then a code change only, never a schema migration.
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agents (
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  email     TEXT NOT NULL DEFAULT '',
  phone     TEXT NOT NULL DEFAULT '',
  title     TEXT NOT NULL DEFAULT '',
  payType   TEXT NOT NULL DEFAULT 'none',
  payRate   REAL NOT NULL DEFAULT 0,
  color     TEXT NOT NULL DEFAULT '#38bdf8',
  userId    TEXT,
  notes     TEXT,
  active    INTEGER NOT NULL DEFAULT 1,
  sortOrder INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS locations (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL DEFAULT 'zone',
  address    TEXT NOT NULL DEFAULT '',
  city       TEXT NOT NULL DEFAULT '',
  postalCode TEXT NOT NULL DEFAULT '',
  travelFee  REAL NOT NULL DEFAULT 0,
  radiusKm   REAL NOT NULL DEFAULT 0,
  notes      TEXT,
  active     INTEGER NOT NULL DEFAULT 1,
  sortOrder  INTEGER NOT NULL DEFAULT 0,
  createdAt  TEXT NOT NULL
);

-- Equipment (owned, depreciating) and consumables (bought, used up).
-- Consumables carry stock so low-stock warnings are possible.
CREATE TABLE IF NOT EXISTS assets (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  kind         TEXT NOT NULL DEFAULT 'consumable',
  category     TEXT NOT NULL DEFAULT '',
  unit         TEXT NOT NULL DEFAULT 'each',
  unitCost     REAL NOT NULL DEFAULT 0,
  quantity     REAL NOT NULL DEFAULT 0,
  reorderLevel REAL NOT NULL DEFAULT 0,
  supplier     TEXT,
  notes        TEXT,
  active       INTEGER NOT NULL DEFAULT 1,
  createdAt    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_assets_kind ON assets(kind, active);

-- The money-out ledger. The type column is what separates gross profit from
-- net: cogs is subtracted to get gross, operating and equipment come after.
CREATE TABLE IF NOT EXISTS expenses (
  id            TEXT PRIMARY KEY,
  date          TEXT NOT NULL,
  description   TEXT NOT NULL,
  category      TEXT NOT NULL DEFAULT 'Other',
  vendor        TEXT,
  type          TEXT NOT NULL DEFAULT 'operating',
  amount        REAL NOT NULL,
  quantity      REAL,
  unitCost      REAL,
  assetId       TEXT,
  bookingId     TEXT,
  paymentMethod TEXT,
  notes         TEXT,
  createdAt     TEXT NOT NULL
);
-- Customer reviews shown on the homepage. Editable so the marketing copy
-- isn't frozen in the source.
CREATE TABLE IF NOT EXISTS testimonials (
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  vehicle   TEXT NOT NULL DEFAULT '',
  rating    INTEGER NOT NULL DEFAULT 5,
  text      TEXT NOT NULL,
  active    INTEGER NOT NULL DEFAULT 1,
  sortOrder INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL
);

-- Homepage FAQ. Editable so the answers can change without a deploy.
CREATE TABLE IF NOT EXISTS faqs (
  id        TEXT PRIMARY KEY,
  question  TEXT NOT NULL,
  answer    TEXT NOT NULL,
  active    INTEGER NOT NULL DEFAULT 1,
  sortOrder INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL
);

-- Who redeemed which coupon. The timesUsed counter can answer "how many
-- times", never "has this customer already used it", which is what a
-- one-per-customer code needs. Email is stored lowercased so casing cannot
-- be used to spend a code twice. (No backticks in here: this whole schema is
-- one template literal.)
CREATE TABLE IF NOT EXISTS couponRedemptions (
  id        TEXT PRIMARY KEY,
  couponId  TEXT NOT NULL,
  email     TEXT NOT NULL,
  bookingId TEXT NOT NULL DEFAULT '',
  createdAt TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_redemption_lookup ON couponRedemptions(couponId, email);

-- Time off. Days or part-days you are not available, set from the admin.
-- Without this the only way to block time was an event in Google Calendar,
-- which is useless before Google is connected and unavailable to anyone who
-- never connects it.
CREATE TABLE IF NOT EXISTS timeOff (
  id        TEXT PRIMARY KEY,
  startDate TEXT NOT NULL,
  endDate   TEXT NOT NULL,
  allDay    INTEGER NOT NULL DEFAULT 1,
  startTime TEXT NOT NULL DEFAULT '',
  endTime   TEXT NOT NULL DEFAULT '',
  reason    TEXT NOT NULL DEFAULT '',
  createdAt TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_timeoff_range ON timeOff(startDate, endDate);

CREATE INDEX IF NOT EXISTS idx_expenses_date    ON expenses(date DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_type    ON expenses(type);
CREATE INDEX IF NOT EXISTS idx_expenses_asset   ON expenses(assetId);
CREATE INDEX IF NOT EXISTS idx_expenses_booking ON expenses(bookingId);
`;

/**
 * Columns added to already-existing tables. `CREATE TABLE IF NOT EXISTS`
 * silently does nothing when the table is already there, so a new column on
 * an old database needs an explicit ALTER. Adding a column is safe to run
 * repeatedly because we check first.
 */
const ADDED_COLUMNS: [table: string, column: string, ddl: string][] = [
  // Self-service: an unguessable per-booking token, so a customer can open
  // their own booking from a link without an account or a login.
  ["bookings", "manageToken", "TEXT"],
  // Deposit taken at booking, and the Stripe link it was taken through.
  ["bookings", "depositAmount", "REAL NOT NULL DEFAULT 0"],
  ["bookings", "depositPaidAt", "TEXT"],
  ["bookings", "depositUrl", "TEXT"],
  ["bookings", "depositLinkId", "TEXT"],
  // Fee charged for cancelling inside the free window.
  ["bookings", "cancelFeeAmount", "REAL NOT NULL DEFAULT 0"],
  ["bookings", "cancelFeePaidAt", "TEXT"],
  ["bookings", "cancelFeeUrl", "TEXT"],
  ["bookings", "cancelFeeLinkId", "TEXT"],
  ["coupons", "oncePerCustomer", "INTEGER NOT NULL DEFAULT 0"],
  ["bookings", "agentId", "TEXT"],
  ["bookings", "locationId", "TEXT"],
  // Profile pictures. Point at a row in `photos`; initials are the fallback.
  ["users", "avatarPhotoId", "TEXT"],
  ["agents", "avatarPhotoId", "TEXT"],
  // Copy for a before/after pair, so uploaded work can carry the same detail
  // the hardcoded samples used to.
  ["gallery", "detail", "TEXT NOT NULL DEFAULT ''"],
  ["gallery", "description", "TEXT NOT NULL DEFAULT ''"],
  ["gallery", "packageLabel", "TEXT NOT NULL DEFAULT ''"],
  // Estimated product cost of delivering one job of this package. Used only
  // for the per-package margin estimate, never for the headline P&L, which
  // always comes from real recorded expenses.
  ["services", "materialCost", "REAL NOT NULL DEFAULT 0"],
];

let db: DatabaseSync | null = null;
const stmtCache = new Map<string, StatementSync>();

/** Prepared statements are cached — re-preparing on every call is the single
 *  easiest way to throw away SQLite's performance. */
function sql(query: string): StatementSync {
  let stmt = stmtCache.get(query);
  if (!stmt) {
    stmt = getDB().prepare(query);
    stmtCache.set(query, stmt);
  }
  return stmt;
}

function getDB(): DatabaseSync {
  if (db) return db;

  mkdirSync(DATA_DIR, { recursive: true });

  let handle: DatabaseSync;
  try {
    handle = new DatabaseSync(DB_FILE);
    // WAL keeps reads from blocking on a concurrent write, and survives a
    // crash mid-write by replaying the log — the durability guarantee the
    // old temp-file-and-rename dance was approximating by hand.
    handle.exec("PRAGMA journal_mode = WAL");
    handle.exec("PRAGMA synchronous = NORMAL");
    handle.exec("PRAGMA foreign_keys = ON");
    handle.exec("PRAGMA busy_timeout = 5000");
    handle.exec(SCHEMA);

    // Bring an older database up to the current column set.
    for (const [table, column, ddl] of ADDED_COLUMNS) {
      const cols = handle.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
      if (!cols.some((c) => c.name === column)) {
        handle.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
      }
    }
  } catch (err) {
    // Same principle the JSON store ended up with: never respond to an
    // unreadable database by quietly starting a blank one. That destroys
    // every booking and customer, and it already happened once here.
    throw new Error(
      `Could not open the database at ${DB_FILE} (${(err as Error).message}). ` +
        `Refusing to start with an empty store — fix or restore the file.`,
    );
  }

  db = handle;
  // Order matters. Import the old JSON store FIRST so a store being upgraded
  // keeps its own catalog, then seed only whatever is still empty. Doing it
  // the other way round would let a fresh seed win for the moment between
  // the two, and the site would briefly advertise default prices.
  importLegacyJSON();
  seedIfEmpty();
  return db;
}

function tableIsEmpty(table: string): boolean {
  const row = getDB().prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
  return row.n === 0;
}

/** First run: put the seed catalog, email rules and settings in place. */
function seedIfEmpty(): void {
  const d = db!;
  d.exec("BEGIN");
  try {
    if (tableIsEmpty("services")) {
      for (const [i, s] of DEFAULT_SERVICES.entries()) {
        d.prepare(
          `INSERT INTO services (id,title,subtitle,priceValue,durationMinutes,features,description,active,sortOrder)
           VALUES (?,?,?,?,?,?,?,1,?)`,
        ).run(
          s.id,
          s.title,
          s.subtitle,
          s.priceValue,
          s.durationMinutes,
          JSON.stringify(s.features ?? []),
          s.description ?? "",
          i,
        );
      }
    }
    if (tableIsEmpty("addOns")) {
      for (const [i, a] of DEFAULT_ADD_ONS.entries()) {
        d.prepare(
          `INSERT INTO addOns (id,name,detail,price,durationMinutes,active,sortOrder)
           VALUES (?,?,?,?,?,1,?)`,
        ).run(a.id, a.name, a.detail, a.price, a.durationMinutes, i);
      }
    }
    if (tableIsEmpty("emailRules")) {
      for (const [i, r] of DEFAULT_EMAIL_RULES.entries()) {
        d.prepare(
          `INSERT INTO emailRules (id,trigger,name,custom,enabled,subject,body,offsetHours,seq)
           VALUES (?,?,?,0,?,?,?,?,?)`,
        ).run(r.id, r.trigger ?? null, r.name ?? null, r.enabled ? 1 : 0, r.subject, r.body, r.offsetHours, i);
      }
    }
    if (tableIsEmpty("settings")) {
      writeSettingsRows(DEFAULT_SETTINGS as unknown as Record<string, unknown>);
    }
    if (tableIsEmpty("faqs")) {
      const now = new Date().toISOString();
      for (const f of DEFAULT_FAQS) {
        d.prepare(
          `INSERT INTO faqs (id,question,answer,active,sortOrder,createdAt)
           VALUES (?,?,?,?,?,?)`,
        ).run(f.id, f.question, f.answer, f.active ? 1 : 0, f.sortOrder, now);
      }
    }
    if (tableIsEmpty("testimonials")) {
      const now = new Date().toISOString();
      for (const t of DEFAULT_TESTIMONIALS) {
        d.prepare(
          `INSERT INTO testimonials (id,name,vehicle,rating,text,active,sortOrder,createdAt)
           VALUES (?,?,?,?,?,?,?,?)`,
        ).run(t.id, t.name, t.vehicle, t.rating, t.text, t.active ? 1 : 0, t.sortOrder, now);
      }
    }
    d.exec("COMMIT");
  } catch (err) {
    d.exec("ROLLBACK");
    throw err;
  }
}

/**
 * Run a set of statements as one unit. node:sqlite is synchronous and Node is
 * single-threaded, so nothing can interleave inside `fn` — which is exactly
 * why the JSON store's hand-rolled write-queue mutex is no longer needed.
 * Do not `await` inside `fn`; that would break the guarantee.
 */
function tx<T>(fn: () => T): T {
  const d = getDB();
  d.exec("BEGIN IMMEDIATE");
  try {
    const out = fn();
    d.exec("COMMIT");
    return out;
  } catch (err) {
    d.exec("ROLLBACK");
    throw err;
  }
}

// ---------------------------- Row mapping ------------------------------

/** SQLite has no NULL/undefined distinction; the app's types use undefined. */
function undef<T>(v: T | null): T | undefined {
  return v === null ? undefined : v;
}

function parseJSON<T>(v: string | null, fallback: T): T {
  if (v === null || v === undefined) return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
}

type Row = Record<string, any>;

/**
 * Merge a patch over a row, ignoring keys whose value is `undefined`.
 *
 * A plain `{ ...row, ...patch }` would let an optional field that happens to
 * be present-but-undefined overwrite the stored value with nothing — so
 * updateClient(id, { name: undefined }) would blank the customer's name.
 * SQLite also rejects `undefined` as a bound parameter outright, so this is
 * both a correctness and a crash fix.
 */
function merge(row: Row, patch: Record<string, unknown>): Row {
  const out: Row = { ...row };
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function toClient(r: Row): Client {
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    phone: r.phone,
    notes: undef(r.notes),
    createdAt: r.createdAt,
  };
}

function toBooking(r: Row): Booking {
  return {
    id: r.id,
    clientId: r.clientId,
    serviceId: r.serviceId,
    serviceTitle: r.serviceTitle,
    date: r.date,
    startTime: r.startTime,
    durationMinutes: r.durationMinutes,
    status: r.status,
    reference: r.reference,
    addOnIds: parseJSON<string[]>(r.addOnIds, []),
    addOnTitles: parseJSON<string[]>(r.addOnTitles, []),
    location: r.location,
    address: undef(r.address),
    vehicle: r.vehicle ? parseJSON<Vehicle | undefined>(r.vehicle, undefined) : undefined,
    totalPrice: r.totalPrice,
    tip: undef(r.tip),
    discount: undef(r.discount),
    paymentStatus: r.paymentStatus,
    amountPaid: undef(r.amountPaid),
    paymentMethod: undef(r.paymentMethod),
    photoIds: r.photoIds ? parseJSON<string[]>(r.photoIds, []) : undefined,
    customFields: r.customFields
      ? parseJSON<Record<string, string> | undefined>(r.customFields, undefined)
      : undefined,
    notes: undef(r.notes),
    cancelledAt: undef(r.cancelledAt),
    cancelReason: undef(r.cancelReason),
    googleEventId: undef(r.googleEventId),
    manageToken: undef(r.manageToken),
    depositAmount: r.depositAmount || undefined,
    depositPaidAt: undef(r.depositPaidAt),
    depositUrl: undef(r.depositUrl),
    depositLinkId: undef(r.depositLinkId),
    cancelFeeAmount: r.cancelFeeAmount || undefined,
    cancelFeePaidAt: undef(r.cancelFeePaidAt),
    cancelFeeUrl: undef(r.cancelFeeUrl),
    cancelFeeLinkId: undef(r.cancelFeeLinkId),
    agentId: undef(r.agentId),
    locationId: undef(r.locationId),
    createdAt: r.createdAt,
  };
}

function toUser(r: Row): User {
  return {
    id: r.id,
    email: r.email,
    name: r.name,
    role: r.role,
    passwordHash: r.passwordHash,
    passwordSalt: r.passwordSalt,
    createdAt: r.createdAt,
    lastLoginAt: undef(r.lastLoginAt),
    avatarPhotoId: undef(r.avatarPhotoId),
  };
}

function toSession(r: Row): Session {
  return {
    token: r.token,
    userId: r.userId,
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
    userAgent: undef(r.userAgent),
  };
}

function toService(r: Row): ServiceRecord {
  return {
    id: r.id,
    title: r.title,
    subtitle: r.subtitle,
    priceValue: r.priceValue,
    durationMinutes: r.durationMinutes,
    features: parseJSON<string[]>(r.features, []),
    description: r.description ?? "",
    active: !!r.active,
    sortOrder: r.sortOrder,
    materialCost: r.materialCost ?? 0,
  };
}

function toAddOn(r: Row): AddOnRecord {
  return {
    id: r.id,
    name: r.name,
    detail: r.detail,
    price: r.price,
    durationMinutes: r.durationMinutes,
    active: !!r.active,
    sortOrder: r.sortOrder,
  };
}

function toCoupon(r: Row): Coupon {
  return {
    id: r.id,
    code: r.code,
    type: r.type,
    value: r.value,
    active: !!r.active,
    timesUsed: r.timesUsed,
    maxUses: undef(r.maxUses),
    oncePerCustomer: !!r.oncePerCustomer,
    expiresAt: undef(r.expiresAt),
    createdAt: r.createdAt,
  };
}

function toPhoto(r: Row): Photo {
  return {
    id: r.id,
    bookingId: undef(r.bookingId),
    clientId: undef(r.clientId),
    kind: r.kind,
    mime: r.mime,
    size: r.size,
    caption: undef(r.caption),
    createdAt: r.createdAt,
  };
}

function toEmailRule(r: Row): EmailRule {
  const rule: EmailRule = {
    id: r.id,
    enabled: !!r.enabled,
    subject: r.subject,
    body: r.body,
    offsetHours: r.offsetHours,
  };
  // Mirror the JSON store, where these keys were simply absent on built-ins.
  if (r.trigger != null) rule.trigger = r.trigger;
  if (r.name != null) rule.name = r.name;
  if (r.custom) rule.custom = true;
  return rule;
}

function toEmailLog(r: Row): EmailLogEntry {
  return {
    id: r.id,
    to: r.to,
    subject: r.subject,
    trigger: r.trigger,
    status: r.status,
    error: undef(r.error),
    bookingId: undef(r.bookingId),
    createdAt: r.createdAt,
  };
}

function toFormField(r: Row): FormField {
  return {
    id: r.id,
    label: r.label,
    type: r.type,
    required: !!r.required,
    placeholder: undef(r.placeholder),
    helpText: undef(r.helpText),
    options: parseJSON<string[]>(r.options, []),
    onlyForServices: parseJSON<string[]>(r.onlyForServices, []),
    active: !!r.active,
    sortOrder: r.sortOrder,
  };
}

function toGalleryPair(r: Row): GalleryPair {
  return {
    id: r.id,
    label: r.label,
    beforePhotoId: r.beforePhotoId,
    afterPhotoId: r.afterPhotoId,
    sortOrder: r.sortOrder,
    active: !!r.active,
    detail: r.detail ?? "",
    description: r.description ?? "",
    packageLabel: r.packageLabel ?? "",
  };
}

function toFaq(r: Row): Faq {
  return {
    id: r.id,
    question: r.question,
    answer: r.answer,
    active: !!r.active,
    sortOrder: r.sortOrder,
    createdAt: r.createdAt,
  };
}

function toTestimonial(r: Row): Testimonial {
  return {
    id: r.id,
    name: r.name,
    vehicle: r.vehicle ?? "",
    rating: r.rating ?? 5,
    text: r.text,
    active: !!r.active,
    sortOrder: r.sortOrder,
    createdAt: r.createdAt,
  };
}

// ---------------------------- Users -----------------------------------

export async function countUsers(): Promise<number> {
  return (sql("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n;
}

export async function listUsers(): Promise<User[]> {
  return (sql("SELECT * FROM users ORDER BY createdAt ASC").all() as Row[]).map(toUser);
}

export async function findUserByEmail(email: string): Promise<User | undefined> {
  const row = sql("SELECT * FROM users WHERE email = ? COLLATE NOCASE").get(email) as Row | undefined;
  return row ? toUser(row) : undefined;
}

export async function findUserById(id: string): Promise<User | undefined> {
  const row = sql("SELECT * FROM users WHERE id = ?").get(id) as Row | undefined;
  return row ? toUser(row) : undefined;
}

export async function createUser(input: {
  email: string;
  name: string;
  role: UserRole;
  passwordHash: string;
  passwordSalt: string;
}): Promise<User> {
  return tx(() => {
    const existing = sql("SELECT id FROM users WHERE email = ? COLLATE NOCASE").get(input.email);
    if (existing) throw new Error("An account with that email already exists.");
    const user: User = {
      id: randomUUID(),
      email: input.email.toLowerCase(),
      name: input.name,
      role: input.role,
      passwordHash: input.passwordHash,
      passwordSalt: input.passwordSalt,
      createdAt: new Date().toISOString(),
    };
    sql(
      `INSERT INTO users (id,email,name,role,passwordHash,passwordSalt,createdAt)
       VALUES (?,?,?,?,?,?,?)`,
    ).run(user.id, user.email, user.name, user.role, user.passwordHash, user.passwordSalt, user.createdAt);
    return user;
  });
}

export async function updateUserPassword(
  userId: string,
  passwordHash: string,
  passwordSalt: string,
): Promise<void> {
  tx(() => {
    sql("UPDATE users SET passwordHash = ?, passwordSalt = ? WHERE id = ?").run(
      passwordHash,
      passwordSalt,
      userId,
    );
    // Changing a password invalidates every other session for that user.
    sql("DELETE FROM sessions WHERE userId = ?").run(userId);
  });
}

export async function updateUserProfile(
  userId: string,
  patch: { name?: string; email?: string },
): Promise<User | undefined> {
  return tx(() => {
    const row = sql("SELECT * FROM users WHERE id = ?").get(userId) as Row | undefined;
    if (!row) return undefined;
    if (patch.email) {
      const clash = sql(
        "SELECT id FROM users WHERE id != ? AND email = ? COLLATE NOCASE",
      ).get(userId, patch.email.toLowerCase());
      if (clash) throw new Error("That email is already in use.");
    }
    const name = patch.name ? patch.name : row.name;
    const email = patch.email ? patch.email.toLowerCase() : row.email;
    sql("UPDATE users SET name = ?, email = ? WHERE id = ?").run(name, email, userId);
    return toUser({ ...row, name, email });
  });
}

export async function touchUserLogin(userId: string): Promise<void> {
  sql("UPDATE users SET lastLoginAt = ? WHERE id = ?").run(new Date().toISOString(), userId);
}

export async function updateUserRole(userId: string, role: UserRole): Promise<User | undefined> {
  return tx(() => {
    const row = sql("SELECT * FROM users WHERE id = ?").get(userId) as Row | undefined;
    if (!row) return undefined;
    // Never leave the shop without an owner — that would lock everyone out
    // of team management permanently.
    if (row.role === "owner" && role !== "owner") {
      const { n } = sql("SELECT COUNT(*) AS n FROM users WHERE role = 'owner'").get() as { n: number };
      if (n <= 1) throw new Error("There must be at least one owner.");
    }
    sql("UPDATE users SET role = ? WHERE id = ?").run(role, userId);
    return toUser({ ...row, role });
  });
}

export async function deleteUser(userId: string): Promise<void> {
  tx(() => {
    const row = sql("SELECT role FROM users WHERE id = ?").get(userId) as Row | undefined;
    if (!row) return;
    if (row.role === "owner") {
      const { n } = sql("SELECT COUNT(*) AS n FROM users WHERE role = 'owner'").get() as { n: number };
      if (n <= 1) throw new Error("You can't remove the last owner.");
    }
    sql("DELETE FROM users WHERE id = ?").run(userId);
    // Sign them out everywhere immediately.
    sql("DELETE FROM sessions WHERE userId = ?").run(userId);
  });
}

export async function adminSetUserPassword(
  userId: string,
  passwordHash: string,
  passwordSalt: string,
): Promise<void> {
  tx(() => {
    const row = sql("SELECT id FROM users WHERE id = ?").get(userId);
    if (!row) return;
    sql("UPDATE users SET passwordHash = ?, passwordSalt = ? WHERE id = ?").run(
      passwordHash,
      passwordSalt,
      userId,
    );
    sql("DELETE FROM sessions WHERE userId = ?").run(userId);
  });
}

// --------------------------- Sessions ---------------------------------

export async function createSession(input: {
  token: string;
  userId: string;
  expiresAt: string;
  userAgent?: string;
}): Promise<Session> {
  return tx(() => {
    // Opportunistically drop expired rows so the table doesn't grow forever.
    sql("DELETE FROM sessions WHERE expiresAt <= ?").run(new Date().toISOString());
    const session: Session = {
      token: input.token,
      userId: input.userId,
      createdAt: new Date().toISOString(),
      expiresAt: input.expiresAt,
      userAgent: input.userAgent,
    };
    sql(
      "INSERT INTO sessions (token,userId,createdAt,expiresAt,userAgent) VALUES (?,?,?,?,?)",
    ).run(session.token, session.userId, session.createdAt, session.expiresAt, session.userAgent ?? null);
    return session;
  });
}

export async function findSession(token: string): Promise<Session | undefined> {
  const row = sql("SELECT * FROM sessions WHERE token = ?").get(token) as Row | undefined;
  if (!row) return undefined;
  if (new Date(row.expiresAt).getTime() <= Date.now()) return undefined;
  return toSession(row);
}

export async function deleteSession(token: string): Promise<void> {
  sql("DELETE FROM sessions WHERE token = ?").run(token);
}

export async function listSessionsForUser(userId: string): Promise<Session[]> {
  const rows = sql(
    "SELECT * FROM sessions WHERE userId = ? AND expiresAt > ? ORDER BY createdAt DESC",
  ).all(userId, new Date().toISOString()) as Row[];
  return rows.map(toSession);
}

// ---------------------------- Clients --------------------------------

export async function listClients(): Promise<Client[]> {
  return (sql("SELECT * FROM clients ORDER BY createdAt DESC").all() as Row[]).map(toClient);
}

export async function findClientById(id: string): Promise<Client | undefined> {
  const row = sql("SELECT * FROM clients WHERE id = ?").get(id) as Row | undefined;
  return row ? toClient(row) : undefined;
}

export async function findOrCreateClient(input: {
  name: string;
  email: string;
  phone: string;
}): Promise<Client> {
  return tx(() => {
    const existing = sql("SELECT * FROM clients WHERE email = ? COLLATE NOCASE").get(
      input.email,
    ) as Row | undefined;
    if (existing) {
      sql("UPDATE clients SET name = ?, phone = ? WHERE id = ?").run(
        input.name,
        input.phone,
        existing.id,
      );
      return toClient({ ...existing, name: input.name, phone: input.phone });
    }
    const client: Client = {
      id: randomUUID(),
      name: input.name,
      email: input.email,
      phone: input.phone,
      createdAt: new Date().toISOString(),
    };
    sql("INSERT INTO clients (id,name,email,phone,notes,createdAt) VALUES (?,?,?,?,NULL,?)").run(
      client.id,
      client.name,
      client.email,
      client.phone,
      client.createdAt,
    );
    return client;
  });
}

export async function addClientManual(input: {
  name: string;
  email: string;
  phone: string;
  notes?: string;
}): Promise<Client> {
  const client: Client = {
    id: randomUUID(),
    name: input.name,
    email: input.email,
    phone: input.phone,
    notes: input.notes,
    createdAt: new Date().toISOString(),
  };
  sql("INSERT INTO clients (id,name,email,phone,notes,createdAt) VALUES (?,?,?,?,?,?)").run(
    client.id,
    client.name,
    client.email,
    client.phone,
    client.notes ?? null,
    client.createdAt,
  );
  return client;
}

export async function updateClient(
  id: string,
  patch: { name?: string; email?: string; phone?: string; notes?: string },
): Promise<Client | undefined> {
  return tx(() => {
    const row = sql("SELECT * FROM clients WHERE id = ?").get(id) as Row | undefined;
    if (!row) return undefined;
    const next = merge(row, patch);
    sql("UPDATE clients SET name = ?, email = ?, phone = ?, notes = ? WHERE id = ?").run(
      next.name,
      next.email,
      next.phone,
      next.notes ?? null,
      id,
    );
    return toClient(next);
  });
}

export async function deleteClient(id: string): Promise<void> {
  sql("DELETE FROM clients WHERE id = ?").run(id);
}

// ---------------------------- Bookings --------------------------------

const BOOKING_COLUMNS = `id,clientId,serviceId,serviceTitle,date,startTime,durationMinutes,status,
  reference,addOnIds,addOnTitles,location,address,vehicle,totalPrice,tip,discount,paymentStatus,
  amountPaid,paymentMethod,photoIds,customFields,notes,cancelledAt,cancelReason,googleEventId,
  manageToken,createdAt`;

export async function listBookings(): Promise<Booking[]> {
  const rows = sql(
    "SELECT * FROM bookings ORDER BY date ASC, startTime ASC",
  ).all() as Row[];
  return rows.map(toBooking);
}

/**
 * Bookings that occupy time on `date`. Cancelled bookings are excluded, which
 * is precisely what frees the slot again when an admin cancels one.
 */
export async function listBookingsForDate(date: string): Promise<Booking[]> {
  const rows = sql(
    "SELECT * FROM bookings WHERE date = ? AND status != 'cancelled'",
  ).all(date) as Row[];
  return rows.map(toBooking);
}

export async function findBookingById(id: string): Promise<Booking | undefined> {
  const row = sql("SELECT * FROM bookings WHERE id = ?").get(id) as Row | undefined;
  return row ? toBooking(row) : undefined;
}

/** Customer-facing reference. Short and readable over the phone. */
function makeReference(): string {
  return `DBN-${Math.floor(1000 + Math.random() * 9000)}`;
}

export async function addBooking(input: {
  clientId: string;
  serviceId: string;
  serviceTitle: string;
  date: string;
  startTime: string;
  durationMinutes: number;
  addOnIds: string[];
  addOnTitles: string[];
  location: LocationChoice;
  address?: string;
  vehicle?: Vehicle;
  totalPrice: number;
  /** Amount taken off by a coupon. Stored so the invoice can show it. */
  discount?: number;
  notes?: string;
  googleEventId?: string;
}): Promise<Booking> {
  return tx(() => {
    // Keep references unique within the store so two customers never quote
    // the same one back to you. The UNIQUE index is the real guarantee; this
    // just avoids the collision in the first place.
    let reference = makeReference();
    while (sql("SELECT 1 FROM bookings WHERE reference = ?").get(reference)) {
      reference = makeReference();
    }

    const booking: Booking = {
      id: randomUUID(),
      clientId: input.clientId,
      serviceId: input.serviceId,
      serviceTitle: input.serviceTitle,
      date: input.date,
      startTime: input.startTime,
      durationMinutes: input.durationMinutes,
      status: "confirmed",
      paymentStatus: "unpaid",
      reference,
      addOnIds: input.addOnIds,
      addOnTitles: input.addOnTitles,
      location: input.location,
      address: input.address,
      vehicle: input.vehicle,
      totalPrice: input.totalPrice,
      discount: input.discount,
      notes: input.notes,
      googleEventId: input.googleEventId,
      // 24 bytes of randomness, base64url. Long enough that guessing one is
      // not a threat, short enough to survive being pasted into an email.
      manageToken: randomBytes(24).toString("base64url"),
      createdAt: new Date().toISOString(),
    };

    sql(
      `INSERT INTO bookings (${BOOKING_COLUMNS})
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      booking.id,
      booking.clientId,
      booking.serviceId,
      booking.serviceTitle,
      booking.date,
      booking.startTime,
      booking.durationMinutes,
      booking.status,
      booking.reference,
      JSON.stringify(booking.addOnIds),
      JSON.stringify(booking.addOnTitles),
      booking.location,
      booking.address ?? null,
      booking.vehicle ? JSON.stringify(booking.vehicle) : null,
      booking.totalPrice,
      null,
      booking.discount ?? null,
      booking.paymentStatus,
      null,
      null,
      null,
      null,
      booking.notes ?? null,
      null,
      null,
      booking.googleEventId ?? null,
      booking.manageToken ?? null,
      booking.createdAt,
    );
    return booking;
  });
}

/** Look a booking up by its customer-facing token. */
export async function findBookingByToken(token: string): Promise<Booking | undefined> {
  if (!token) return undefined;
  const row = sql("SELECT * FROM bookings WHERE manageToken = ?").get(token) as Row | undefined;
  return row ? toBooking(row) : undefined;
}

/**
 * Give an older booking a manage token. Bookings made before self-service
 * existed have none, so their confirmation links would otherwise 404.
 */
export async function ensureManageToken(bookingId: string): Promise<string | undefined> {
  return tx(() => {
    const row = sql("SELECT * FROM bookings WHERE id = ?").get(bookingId) as Row | undefined;
    if (!row) return undefined;
    if (row.manageToken) return String(row.manageToken);
    const token = randomBytes(24).toString("base64url");
    sql("UPDATE bookings SET manageToken = ? WHERE id = ?").run(token, bookingId);
    return token;
  });
}

/** Record the deposit or cancellation-fee state on a booking. */
export async function updateBookingCharges(
  bookingId: string,
  patch: Partial<
    Pick<
      Booking,
      | "depositAmount"
      | "depositPaidAt"
      | "depositUrl"
      | "depositLinkId"
      | "cancelFeeAmount"
      | "cancelFeePaidAt"
      | "cancelFeeUrl"
      | "cancelFeeLinkId"
    >
  >,
): Promise<Booking | undefined> {
  return tx(() => {
    const row = sql("SELECT * FROM bookings WHERE id = ?").get(bookingId) as Row | undefined;
    if (!row) return undefined;
    const next = merge(row, patch);
    sql(
      `UPDATE bookings SET depositAmount = ?, depositPaidAt = ?, depositUrl = ?,
         depositLinkId = ?, cancelFeeAmount = ?, cancelFeePaidAt = ?,
         cancelFeeUrl = ?, cancelFeeLinkId = ? WHERE id = ?`,
    ).run(
      next.depositAmount ?? 0,
      next.depositPaidAt ?? null,
      next.depositUrl ?? null,
      next.depositLinkId ?? null,
      next.cancelFeeAmount ?? 0,
      next.cancelFeePaidAt ?? null,
      next.cancelFeeUrl ?? null,
      next.cancelFeeLinkId ?? null,
      bookingId,
    );
    return toBooking(next);
  });
}

export async function updateBookingStatus(
  bookingId: string,
  status: BookingStatus,
  reason?: string,
): Promise<Booking | undefined> {
  return tx(() => {
    const row = sql("SELECT * FROM bookings WHERE id = ?").get(bookingId) as Row | undefined;
    if (!row) return undefined;
    const cancelledAt = status === "cancelled" ? new Date().toISOString() : null;
    const cancelReason = status === "cancelled" ? (reason ?? null) : null;
    sql("UPDATE bookings SET status = ?, cancelledAt = ?, cancelReason = ? WHERE id = ?").run(
      status,
      cancelledAt,
      cancelReason,
      bookingId,
    );
    return toBooking({ ...row, status, cancelledAt, cancelReason });
  });
}

/** Move a booking to a new date/time. Caller must verify the slot is free. */
export async function rescheduleBooking(
  bookingId: string,
  date: string,
  startTime: string,
  googleEventId?: string,
): Promise<Booking | undefined> {
  return tx(() => {
    const row = sql("SELECT * FROM bookings WHERE id = ?").get(bookingId) as Row | undefined;
    if (!row) return undefined;
    const eventId = googleEventId !== undefined ? googleEventId : row.googleEventId;
    sql("UPDATE bookings SET date = ?, startTime = ?, googleEventId = ? WHERE id = ?").run(
      date,
      startTime,
      eventId ?? null,
      bookingId,
    );
    return toBooking({ ...row, date, startTime, googleEventId: eventId ?? null });
  });
}

/**
 * Point a booking at its Google Calendar event, or clear the link.
 *
 * Clearing matters: a cancelled booking whose event was deleted must not keep
 * a stale id, or the reschedule logic and the admin calendar's de-duplication
 * both go looking for an event that no longer exists.
 */
export async function setBookingGoogleEventId(
  bookingId: string,
  googleEventId: string | null,
): Promise<void> {
  sql("UPDATE bookings SET googleEventId = ? WHERE id = ?").run(googleEventId, bookingId);
}

export async function deleteBooking(id: string): Promise<void> {
  sql("DELETE FROM bookings WHERE id = ?").run(id);
}

/**
 * Edit the contents of a booking — what's being done, where, to which car,
 * and for how much. Date and time are deliberately NOT here: moving a
 * booking has to re-check slot availability, which is rescheduleBooking's
 * job.
 */
export async function updateBookingDetails(
  bookingId: string,
  patch: {
    serviceId: string;
    serviceTitle: string;
    addOnIds: string[];
    addOnTitles: string[];
    location: LocationChoice;
    address?: string;
    vehicle?: Vehicle;
    notes?: string;
    totalPrice: number;
    durationMinutes: number;
  },
): Promise<Booking | undefined> {
  return tx(() => {
    const row = sql("SELECT * FROM bookings WHERE id = ?").get(bookingId) as Row | undefined;
    if (!row) return undefined;

    sql(
      `UPDATE bookings SET serviceId = ?, serviceTitle = ?, addOnIds = ?, addOnTitles = ?,
              location = ?, address = ?, vehicle = ?, notes = ?, totalPrice = ?,
              durationMinutes = ?
        WHERE id = ?`,
    ).run(
      patch.serviceId,
      patch.serviceTitle,
      JSON.stringify(patch.addOnIds),
      JSON.stringify(patch.addOnTitles),
      patch.location,
      patch.address ?? null,
      patch.vehicle ? JSON.stringify(patch.vehicle) : null,
      patch.notes ?? null,
      patch.totalPrice,
      patch.durationMinutes,
      bookingId,
    );

    return toBooking({
      ...row,
      serviceId: patch.serviceId,
      serviceTitle: patch.serviceTitle,
      addOnIds: JSON.stringify(patch.addOnIds),
      addOnTitles: JSON.stringify(patch.addOnTitles),
      location: patch.location,
      address: patch.address ?? null,
      vehicle: patch.vehicle ? JSON.stringify(patch.vehicle) : null,
      notes: patch.notes ?? null,
      totalPrice: patch.totalPrice,
      durationMinutes: patch.durationMinutes,
    });
  });
}

export async function listBookingsWithClients(): Promise<
  (Booking & { client: Client | undefined })[]
> {
  // One join instead of an O(bookings × clients) lookup per row.
  const rows = sql(
    `SELECT b.*,
            c.id AS c_id, c.name AS c_name, c.email AS c_email,
            c.phone AS c_phone, c.notes AS c_notes, c.createdAt AS c_createdAt
       FROM bookings b
       LEFT JOIN clients c ON c.id = b.clientId
      ORDER BY b.date DESC, b.startTime DESC`,
  ).all() as Row[];

  return rows.map((r) => ({
    ...toBooking(r),
    client: r.c_id
      ? toClient({
          id: r.c_id,
          name: r.c_name,
          email: r.c_email,
          phone: r.c_phone,
          notes: r.c_notes,
          createdAt: r.c_createdAt,
        })
      : undefined,
  }));
}

// ---------------------------- Catalog ---------------------------------

export async function listServices(): Promise<ServiceRecord[]> {
  return (sql("SELECT * FROM services ORDER BY sortOrder ASC").all() as Row[]).map(toService);
}

export async function upsertService(input: ServiceRecord): Promise<ServiceRecord> {
  sql(
    `INSERT INTO services (id,title,subtitle,priceValue,durationMinutes,features,description,active,sortOrder,materialCost)
     VALUES (?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET
       title=excluded.title, subtitle=excluded.subtitle, priceValue=excluded.priceValue,
       durationMinutes=excluded.durationMinutes, features=excluded.features,
       description=excluded.description, active=excluded.active, sortOrder=excluded.sortOrder,
       materialCost=excluded.materialCost`,
  ).run(
    input.id,
    input.title,
    input.subtitle,
    input.priceValue,
    input.durationMinutes,
    JSON.stringify(input.features ?? []),
    input.description ?? "",
    input.active ? 1 : 0,
    input.sortOrder,
    input.materialCost ?? 0,
  );
  return input;
}

export async function deleteService(id: string): Promise<void> {
  sql("DELETE FROM services WHERE id = ?").run(id);
}

export async function listAddOns(): Promise<AddOnRecord[]> {
  return (sql("SELECT * FROM addOns ORDER BY sortOrder ASC").all() as Row[]).map(toAddOn);
}

export async function upsertAddOn(input: AddOnRecord): Promise<AddOnRecord> {
  sql(
    `INSERT INTO addOns (id,name,detail,price,durationMinutes,active,sortOrder)
     VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET
       name=excluded.name, detail=excluded.detail, price=excluded.price,
       durationMinutes=excluded.durationMinutes, active=excluded.active,
       sortOrder=excluded.sortOrder`,
  ).run(
    input.id,
    input.name,
    input.detail,
    input.price,
    input.durationMinutes,
    input.active ? 1 : 0,
    input.sortOrder,
  );
  return input;
}

export async function deleteAddOn(id: string): Promise<void> {
  sql("DELETE FROM addOns WHERE id = ?").run(id);
}

// ---------------------------- Settings --------------------------------

/** Every value is JSON-encoded so numbers, arrays and booleans round-trip. */
function writeSettingsRows(patch: Record<string, unknown>): void {
  const stmt = getDB().prepare(
    "INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
  );
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    stmt.run(key, JSON.stringify(value));
  }
}

function readSettingsRows(): Partial<Settings> {
  const rows = sql("SELECT key, value FROM settings").all() as Row[];
  const out: Record<string, unknown> = {};
  for (const r of rows) out[r.key] = parseJSON<unknown>(r.value, undefined);
  return out as Partial<Settings>;
}

/**
 * Older stores only had a single openHour/closeHour plus closedDays. Build a
 * weekly schedule from those so nobody's hours silently change on upgrade.
 */
function migrateSettings(settings: Settings, stored: Partial<Settings>): Settings {
  const valid = (w: unknown): w is WeekSchedule =>
    Array.isArray(w) && w.length === 7 && w.every((d) => d && typeof d.openHour === "number");

  if (!valid(stored.weeklySchedule)) {
    settings.weeklySchedule = defaultWeek(
      stored.openHour ?? settings.openHour,
      stored.closeHour ?? settings.closeHour,
      stored.closedDays ?? settings.closedDays ?? [0],
    );
  }
  if (!valid(stored.mobileSchedule)) {
    settings.mobileSchedule = settings.weeklySchedule.map((d) => ({ ...d }));
  }
  return settings;
}

export async function getSettings(): Promise<Settings> {
  const stored = readSettingsRows();
  return migrateSettings({ ...DEFAULT_SETTINGS, ...stored }, stored);
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  return tx(() => {
    writeSettingsRows(patch as Record<string, unknown>);
    const stored = readSettingsRows();
    return migrateSettings({ ...DEFAULT_SETTINGS, ...stored }, stored);
  });
}

// ---------------------------- Coupons ---------------------------------

export async function listCoupons(): Promise<Coupon[]> {
  return (sql("SELECT * FROM coupons ORDER BY createdAt DESC").all() as Row[]).map(toCoupon);
}

export async function findCouponByCode(code: string): Promise<Coupon | undefined> {
  const row = sql("SELECT * FROM coupons WHERE code = ? COLLATE NOCASE").get(code) as Row | undefined;
  return row ? toCoupon(row) : undefined;
}

export async function upsertCoupon(
  input: Omit<Coupon, "createdAt"> & { createdAt?: string },
): Promise<Coupon> {
  return tx(() => {
    const record: Coupon = {
      ...input,
      code: input.code.toUpperCase(),
      createdAt: input.createdAt ?? new Date().toISOString(),
    };
    sql(
      `INSERT INTO coupons (id,code,type,value,active,timesUsed,maxUses,oncePerCustomer,expiresAt,createdAt)
       VALUES (?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         code=excluded.code, type=excluded.type, value=excluded.value,
         active=excluded.active, timesUsed=excluded.timesUsed,
         maxUses=excluded.maxUses, oncePerCustomer=excluded.oncePerCustomer,
         expiresAt=excluded.expiresAt, createdAt=excluded.createdAt`,
    ).run(
      record.id,
      record.code,
      record.type,
      record.value,
      record.active ? 1 : 0,
      record.timesUsed,
      record.maxUses ?? null,
      record.oncePerCustomer ? 1 : 0,
      record.expiresAt ?? null,
      record.createdAt,
    );
    return record;
  });
}

export async function deleteCoupon(id: string): Promise<void> {
  sql("DELETE FROM coupons WHERE id = ?").run(id);
}

/**
 * Count one redemption. Re-checks the usage cap inside the transaction so two
 * simultaneous bookings can't both take the last use of a limited code.
 * Returns false if the code is exhausted, in which case nothing was counted.
 */
/**
 * Claim one use of a coupon, recording who claimed it.
 *
 * Both caps are re-checked INSIDE the transaction, so two bookings racing
 * for the last use of a limited code cannot both win, and a customer double-
 * submitting a one-per-customer code cannot spend it twice.
 */
export async function redeemCoupon(
  id: string,
  by?: { email?: string; bookingId?: string },
): Promise<boolean> {
  return tx(() => {
    const row = sql(
      "SELECT timesUsed, maxUses, active, oncePerCustomer FROM coupons WHERE id = ?",
    ).get(id) as Row | undefined;
    if (!row || !row.active) return false;
    if (row.maxUses != null && row.timesUsed >= row.maxUses) return false;

    const email = (by?.email ?? "").trim().toLowerCase();
    if (row.oncePerCustomer) {
      // No email means we cannot tell customers apart, so a one-per-customer
      // code is refused rather than silently becoming unlimited.
      if (!email) return false;
      const seen = sql(
        "SELECT 1 FROM couponRedemptions WHERE couponId = ? AND email = ?",
      ).get(id, email);
      if (seen) return false;
    }

    sql("UPDATE coupons SET timesUsed = timesUsed + 1 WHERE id = ?").run(id);
    if (email) {
      sql(
        "INSERT INTO couponRedemptions (id,couponId,email,bookingId,createdAt) VALUES (?,?,?,?,?)",
      ).run(randomUUID(), id, email, by?.bookingId ?? "", new Date().toISOString());
    }
    return true;
  });
}

/** Has this email already redeemed this coupon? */
export async function hasRedeemedCoupon(couponId: string, email: string): Promise<boolean> {
  const clean = email.trim().toLowerCase();
  if (!clean) return false;
  return Boolean(
    sql("SELECT 1 FROM couponRedemptions WHERE couponId = ? AND email = ?").get(couponId, clean),
  );
}

// ---------------------------- Payments / tips -------------------------

export async function updateBookingPayment(
  bookingId: string,
  patch: {
    tip?: number;
    discount?: number;
    amountPaid?: number;
    paymentStatus?: PaymentStatus;
    paymentMethod?: string;
  },
): Promise<Booking | undefined> {
  return tx(() => {
    const row = sql("SELECT * FROM bookings WHERE id = ?").get(bookingId) as Row | undefined;
    if (!row) return undefined;
    const next = merge(row, patch);
    sql(
      `UPDATE bookings SET tip = ?, discount = ?, amountPaid = ?, paymentStatus = ?, paymentMethod = ?
        WHERE id = ?`,
    ).run(
      next.tip ?? null,
      next.discount ?? null,
      next.amountPaid ?? null,
      next.paymentStatus,
      next.paymentMethod ?? null,
      bookingId,
    );
    return toBooking(next);
  });
}

// ---------------------------- Photos ----------------------------------

export async function addPhoto(input: {
  id: string;
  bookingId?: string;
  clientId?: string;
  kind: Photo["kind"];
  mime: string;
  size: number;
  caption?: string;
}): Promise<Photo> {
  return tx(() => {
    const photo: Photo = { ...input, createdAt: new Date().toISOString() };
    sql(
      "INSERT INTO photos (id,bookingId,clientId,kind,mime,size,caption,createdAt) VALUES (?,?,?,?,?,?,?,?)",
    ).run(
      photo.id,
      photo.bookingId ?? null,
      photo.clientId ?? null,
      photo.kind,
      photo.mime,
      photo.size,
      photo.caption ?? null,
      photo.createdAt,
    );
    if (input.bookingId) {
      const row = sql("SELECT photoIds FROM bookings WHERE id = ?").get(input.bookingId) as
        | Row
        | undefined;
      if (row) {
        const ids = parseJSON<string[]>(row.photoIds, []);
        sql("UPDATE bookings SET photoIds = ? WHERE id = ?").run(
          JSON.stringify([...ids, photo.id]),
          input.bookingId,
        );
      }
    }
    return photo;
  });
}

export async function listPhotos(filter: {
  bookingId?: string;
  clientId?: string;
}): Promise<Photo[]> {
  const clauses: string[] = [];
  const params: string[] = [];
  if (filter.bookingId) {
    clauses.push("bookingId = ?");
    params.push(filter.bookingId);
  }
  if (filter.clientId) {
    clauses.push("clientId = ?");
    params.push(filter.clientId);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = sql(`SELECT * FROM photos ${where} ORDER BY createdAt ASC`).all(...params) as Row[];
  return rows.map(toPhoto);
}

export async function findPhoto(id: string): Promise<Photo | undefined> {
  const row = sql("SELECT * FROM photos WHERE id = ?").get(id) as Row | undefined;
  return row ? toPhoto(row) : undefined;
}

export async function deletePhoto(id: string): Promise<Photo | undefined> {
  return tx(() => {
    const row = sql("SELECT * FROM photos WHERE id = ?").get(id) as Row | undefined;
    sql("DELETE FROM photos WHERE id = ?").run(id);
    // Detach it from any booking that referenced it.
    const holders = sql(
      "SELECT id, photoIds FROM bookings WHERE photoIds IS NOT NULL AND photoIds LIKE ?",
    ).all(`%${id}%`) as Row[];
    for (const b of holders) {
      const ids = parseJSON<string[]>(b.photoIds, []);
      if (!ids.includes(id)) continue;
      sql("UPDATE bookings SET photoIds = ? WHERE id = ?").run(
        JSON.stringify(ids.filter((x) => x !== id)),
        b.id,
      );
    }
    return row ? toPhoto(row) : undefined;
  });
}

// ---------------------------- Automation ------------------------------

export async function listEmailRules(): Promise<EmailRule[]> {
  return (sql("SELECT * FROM emailRules ORDER BY seq ASC").all() as Row[]).map(toEmailRule);
}

export async function updateEmailRule(
  id: EmailTrigger,
  patch: Partial<Omit<EmailRule, "id">>,
): Promise<EmailRule | undefined> {
  return tx(() => {
    const row = sql("SELECT * FROM emailRules WHERE id = ?").get(id) as Row | undefined;
    if (!row) return undefined;
    const next = merge(row, {
      ...patch,
      // SQLite has no boolean type; merge() leaves the stored value alone
      // when the patch doesn't mention these.
      enabled: patch.enabled !== undefined ? (patch.enabled ? 1 : 0) : undefined,
      custom: patch.custom !== undefined ? (patch.custom ? 1 : 0) : undefined,
    });
    sql(
      `UPDATE emailRules SET trigger = ?, name = ?, custom = ?, enabled = ?, subject = ?,
              body = ?, offsetHours = ? WHERE id = ?`,
    ).run(
      next.trigger ?? null,
      next.name ?? null,
      next.custom,
      next.enabled,
      next.subject,
      next.body,
      next.offsetHours,
      id,
    );
    return toEmailRule(next);
  });
}

export async function createEmailRule(rule: EmailRule): Promise<EmailRule> {
  return tx(() => {
    const { n } = sql("SELECT COALESCE(MAX(seq), -1) + 1 AS n FROM emailRules").get() as {
      n: number;
    };
    sql(
      `INSERT INTO emailRules (id,trigger,name,custom,enabled,subject,body,offsetHours,seq)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    ).run(
      rule.id,
      rule.trigger ?? null,
      rule.name ?? null,
      rule.custom ? 1 : 0,
      rule.enabled ? 1 : 0,
      rule.subject,
      rule.body,
      rule.offsetHours,
      n,
    );
    return rule;
  });
}

export async function deleteEmailRule(id: string): Promise<void> {
  // Built-in rules can be disabled but not deleted — the code fires them
  // by id, so removing one would silently break that hook.
  sql("DELETE FROM emailRules WHERE id = ? AND custom = 1").run(id);
}

export async function logEmail(entry: Omit<EmailLogEntry, "id" | "createdAt">): Promise<void> {
  tx(() => {
    const { n } = sql("SELECT COALESCE(MAX(seq), -1) + 1 AS n FROM emailLog").get() as { n: number };
    sql(
      `INSERT INTO emailLog (id,seq,"to",subject,trigger,status,error,bookingId,createdAt)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    ).run(
      randomUUID(),
      n,
      entry.to,
      entry.subject,
      entry.trigger,
      entry.status,
      entry.error ?? null,
      entry.bookingId ?? null,
      new Date().toISOString(),
    );
    // Keep the log bounded — it is an activity feed, not a warehouse.
    sql(
      "DELETE FROM emailLog WHERE seq <= (SELECT MAX(seq) - 500 FROM emailLog)",
    ).run();
  });
}

export async function listEmailLog(limit = 100): Promise<EmailLogEntry[]> {
  const rows = sql("SELECT * FROM emailLog ORDER BY seq DESC LIMIT ?").all(limit) as Row[];
  return rows.map(toEmailLog);
}

/** Has this trigger already fired for this booking? Stops duplicate sends. */
export async function hasEmailBeenSent(
  bookingId: string,
  trigger: EmailTrigger,
): Promise<boolean> {
  const row = sql(
    "SELECT 1 AS hit FROM emailLog WHERE bookingId = ? AND trigger = ? AND status = 'sent' LIMIT 1",
  ).get(bookingId, trigger);
  return !!row;
}

// ---------------------------- Bulk import -----------------------------

/**
 * Import customers from a CSV export. Existing emails are updated rather
 * than duplicated, so re-running the same file is safe.
 */
export async function importClients(
  rows: { name: string; email: string; phone: string; notes?: string }[],
): Promise<{ created: number; updated: number }> {
  return tx(() => {
    let created = 0;
    let updated = 0;
    for (const row of rows) {
      const existing = sql("SELECT * FROM clients WHERE email = ? COLLATE NOCASE").get(row.email) as
        | Row
        | undefined;
      if (existing) {
        sql("UPDATE clients SET name = ?, phone = ?, notes = ? WHERE id = ?").run(
          row.name || existing.name,
          row.phone || existing.phone,
          row.notes ? row.notes : (existing.notes ?? null),
          existing.id,
        );
        updated += 1;
      } else {
        sql("INSERT INTO clients (id,name,email,phone,notes,createdAt) VALUES (?,?,?,?,?,?)").run(
          randomUUID(),
          row.name,
          row.email,
          row.phone,
          row.notes ?? null,
          new Date().toISOString(),
        );
        created += 1;
      }
    }
    return { created, updated };
  });
}

// ---------------------------- Form fields -----------------------------

export async function listFormFields(): Promise<FormField[]> {
  return (sql("SELECT * FROM formFields ORDER BY sortOrder ASC").all() as Row[]).map(toFormField);
}

export async function upsertFormField(field: FormField): Promise<FormField> {
  sql(
    `INSERT INTO formFields (id,label,type,required,placeholder,helpText,options,onlyForServices,active,sortOrder)
     VALUES (?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET
       label=excluded.label, type=excluded.type, required=excluded.required,
       placeholder=excluded.placeholder, helpText=excluded.helpText,
       options=excluded.options, onlyForServices=excluded.onlyForServices,
       active=excluded.active, sortOrder=excluded.sortOrder`,
  ).run(
    field.id,
    field.label,
    field.type,
    field.required ? 1 : 0,
    field.placeholder ?? null,
    field.helpText ?? null,
    JSON.stringify(field.options ?? []),
    JSON.stringify(field.onlyForServices ?? []),
    field.active ? 1 : 0,
    field.sortOrder,
  );
  return field;
}

export async function deleteFormField(id: string): Promise<void> {
  sql("DELETE FROM formFields WHERE id = ?").run(id);
}

// ---------------------------- Gallery ---------------------------------

export async function listGallery(): Promise<GalleryPair[]> {
  return (sql("SELECT * FROM gallery ORDER BY sortOrder ASC").all() as Row[]).map(toGalleryPair);
}

export async function upsertGalleryPair(pair: GalleryPair): Promise<GalleryPair> {
  sql(
    `INSERT INTO gallery (id,label,beforePhotoId,afterPhotoId,sortOrder,active,detail,description,packageLabel)
     VALUES (?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET
       label=excluded.label, beforePhotoId=excluded.beforePhotoId,
       afterPhotoId=excluded.afterPhotoId, sortOrder=excluded.sortOrder,
       active=excluded.active, detail=excluded.detail,
       description=excluded.description, packageLabel=excluded.packageLabel`,
  ).run(
    pair.id,
    pair.label,
    pair.beforePhotoId,
    pair.afterPhotoId,
    pair.sortOrder,
    pair.active ? 1 : 0,
    pair.detail ?? "",
    pair.description ?? "",
    pair.packageLabel ?? "",
  );
  return pair;
}

// -------------------------- Testimonials ------------------------------

export async function listTestimonials(): Promise<Testimonial[]> {
  return (
    sql("SELECT * FROM testimonials ORDER BY sortOrder ASC, createdAt ASC").all() as Row[]
  ).map(toTestimonial);
}

export async function upsertTestimonial(t: Testimonial): Promise<Testimonial> {
  sql(
    `INSERT INTO testimonials (id,name,vehicle,rating,text,active,sortOrder,createdAt)
     VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET
       name=excluded.name, vehicle=excluded.vehicle, rating=excluded.rating,
       text=excluded.text, active=excluded.active, sortOrder=excluded.sortOrder`,
  ).run(
    t.id,
    t.name,
    t.vehicle ?? "",
    t.rating,
    t.text,
    t.active ? 1 : 0,
    t.sortOrder,
    t.createdAt,
  );
  return t;
}

export async function deleteTestimonial(id: string): Promise<void> {
  sql("DELETE FROM testimonials WHERE id = ?").run(id);
}

// ------------------------------ FAQs ----------------------------------

export async function listFaqs(): Promise<Faq[]> {
  return (sql("SELECT * FROM faqs ORDER BY sortOrder ASC, createdAt ASC").all() as Row[]).map(
    toFaq,
  );
}

export async function upsertFaq(f: Faq): Promise<Faq> {
  sql(
    `INSERT INTO faqs (id,question,answer,active,sortOrder,createdAt)
     VALUES (?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET
       question=excluded.question, answer=excluded.answer,
       active=excluded.active, sortOrder=excluded.sortOrder`,
  ).run(f.id, f.question, f.answer, f.active ? 1 : 0, f.sortOrder, f.createdAt);
  return f;
}

export async function deleteFaq(id: string): Promise<void> {
  sql("DELETE FROM faqs WHERE id = ?").run(id);
}

// --------------------------- Time off ---------------------------------

export interface TimeOff {
  id: string;
  /** Inclusive YYYY-MM-DD. Same as endDate for a single day. */
  startDate: string;
  /** Inclusive. */
  endDate: string;
  /** Whole days off. When false, startTime/endTime bound each day. */
  allDay: boolean;
  startTime: string; // "HH:MM", only when allDay is false
  endTime: string;
  reason: string;
  createdAt: string;
}

function toTimeOff(r: Row): TimeOff {
  return {
    id: String(r.id),
    startDate: String(r.startDate),
    endDate: String(r.endDate),
    allDay: Boolean(r.allDay),
    startTime: String(r.startTime ?? ""),
    endTime: String(r.endTime ?? ""),
    reason: String(r.reason ?? ""),
    createdAt: String(r.createdAt),
  };
}

export async function listTimeOff(): Promise<TimeOff[]> {
  return (
    sql("SELECT * FROM timeOff ORDER BY startDate ASC").all() as Row[]
  ).map(toTimeOff);
}

/** Every block overlapping an inclusive date range. */
export async function listTimeOffBetween(from: string, to: string): Promise<TimeOff[]> {
  return (
    sql(
      "SELECT * FROM timeOff WHERE startDate <= ? AND endDate >= ? ORDER BY startDate ASC",
    ).all(to, from) as Row[]
  ).map(toTimeOff);
}

export async function upsertTimeOff(t: TimeOff): Promise<TimeOff> {
  sql(
    `INSERT INTO timeOff (id,startDate,endDate,allDay,startTime,endTime,reason,createdAt)
     VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET
       startDate=excluded.startDate, endDate=excluded.endDate,
       allDay=excluded.allDay, startTime=excluded.startTime,
       endTime=excluded.endTime, reason=excluded.reason`,
  ).run(
    t.id,
    t.startDate,
    t.endDate,
    t.allDay ? 1 : 0,
    t.startTime,
    t.endTime,
    t.reason,
    t.createdAt,
  );
  return t;
}

export async function deleteTimeOff(id: string): Promise<void> {
  sql("DELETE FROM timeOff WHERE id = ?").run(id);
}

// --------------------------- Avatars ----------------------------------

/** Point a user or agent at a photo row, or clear it with null. */
export async function setAvatar(
  kind: "user" | "agent",
  id: string,
  photoId: string | null,
): Promise<void> {
  const table = kind === "user" ? "users" : "agents";
  sql(`UPDATE ${table} SET avatarPhotoId = ? WHERE id = ?`).run(photoId, id);
}

export async function deleteGalleryPair(id: string): Promise<GalleryPair | undefined> {
  return tx(() => {
    const row = sql("SELECT * FROM gallery WHERE id = ?").get(id) as Row | undefined;
    sql("DELETE FROM gallery WHERE id = ?").run(id);
    return row ? toGalleryPair(row) : undefined;
  });
}

export async function setBookingCustomFields(
  bookingId: string,
  customFields: Record<string, string>,
): Promise<void> {
  sql("UPDATE bookings SET customFields = ? WHERE id = ?").run(
    JSON.stringify(customFields),
    bookingId,
  );
}

// ---------------------------- Agents ----------------------------------

function toAgent(r: Row): AgentRecord {
  return {
    id: r.id,
    name: r.name,
    email: r.email ?? "",
    phone: r.phone ?? "",
    title: r.title ?? "",
    payType: r.payType ?? "none",
    payRate: r.payRate ?? 0,
    color: r.color ?? "#38bdf8",
    avatarPhotoId: undef(r.avatarPhotoId),
    userId: undef(r.userId),
    notes: undef(r.notes),
    active: !!r.active,
    sortOrder: r.sortOrder,
    createdAt: r.createdAt,
  };
}

export async function listAgents(): Promise<AgentRecord[]> {
  return (sql("SELECT * FROM agents ORDER BY sortOrder ASC, name ASC").all() as Row[]).map(toAgent);
}

export async function findAgentById(id: string): Promise<AgentRecord | undefined> {
  const row = sql("SELECT * FROM agents WHERE id = ?").get(id) as Row | undefined;
  return row ? toAgent(row) : undefined;
}

export async function upsertAgent(input: AgentRecord): Promise<AgentRecord> {
  sql(
    `INSERT INTO agents (id,name,email,phone,title,payType,payRate,color,userId,notes,active,sortOrder,createdAt)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET
       name=excluded.name, email=excluded.email, phone=excluded.phone, title=excluded.title,
       payType=excluded.payType, payRate=excluded.payRate, color=excluded.color,
       userId=excluded.userId, notes=excluded.notes, active=excluded.active,
       sortOrder=excluded.sortOrder`,
  ).run(
    input.id,
    input.name,
    input.email ?? "",
    input.phone ?? "",
    input.title ?? "",
    input.payType,
    input.payRate,
    input.color,
    input.userId ?? null,
    input.notes ?? null,
    input.active ? 1 : 0,
    input.sortOrder,
    input.createdAt,
  );
  return input;
}

export async function deleteAgent(id: string): Promise<void> {
  tx(() => {
    sql("DELETE FROM agents WHERE id = ?").run(id);
    // Un-assign rather than orphan: a deleted agent must not leave jobs
    // pointing at a person who no longer exists.
    sql("UPDATE bookings SET agentId = NULL WHERE agentId = ?").run(id);
  });
}

/** Assign (or clear) the staff member and location on a booking. */
export async function assignBooking(
  bookingId: string,
  patch: { agentId?: string | null; locationId?: string | null },
): Promise<Booking | undefined> {
  return tx(() => {
    const row = sql("SELECT * FROM bookings WHERE id = ?").get(bookingId) as Row | undefined;
    if (!row) return undefined;
    const agentId = patch.agentId !== undefined ? patch.agentId : row.agentId;
    const locationId = patch.locationId !== undefined ? patch.locationId : row.locationId;
    sql("UPDATE bookings SET agentId = ?, locationId = ? WHERE id = ?").run(
      agentId ?? null,
      locationId ?? null,
      bookingId,
    );
    return toBooking({ ...row, agentId: agentId ?? null, locationId: locationId ?? null });
  });
}

// --------------------------- Locations --------------------------------

function toLocation(r: Row): LocationRecord {
  return {
    id: r.id,
    name: r.name,
    kind: r.kind ?? "zone",
    address: r.address ?? "",
    city: r.city ?? "",
    postalCode: r.postalCode ?? "",
    travelFee: r.travelFee ?? 0,
    radiusKm: r.radiusKm ?? 0,
    notes: undef(r.notes),
    active: !!r.active,
    sortOrder: r.sortOrder,
    createdAt: r.createdAt,
  };
}

export async function listLocations(): Promise<LocationRecord[]> {
  return (sql("SELECT * FROM locations ORDER BY sortOrder ASC, name ASC").all() as Row[]).map(
    toLocation,
  );
}

export async function upsertLocation(input: LocationRecord): Promise<LocationRecord> {
  sql(
    `INSERT INTO locations (id,name,kind,address,city,postalCode,travelFee,radiusKm,notes,active,sortOrder,createdAt)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET
       name=excluded.name, kind=excluded.kind, address=excluded.address, city=excluded.city,
       postalCode=excluded.postalCode, travelFee=excluded.travelFee, radiusKm=excluded.radiusKm,
       notes=excluded.notes, active=excluded.active, sortOrder=excluded.sortOrder`,
  ).run(
    input.id,
    input.name,
    input.kind,
    input.address ?? "",
    input.city ?? "",
    input.postalCode ?? "",
    input.travelFee,
    input.radiusKm,
    input.notes ?? null,
    input.active ? 1 : 0,
    input.sortOrder,
    input.createdAt,
  );
  return input;
}

export async function deleteLocation(id: string): Promise<void> {
  tx(() => {
    sql("DELETE FROM locations WHERE id = ?").run(id);
    sql("UPDATE bookings SET locationId = NULL WHERE locationId = ?").run(id);
  });
}

// ---------------------------- Assets ----------------------------------

function toAsset(r: Row): AssetRecord {
  return {
    id: r.id,
    name: r.name,
    kind: r.kind ?? "consumable",
    category: r.category ?? "",
    unit: r.unit ?? "each",
    unitCost: r.unitCost ?? 0,
    quantity: r.quantity ?? 0,
    reorderLevel: r.reorderLevel ?? 0,
    supplier: undef(r.supplier),
    notes: undef(r.notes),
    active: !!r.active,
    createdAt: r.createdAt,
  };
}

export async function listAssets(): Promise<AssetRecord[]> {
  return (
    sql("SELECT * FROM assets ORDER BY kind ASC, category ASC, name ASC").all() as Row[]
  ).map(toAsset);
}

export async function findAssetById(id: string): Promise<AssetRecord | undefined> {
  const row = sql("SELECT * FROM assets WHERE id = ?").get(id) as Row | undefined;
  return row ? toAsset(row) : undefined;
}

export async function upsertAsset(input: AssetRecord): Promise<AssetRecord> {
  sql(
    `INSERT INTO assets (id,name,kind,category,unit,unitCost,quantity,reorderLevel,supplier,notes,active,createdAt)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET
       name=excluded.name, kind=excluded.kind, category=excluded.category, unit=excluded.unit,
       unitCost=excluded.unitCost, quantity=excluded.quantity, reorderLevel=excluded.reorderLevel,
       supplier=excluded.supplier, notes=excluded.notes, active=excluded.active`,
  ).run(
    input.id,
    input.name,
    input.kind,
    input.category ?? "",
    input.unit ?? "each",
    input.unitCost,
    input.quantity,
    input.reorderLevel,
    input.supplier ?? null,
    input.notes ?? null,
    input.active ? 1 : 0,
    input.createdAt,
  );
  return input;
}

export async function deleteAsset(id: string): Promise<void> {
  tx(() => {
    sql("DELETE FROM assets WHERE id = ?").run(id);
    // Keep the expense — the money was still spent. Just drop the link.
    sql("UPDATE expenses SET assetId = NULL WHERE assetId = ?").run(id);
  });
}

/** Adjust stock by a delta (negative to consume). Never goes below zero. */
export async function adjustAssetStock(
  id: string,
  delta: number,
): Promise<AssetRecord | undefined> {
  return tx(() => {
    const row = sql("SELECT * FROM assets WHERE id = ?").get(id) as Row | undefined;
    if (!row) return undefined;
    const next = Math.max(0, (row.quantity ?? 0) + delta);
    sql("UPDATE assets SET quantity = ? WHERE id = ?").run(next, id);
    return toAsset({ ...row, quantity: next });
  });
}

// ---------------------------- Expenses --------------------------------

function toExpense(r: Row): ExpenseRecord {
  return {
    id: r.id,
    date: r.date,
    description: r.description,
    category: r.category ?? "Other",
    vendor: undef(r.vendor),
    type: r.type ?? "operating",
    amount: r.amount,
    quantity: undef(r.quantity),
    unitCost: undef(r.unitCost),
    assetId: undef(r.assetId),
    bookingId: undef(r.bookingId),
    paymentMethod: undef(r.paymentMethod),
    notes: undef(r.notes),
    createdAt: r.createdAt,
  };
}

export async function listExpenses(filter?: {
  from?: string;
  to?: string;
  type?: ExpenseType;
}): Promise<ExpenseRecord[]> {
  const clauses: string[] = [];
  const params: (string | number)[] = [];
  if (filter?.from) {
    clauses.push("date >= ?");
    params.push(filter.from);
  }
  if (filter?.to) {
    clauses.push("date <= ?");
    params.push(filter.to);
  }
  if (filter?.type) {
    clauses.push("type = ?");
    params.push(filter.type);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = sql(
    `SELECT * FROM expenses ${where} ORDER BY date DESC, createdAt DESC`,
  ).all(...params) as Row[];
  return rows.map(toExpense);
}

export async function findExpenseById(id: string): Promise<ExpenseRecord | undefined> {
  const row = sql("SELECT * FROM expenses WHERE id = ?").get(id) as Row | undefined;
  return row ? toExpense(row) : undefined;
}

/**
 * Record a cost. When `restockAssetId` is given the matching consumable's
 * stock goes up by `quantity` in the same transaction, so buying supplies is
 * one action rather than "log the expense, then remember to update stock".
 */
export async function addExpense(
  input: Omit<ExpenseRecord, "id" | "createdAt"> & { id?: string; createdAt?: string },
  restockAssetId?: string,
): Promise<ExpenseRecord> {
  return tx(() => {
    const record: ExpenseRecord = {
      ...input,
      id: input.id ?? randomUUID(),
      createdAt: input.createdAt ?? new Date().toISOString(),
    };
    sql(
      `INSERT INTO expenses (id,date,description,category,vendor,type,amount,quantity,unitCost,assetId,bookingId,paymentMethod,notes,createdAt)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         date=excluded.date, description=excluded.description, category=excluded.category,
         vendor=excluded.vendor, type=excluded.type, amount=excluded.amount,
         quantity=excluded.quantity, unitCost=excluded.unitCost, assetId=excluded.assetId,
         bookingId=excluded.bookingId, paymentMethod=excluded.paymentMethod, notes=excluded.notes`,
    ).run(
      record.id,
      record.date,
      record.description,
      record.category,
      record.vendor ?? null,
      record.type,
      record.amount,
      record.quantity ?? null,
      record.unitCost ?? null,
      record.assetId ?? null,
      record.bookingId ?? null,
      record.paymentMethod ?? null,
      record.notes ?? null,
      record.createdAt,
    );

    if (restockAssetId && record.quantity) {
      const asset = sql("SELECT quantity FROM assets WHERE id = ?").get(restockAssetId) as
        | Row
        | undefined;
      if (asset) {
        sql("UPDATE assets SET quantity = ? WHERE id = ?").run(
          Math.max(0, (asset.quantity ?? 0) + record.quantity),
          restockAssetId,
        );
      }
    }
    return record;
  });
}

export async function deleteExpense(id: string): Promise<void> {
  sql("DELETE FROM expenses WHERE id = ?").run(id);
}

// ------------------------ Legacy JSON import --------------------------

/**
 * One-time import of the old data/store.json, run while the connection is
 * being opened. Deliberately synchronous: it has to finish before the first
 * query can return, or the site would answer with seeded default prices for
 * however long the import took.
 *
 * The whole import is one transaction — either the entire store lands in
 * SQLite or none of it does, so a failure halfway can never leave a
 * half-populated database. The JSON file is then renamed, not deleted, and a
 * copy is kept beside it: if anything looks wrong after upgrading, the
 * original data is still sitting right there.
 */
function importLegacyJSON(): void {
  if (!existsSync(LEGACY_JSON)) return;

  // Only import into a database with no real data. Seeded catalog rows do
  // not count as real data; a user, client or booking does. This is what
  // stops a stale store.json from overwriting a live database.
  const hasData =
    !tableIsEmpty("users") || !tableIsEmpty("bookings") || !tableIsEmpty("clients");
  if (hasData) return;

  const counts: Record<string, number> = {};
  const parsed = JSON.parse(readFileSync(LEGACY_JSON, "utf-8")) as Record<string, any>;

  tx(() => {
    const d = getDB();

    if (parsed.services?.length) {
      d.exec("DELETE FROM services");
      for (const [i, s] of parsed.services.entries()) {
        const seed = DEFAULT_SERVICES.find((x) => x.id === s.id);
        d.prepare(
          `INSERT INTO services (id,title,subtitle,priceValue,durationMinutes,features,description,active,sortOrder)
           VALUES (?,?,?,?,?,?,?,?,?)`,
        ).run(
          s.id,
          s.title,
          s.subtitle ?? "",
          s.priceValue,
          s.durationMinutes,
          JSON.stringify(s.features ?? seed?.features ?? []),
          s.description ?? seed?.description ?? "",
          s.active === false ? 0 : 1,
          s.sortOrder ?? i,
        );
      }
      counts.services = parsed.services.length;
    }

    if (parsed.addOns?.length) {
      d.exec("DELETE FROM addOns");
      for (const [i, a] of parsed.addOns.entries()) {
        d.prepare(
          `INSERT INTO addOns (id,name,detail,price,durationMinutes,active,sortOrder)
           VALUES (?,?,?,?,?,?,?)`,
        ).run(a.id, a.name, a.detail ?? "", a.price, a.durationMinutes, a.active === false ? 0 : 1, a.sortOrder ?? i);
      }
      counts.addOns = parsed.addOns.length;
    }

    if (parsed.emailRules?.length) {
      d.exec("DELETE FROM emailRules");
      for (const [i, r] of parsed.emailRules.entries()) {
        d.prepare(
          `INSERT INTO emailRules (id,trigger,name,custom,enabled,subject,body,offsetHours,seq)
           VALUES (?,?,?,?,?,?,?,?,?)`,
        ).run(
          r.id,
          r.trigger ?? null,
          r.name ?? null,
          r.custom ? 1 : 0,
          r.enabled ? 1 : 0,
          r.subject,
          r.body,
          r.offsetHours ?? 0,
          i,
        );
      }
      counts.emailRules = parsed.emailRules.length;
    }

    for (const u of parsed.users ?? []) {
      d.prepare(
        `INSERT INTO users (id,email,name,role,passwordHash,passwordSalt,createdAt,lastLoginAt)
         VALUES (?,?,?,?,?,?,?,?)`,
      ).run(u.id, u.email, u.name, u.role, u.passwordHash, u.passwordSalt, u.createdAt, u.lastLoginAt ?? null);
    }
    counts.users = (parsed.users ?? []).length;

    for (const s of parsed.sessions ?? []) {
      d.prepare(
        "INSERT INTO sessions (token,userId,createdAt,expiresAt,userAgent) VALUES (?,?,?,?,?)",
      ).run(s.token, s.userId, s.createdAt, s.expiresAt, s.userAgent ?? null);
    }
    counts.sessions = (parsed.sessions ?? []).length;

    for (const c of parsed.clients ?? []) {
      d.prepare(
        "INSERT INTO clients (id,name,email,phone,notes,createdAt) VALUES (?,?,?,?,?,?)",
      ).run(c.id, c.name, c.email, c.phone, c.notes ?? null, c.createdAt);
    }
    counts.clients = (parsed.clients ?? []).length;

    for (const b of parsed.bookings ?? []) {
      d.prepare(
        `INSERT INTO bookings (${BOOKING_COLUMNS})
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        b.id,
        b.clientId,
        b.serviceId,
        b.serviceTitle,
        b.date,
        b.startTime,
        b.durationMinutes,
        b.status,
        b.reference,
        JSON.stringify(b.addOnIds ?? []),
        JSON.stringify(b.addOnTitles ?? []),
        b.location,
        b.address ?? null,
        b.vehicle ? JSON.stringify(b.vehicle) : null,
        b.totalPrice,
        b.tip ?? null,
        b.discount ?? null,
        b.paymentStatus ?? "unpaid",
        b.amountPaid ?? null,
        b.paymentMethod ?? null,
        b.photoIds ? JSON.stringify(b.photoIds) : null,
        b.customFields ? JSON.stringify(b.customFields) : null,
        b.notes ?? null,
        b.cancelledAt ?? null,
        b.cancelReason ?? null,
        b.googleEventId ?? null,
        // Imported bookings get a token too, so their confirmation links work.
        randomBytes(24).toString("base64url"),
        b.createdAt,
      );
    }
    counts.bookings = (parsed.bookings ?? []).length;

    for (const c of parsed.coupons ?? []) {
      d.prepare(
        `INSERT INTO coupons (id,code,type,value,active,timesUsed,maxUses,expiresAt,createdAt)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      ).run(
        c.id,
        c.code,
        c.type,
        c.value,
        c.active === false ? 0 : 1,
        c.timesUsed ?? 0,
        c.maxUses ?? null,
        c.expiresAt ?? null,
        c.createdAt,
      );
    }
    counts.coupons = (parsed.coupons ?? []).length;

    for (const p of parsed.photos ?? []) {
      d.prepare(
        "INSERT INTO photos (id,bookingId,clientId,kind,mime,size,caption,createdAt) VALUES (?,?,?,?,?,?,?,?)",
      ).run(p.id, p.bookingId ?? null, p.clientId ?? null, p.kind, p.mime, p.size, p.caption ?? null, p.createdAt);
    }
    counts.photos = (parsed.photos ?? []).length;

    for (const [i, e] of (parsed.emailLog ?? []).entries()) {
      // The JSON log was newest-first; seq must ascend with age.
      d.prepare(
        `INSERT INTO emailLog (id,seq,"to",subject,trigger,status,error,bookingId,createdAt)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      ).run(
        e.id ?? randomUUID(),
        (parsed.emailLog.length - 1 - i),
        e.to,
        e.subject,
        e.trigger,
        e.status,
        e.error ?? null,
        e.bookingId ?? null,
        e.createdAt,
      );
    }
    counts.emailLog = (parsed.emailLog ?? []).length;

    for (const f of parsed.formFields ?? []) {
      d.prepare(
        `INSERT INTO formFields (id,label,type,required,placeholder,helpText,options,onlyForServices,active,sortOrder)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        f.id,
        f.label,
        f.type,
        f.required ? 1 : 0,
        f.placeholder ?? null,
        f.helpText ?? null,
        JSON.stringify(f.options ?? []),
        JSON.stringify(f.onlyForServices ?? []),
        f.active === false ? 0 : 1,
        f.sortOrder ?? 0,
      );
    }
    counts.formFields = (parsed.formFields ?? []).length;

    for (const g of parsed.gallery ?? []) {
      d.prepare(
        `INSERT INTO gallery (id,label,beforePhotoId,afterPhotoId,sortOrder,active)
         VALUES (?,?,?,?,?,?)`,
      ).run(g.id, g.label, g.beforePhotoId, g.afterPhotoId, g.sortOrder ?? 0, g.active === false ? 0 : 1);
    }
    counts.gallery = (parsed.gallery ?? []).length;

    if (parsed.settings) {
      // Persist the derived weekly schedules too, so the migration is the
      // last time those have to be inferred.
      const merged = migrateSettings(
        { ...DEFAULT_SETTINGS, ...parsed.settings },
        parsed.settings,
      );
      writeSettingsRows(merged as unknown as Record<string, unknown>);
      counts.settings = Object.keys(parsed.settings).length;
    }
  });

  // Keep the original rather than deleting it: one copy as a permanent
  // backup, and the file itself renamed so this import never runs twice.
  try {
    copyFileSync(LEGACY_JSON, `${LEGACY_JSON}.backup`);
    renameSync(LEGACY_JSON, `${LEGACY_JSON}.migrated`);
  } catch {
    // If the rename fails the guard above still prevents a re-import, since
    // the database now holds real data.
  }

  const summary = Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${n} ${k}`)
    .join(", ");
  console.log(
    `[db] Imported store.json into SQLite (${summary || "settings only"}). ` +
      `Original kept at ${path.basename(LEGACY_JSON)}.backup`,
  );
}
