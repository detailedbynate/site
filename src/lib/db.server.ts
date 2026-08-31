import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { randomUUID } from "node:crypto";

import { DEFAULT_ADD_ONS, DEFAULT_SERVICES, type LocationChoice } from "./services";

// --------------------------------------------------------------------------
// A tiny JSON-file "database". This is intentionally simple so the backend
// runs with zero extra infrastructure (no Postgres/SQLite native bindings
// to install) — good for a single-operator business. Swap this module out
// for a real database later; every function here is a plain async CRUD
// call, so callers (the server functions in src/lib/api) never change.
//
// Data lives in <project-root>/data/store.json, which is gitignored. On
// serverless hosts (Vercel, Cloudflare) the filesystem is read-only or
// ephemeral in production — this store is meant for local dev / an
// always-on Node host (a small VPS, Render, Railway, Fly.io). See README.
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
  /** Hidden services stay bookable for existing bookings but aren't offered. */
  active: boolean;
  sortOrder: number;
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
  /** Resend API key — HTTP only, so no SMTP dependency. */
  resendApiKey: string;
  emailFrom: string;
  emailReplyTo: string;
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
}

export interface Coupon {
  id: string;
  code: string;
  /** "percent" takes `value` as 0-100; "fixed" takes it as dollars. */
  type: "percent" | "fixed";
  value: number;
  active: boolean;
  timesUsed: number;
  maxUses?: number;
  expiresAt?: string;
  createdAt: string;
}

interface DBShape {
  clients: Client[];
  bookings: Booking[];
  users: User[];
  sessions: Session[];
  services: ServiceRecord[];
  addOns: AddOnRecord[];
  coupons: Coupon[];
  photos: Photo[];
  emailRules: EmailRule[];
  emailLog: EmailLogEntry[];
  formFields: FormField[];
  gallery: GalleryPair[];
  settings: Settings;
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
  resendApiKey: process.env.RESEND_API_KEY ?? "",
  emailFrom: process.env.EMAIL_FROM ?? "",
  emailReplyTo: "",
};

export const DEFAULT_EMAIL_RULES: EmailRule[] = [
  {
    id: "booking_confirmed",
    enabled: true,
    offsetHours: 0,
    subject: "You're booked in — {{service}} on {{date}}",
    body: `Hi {{name}},

You're all set for your {{service}} detail.

When: {{date}} at {{time}}
Where: {{location}}
Vehicle: {{vehicle}}
Total: {{total}}
Reference: {{reference}}

Reply to this email if anything changes.

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

const DATA_DIR = path.join(process.cwd(), "data");
const DB_FILE = path.join(DATA_DIR, "store.json");

let writeQueue: Promise<unknown> = Promise.resolve();

/** Seed the editable catalog from the static defaults on first run. */
function seedCatalog(): { services: ServiceRecord[]; addOns: AddOnRecord[] } {
  return {
    services: DEFAULT_SERVICES.map((s, i) => ({
      id: s.id,
      title: s.title,
      subtitle: s.subtitle,
      priceValue: s.priceValue,
      durationMinutes: s.durationMinutes,
      active: true,
      sortOrder: i,
    })),
    addOns: DEFAULT_ADD_ONS.map((a, i) => ({
      id: a.id,
      name: a.name,
      detail: a.detail,
      price: a.price,
      durationMinutes: a.durationMinutes,
      active: true,
      sortOrder: i,
    })),
  };
}

function emptyDB(): DBShape {
  const { services, addOns } = seedCatalog();
  return {
    clients: [],
    bookings: [],
    users: [],
    sessions: [],
    services,
    addOns,
    coupons: [],
    photos: [],
    emailRules: DEFAULT_EMAIL_RULES.map((r) => ({ ...r })),
    emailLog: [],
    formFields: [],
    gallery: [],
    settings: { ...DEFAULT_SETTINGS },
  };
}

/**
 * Read the store, filling in any collection added since the file was
 * written. This is the migration story for a JSON DB: old files keep
 * working and simply gain the new keys on next write.
 */
async function ensureDB(): Promise<DBShape> {
  await mkdir(DATA_DIR, { recursive: true });
  const base = emptyDB();
  try {
    const raw = await readFile(DB_FILE, "utf-8");
    const parsed = JSON.parse(raw) as Partial<DBShape>;
    return {
      ...base,
      ...parsed,
      // Catalog/settings need a deeper merge so a partial old file doesn't
      // wipe the seeded defaults.
      services: parsed.services?.length ? parsed.services : base.services,
      addOns: parsed.addOns?.length ? parsed.addOns : base.addOns,
      emailRules: parsed.emailRules?.length ? parsed.emailRules : base.emailRules,
      settings: migrateSettings(
        { ...base.settings, ...(parsed.settings ?? {}) },
        // Only the STORED settings count as pre-existing. Without this the
        // seeded default week looks "already migrated" and an upgrading
        // store would silently adopt default hours instead of its own.
        parsed.settings ?? {},
      ),
    };
  } catch (err) {
    // A missing file is the only case where creating a fresh store is safe.
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
      await atomicWrite(DB_FILE, JSON.stringify(base, null, 2));
      return base;
    }

    // Anything else (unreadable, truncated, invalid JSON) must NOT be
    // silently replaced with an empty database — that would destroy every
    // booking and customer. Preserve the file for recovery and fail loudly.
    const backup = `${DB_FILE}.corrupt-${Date.now()}`;
    await copyFile(DB_FILE, backup).catch(() => undefined);
    throw new Error(
      `Could not read the data store (${(err as Error).message}). ` +
        `A copy was preserved at ${backup}. Refusing to overwrite it.`,
    );
  }
}

/**
 * Write via a temp file + rename. rename() is atomic on the same
 * filesystem, so a crash mid-write leaves the previous store intact
 * instead of a truncated file that the next read would reject.
 */
async function atomicWrite(file: string, contents: string): Promise<void> {
  const tmp = `${file}.tmp-${process.pid}`;
  await writeFile(tmp, contents, "utf-8");
  await rename(tmp, file);
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

async function persist(db: DBShape): Promise<void> {
  await atomicWrite(DB_FILE, JSON.stringify(db, null, 2));
}

// Serialize writes so two near-simultaneous bookings can't clobber each
// other's changes (simple in-process mutex — fine for a single Node
// instance; a real DB would handle this for you).
function withWriteLock<T>(fn: (db: DBShape) => Promise<T>): Promise<T> {
  const result = writeQueue.then(async () => {
    const db = await ensureDB();
    const out = await fn(db);
    await persist(db);
    return out;
  });
  // Keep the queue alive even if this particular write throws.
  writeQueue = result.catch(() => undefined);
  return result;
}

// ---------------------------- Users -----------------------------------

export async function countUsers(): Promise<number> {
  const db = await ensureDB();
  return db.users.length;
}

export async function listUsers(): Promise<User[]> {
  const db = await ensureDB();
  return [...db.users].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function findUserByEmail(email: string): Promise<User | undefined> {
  const db = await ensureDB();
  return db.users.find((u) => u.email.toLowerCase() === email.toLowerCase());
}

export async function findUserById(id: string): Promise<User | undefined> {
  const db = await ensureDB();
  return db.users.find((u) => u.id === id);
}

export async function createUser(input: {
  email: string;
  name: string;
  role: UserRole;
  passwordHash: string;
  passwordSalt: string;
}): Promise<User> {
  return withWriteLock(async (db) => {
    if (db.users.some((u) => u.email.toLowerCase() === input.email.toLowerCase())) {
      throw new Error("An account with that email already exists.");
    }
    const user: User = {
      id: randomUUID(),
      email: input.email.toLowerCase(),
      name: input.name,
      role: input.role,
      passwordHash: input.passwordHash,
      passwordSalt: input.passwordSalt,
      createdAt: new Date().toISOString(),
    };
    db.users.push(user);
    return user;
  });
}

export async function updateUserPassword(
  userId: string,
  passwordHash: string,
  passwordSalt: string,
): Promise<void> {
  await withWriteLock(async (db) => {
    const user = db.users.find((u) => u.id === userId);
    if (user) {
      user.passwordHash = passwordHash;
      user.passwordSalt = passwordSalt;
    }
    // Changing a password invalidates every other session for that user.
    db.sessions = db.sessions.filter((s) => s.userId !== userId);
  });
}

export async function updateUserProfile(
  userId: string,
  patch: { name?: string; email?: string },
): Promise<User | undefined> {
  return withWriteLock(async (db) => {
    const user = db.users.find((u) => u.id === userId);
    if (!user) return undefined;
    if (patch.email && db.users.some((u) => u.id !== userId && u.email === patch.email!.toLowerCase())) {
      throw new Error("That email is already in use.");
    }
    if (patch.name) user.name = patch.name;
    if (patch.email) user.email = patch.email.toLowerCase();
    return user;
  });
}

export async function touchUserLogin(userId: string): Promise<void> {
  await withWriteLock(async (db) => {
    const user = db.users.find((u) => u.id === userId);
    if (user) user.lastLoginAt = new Date().toISOString();
  });
}

// --------------------------- Sessions ---------------------------------

export async function createSession(input: {
  token: string;
  userId: string;
  expiresAt: string;
  userAgent?: string;
}): Promise<Session> {
  return withWriteLock(async (db) => {
    const now = Date.now();
    // Opportunistically drop expired rows so the file doesn't grow forever.
    db.sessions = db.sessions.filter((s) => new Date(s.expiresAt).getTime() > now);
    const session: Session = {
      token: input.token,
      userId: input.userId,
      createdAt: new Date().toISOString(),
      expiresAt: input.expiresAt,
      userAgent: input.userAgent,
    };
    db.sessions.push(session);
    return session;
  });
}

export async function findSession(token: string): Promise<Session | undefined> {
  const db = await ensureDB();
  const session = db.sessions.find((s) => s.token === token);
  if (!session) return undefined;
  if (new Date(session.expiresAt).getTime() <= Date.now()) return undefined;
  return session;
}

export async function deleteSession(token: string): Promise<void> {
  await withWriteLock(async (db) => {
    db.sessions = db.sessions.filter((s) => s.token !== token);
  });
}

export async function listSessionsForUser(userId: string): Promise<Session[]> {
  const db = await ensureDB();
  const now = Date.now();
  return db.sessions
    .filter((s) => s.userId === userId && new Date(s.expiresAt).getTime() > now)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// ---------------------------- Clients --------------------------------

export async function listClients(): Promise<Client[]> {
  const db = await ensureDB();
  return [...db.clients].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function findClientById(id: string): Promise<Client | undefined> {
  const db = await ensureDB();
  return db.clients.find((c) => c.id === id);
}

export async function findOrCreateClient(input: {
  name: string;
  email: string;
  phone: string;
}): Promise<Client> {
  return withWriteLock(async (db) => {
    const existing = db.clients.find((c) => c.email.toLowerCase() === input.email.toLowerCase());
    if (existing) {
      existing.name = input.name;
      existing.phone = input.phone;
      return existing;
    }
    const client: Client = {
      id: randomUUID(),
      name: input.name,
      email: input.email,
      phone: input.phone,
      createdAt: new Date().toISOString(),
    };
    db.clients.push(client);
    return client;
  });
}

export async function addClientManual(input: {
  name: string;
  email: string;
  phone: string;
  notes?: string;
}): Promise<Client> {
  return withWriteLock(async (db) => {
    const client: Client = {
      id: randomUUID(),
      name: input.name,
      email: input.email,
      phone: input.phone,
      notes: input.notes,
      createdAt: new Date().toISOString(),
    };
    db.clients.push(client);
    return client;
  });
}

export async function updateClient(
  id: string,
  patch: { name?: string; email?: string; phone?: string; notes?: string },
): Promise<Client | undefined> {
  return withWriteLock(async (db) => {
    const client = db.clients.find((c) => c.id === id);
    if (!client) return undefined;
    Object.assign(client, patch);
    return client;
  });
}

export async function deleteClient(id: string): Promise<void> {
  await withWriteLock(async (db) => {
    db.clients = db.clients.filter((c) => c.id !== id);
  });
}

// ---------------------------- Bookings --------------------------------

export async function listBookings(): Promise<Booking[]> {
  const db = await ensureDB();
  return [...db.bookings].sort((a, b) =>
    `${a.date}T${a.startTime}`.localeCompare(`${b.date}T${b.startTime}`),
  );
}

/**
 * Bookings that occupy time on `date`. Cancelled bookings are excluded, which
 * is precisely what frees the slot again when an admin cancels one.
 */
export async function listBookingsForDate(date: string): Promise<Booking[]> {
  const db = await ensureDB();
  return db.bookings.filter((b) => b.date === date && b.status !== "cancelled");
}

export async function findBookingById(id: string): Promise<Booking | undefined> {
  const db = await ensureDB();
  return db.bookings.find((b) => b.id === id);
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
  notes?: string;
  googleEventId?: string;
}): Promise<Booking> {
  return withWriteLock(async (db) => {
    // Keep references unique within the store so two customers never quote
    // the same one back to you.
    let reference = makeReference();
    while (db.bookings.some((b) => b.reference === reference)) {
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
      notes: input.notes,
      googleEventId: input.googleEventId,
      createdAt: new Date().toISOString(),
    };
    db.bookings.push(booking);
    return booking;
  });
}

export async function updateBookingStatus(
  bookingId: string,
  status: BookingStatus,
  reason?: string,
): Promise<Booking | undefined> {
  return withWriteLock(async (db) => {
    const booking = db.bookings.find((b) => b.id === bookingId);
    if (!booking) return undefined;
    booking.status = status;
    if (status === "cancelled") {
      booking.cancelledAt = new Date().toISOString();
      booking.cancelReason = reason;
    } else {
      delete booking.cancelledAt;
      delete booking.cancelReason;
    }
    return booking;
  });
}

/** Move a booking to a new date/time. Caller must verify the slot is free. */
export async function rescheduleBooking(
  bookingId: string,
  date: string,
  startTime: string,
  googleEventId?: string,
): Promise<Booking | undefined> {
  return withWriteLock(async (db) => {
    const booking = db.bookings.find((b) => b.id === bookingId);
    if (!booking) return undefined;
    booking.date = date;
    booking.startTime = startTime;
    if (googleEventId !== undefined) booking.googleEventId = googleEventId;
    return booking;
  });
}

export async function deleteBooking(id: string): Promise<void> {
  await withWriteLock(async (db) => {
    db.bookings = db.bookings.filter((b) => b.id !== id);
  });
}

export async function listBookingsWithClients(): Promise<
  (Booking & { client: Client | undefined })[]
> {
  const db = await ensureDB();
  return [...db.bookings]
    .sort((a, b) => `${b.date}T${b.startTime}`.localeCompare(`${a.date}T${a.startTime}`))
    .map((b) => ({ ...b, client: db.clients.find((c) => c.id === b.clientId) }));
}

// ---------------------------- Catalog ---------------------------------

export async function listServices(): Promise<ServiceRecord[]> {
  const db = await ensureDB();
  return [...db.services].sort((a, b) => a.sortOrder - b.sortOrder);
}

export async function upsertService(input: ServiceRecord): Promise<ServiceRecord> {
  return withWriteLock(async (db) => {
    const idx = db.services.findIndex((s) => s.id === input.id);
    if (idx >= 0) db.services[idx] = { ...db.services[idx], ...input };
    else db.services.push(input);
    return input;
  });
}

export async function deleteService(id: string): Promise<void> {
  await withWriteLock(async (db) => {
    db.services = db.services.filter((s) => s.id !== id);
  });
}

export async function listAddOns(): Promise<AddOnRecord[]> {
  const db = await ensureDB();
  return [...db.addOns].sort((a, b) => a.sortOrder - b.sortOrder);
}

export async function upsertAddOn(input: AddOnRecord): Promise<AddOnRecord> {
  return withWriteLock(async (db) => {
    const idx = db.addOns.findIndex((a) => a.id === input.id);
    if (idx >= 0) db.addOns[idx] = { ...db.addOns[idx], ...input };
    else db.addOns.push(input);
    return input;
  });
}

export async function deleteAddOn(id: string): Promise<void> {
  await withWriteLock(async (db) => {
    db.addOns = db.addOns.filter((a) => a.id !== id);
  });
}

// ---------------------------- Settings --------------------------------

export async function getSettings(): Promise<Settings> {
  const db = await ensureDB();
  return db.settings;
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  return withWriteLock(async (db) => {
    db.settings = { ...db.settings, ...patch };
    return db.settings;
  });
}

// ---------------------------- Coupons ---------------------------------

export async function listCoupons(): Promise<Coupon[]> {
  const db = await ensureDB();
  return [...db.coupons].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function findCouponByCode(code: string): Promise<Coupon | undefined> {
  const db = await ensureDB();
  return db.coupons.find((c) => c.code.toLowerCase() === code.toLowerCase());
}

export async function upsertCoupon(input: Omit<Coupon, "createdAt"> & { createdAt?: string }): Promise<Coupon> {
  return withWriteLock(async (db) => {
    const idx = db.coupons.findIndex((c) => c.id === input.id);
    const record: Coupon = {
      ...input,
      code: input.code.toUpperCase(),
      createdAt: input.createdAt ?? new Date().toISOString(),
    };
    if (idx >= 0) db.coupons[idx] = { ...db.coupons[idx], ...record };
    else db.coupons.push(record);
    return record;
  });
}

export async function deleteCoupon(id: string): Promise<void> {
  await withWriteLock(async (db) => {
    db.coupons = db.coupons.filter((c) => c.id !== id);
  });
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
  return withWriteLock(async (db) => {
    const b = db.bookings.find((x) => x.id === bookingId);
    if (!b) return undefined;
    Object.assign(b, patch);
    return b;
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
  return withWriteLock(async (db) => {
    const photo: Photo = { ...input, createdAt: new Date().toISOString() };
    db.photos.push(photo);
    if (input.bookingId) {
      const b = db.bookings.find((x) => x.id === input.bookingId);
      if (b) b.photoIds = [...(b.photoIds ?? []), photo.id];
    }
    return photo;
  });
}

export async function listPhotos(filter: {
  bookingId?: string;
  clientId?: string;
}): Promise<Photo[]> {
  const db = await ensureDB();
  return db.photos
    .filter(
      (p) =>
        (!filter.bookingId || p.bookingId === filter.bookingId) &&
        (!filter.clientId || p.clientId === filter.clientId),
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function findPhoto(id: string): Promise<Photo | undefined> {
  const db = await ensureDB();
  return db.photos.find((p) => p.id === id);
}

export async function deletePhoto(id: string): Promise<Photo | undefined> {
  return withWriteLock(async (db) => {
    const photo = db.photos.find((p) => p.id === id);
    db.photos = db.photos.filter((p) => p.id !== id);
    for (const b of db.bookings) {
      if (b.photoIds?.includes(id)) b.photoIds = b.photoIds.filter((x) => x !== id);
    }
    return photo;
  });
}

// ---------------------------- Automation ------------------------------

export async function listEmailRules(): Promise<EmailRule[]> {
  const db = await ensureDB();
  return db.emailRules;
}

export async function updateEmailRule(
  id: EmailTrigger,
  patch: Partial<Omit<EmailRule, "id">>,
): Promise<EmailRule | undefined> {
  return withWriteLock(async (db) => {
    const rule = db.emailRules.find((r) => r.id === id);
    if (!rule) return undefined;
    Object.assign(rule, patch);
    return rule;
  });
}

export async function logEmail(entry: Omit<EmailLogEntry, "id" | "createdAt">): Promise<void> {
  await withWriteLock(async (db) => {
    db.emailLog.unshift({ ...entry, id: randomUUID(), createdAt: new Date().toISOString() });
    // Keep the log bounded — this is a JSON file, not a warehouse.
    if (db.emailLog.length > 500) db.emailLog.length = 500;
  });
}

export async function listEmailLog(limit = 100): Promise<EmailLogEntry[]> {
  const db = await ensureDB();
  return db.emailLog.slice(0, limit);
}

/** Has this trigger already fired for this booking? Stops duplicate sends. */
export async function hasEmailBeenSent(
  bookingId: string,
  trigger: EmailTrigger,
): Promise<boolean> {
  const db = await ensureDB();
  return db.emailLog.some(
    (e) => e.bookingId === bookingId && e.trigger === trigger && e.status === "sent",
  );
}

// ---------------------------- Bulk import -----------------------------

/**
 * Import customers from a CSV export. Existing emails are updated rather
 * than duplicated, so re-running the same file is safe.
 */
export async function importClients(
  rows: { name: string; email: string; phone: string; notes?: string }[],
): Promise<{ created: number; updated: number }> {
  return withWriteLock(async (db) => {
    let created = 0;
    let updated = 0;
    for (const row of rows) {
      const existing = db.clients.find(
        (c) => c.email.toLowerCase() === row.email.toLowerCase(),
      );
      if (existing) {
        existing.name = row.name || existing.name;
        existing.phone = row.phone || existing.phone;
        if (row.notes) existing.notes = row.notes;
        updated += 1;
      } else {
        db.clients.push({
          id: randomUUID(),
          name: row.name,
          email: row.email,
          phone: row.phone,
          notes: row.notes,
          createdAt: new Date().toISOString(),
        });
        created += 1;
      }
    }
    return { created, updated };
  });
}

export async function updateUserRole(userId: string, role: UserRole): Promise<User | undefined> {
  return withWriteLock(async (db) => {
    const user = db.users.find((u) => u.id === userId);
    if (!user) return undefined;
    // Never leave the shop without an owner — that would lock everyone out
    // of team management permanently.
    if (user.role === "owner" && role !== "owner") {
      const owners = db.users.filter((u) => u.role === "owner").length;
      if (owners <= 1) throw new Error("There must be at least one owner.");
    }
    user.role = role;
    return user;
  });
}

export async function deleteUser(userId: string): Promise<void> {
  await withWriteLock(async (db) => {
    const user = db.users.find((u) => u.id === userId);
    if (!user) return;
    if (user.role === "owner" && db.users.filter((u) => u.role === "owner").length <= 1) {
      throw new Error("You can't remove the last owner.");
    }
    db.users = db.users.filter((u) => u.id !== userId);
    // Sign them out everywhere immediately.
    db.sessions = db.sessions.filter((s) => s.userId !== userId);
  });
}

export async function adminSetUserPassword(
  userId: string,
  passwordHash: string,
  passwordSalt: string,
): Promise<void> {
  await withWriteLock(async (db) => {
    const user = db.users.find((u) => u.id === userId);
    if (!user) return;
    user.passwordHash = passwordHash;
    user.passwordSalt = passwordSalt;
    db.sessions = db.sessions.filter((s) => s.userId !== userId);
  });
}

// ---------------------------- Form fields -----------------------------

export async function listFormFields(): Promise<FormField[]> {
  const db = await ensureDB();
  return [...db.formFields].sort((a, b) => a.sortOrder - b.sortOrder);
}

export async function upsertFormField(field: FormField): Promise<FormField> {
  return withWriteLock(async (db) => {
    const i = db.formFields.findIndex((f) => f.id === field.id);
    if (i >= 0) db.formFields[i] = { ...db.formFields[i], ...field };
    else db.formFields.push(field);
    return field;
  });
}

export async function deleteFormField(id: string): Promise<void> {
  await withWriteLock(async (db) => {
    db.formFields = db.formFields.filter((f) => f.id !== id);
  });
}

// ---------------------------- Gallery ---------------------------------

export async function listGallery(): Promise<GalleryPair[]> {
  const db = await ensureDB();
  return [...db.gallery].sort((a, b) => a.sortOrder - b.sortOrder);
}

export async function upsertGalleryPair(pair: GalleryPair): Promise<GalleryPair> {
  return withWriteLock(async (db) => {
    const i = db.gallery.findIndex((g) => g.id === pair.id);
    if (i >= 0) db.gallery[i] = { ...db.gallery[i], ...pair };
    else db.gallery.push(pair);
    return pair;
  });
}

export async function deleteGalleryPair(id: string): Promise<GalleryPair | undefined> {
  return withWriteLock(async (db) => {
    const pair = db.gallery.find((g) => g.id === id);
    db.gallery = db.gallery.filter((g) => g.id !== id);
    return pair;
  });
}

// ---------------------- Email rules (incl. custom) ---------------------

export async function createEmailRule(rule: EmailRule): Promise<EmailRule> {
  return withWriteLock(async (db) => {
    db.emailRules.push(rule);
    return rule;
  });
}

export async function deleteEmailRule(id: string): Promise<void> {
  await withWriteLock(async (db) => {
    // Built-in rules can be disabled but not deleted — the code fires them
    // by id, so removing one would silently break that hook.
    db.emailRules = db.emailRules.filter((r) => !(r.id === id && r.custom));
  });
}

export async function setBookingCustomFields(
  bookingId: string,
  customFields: Record<string, string>,
): Promise<void> {
  await withWriteLock(async (db) => {
    const b = db.bookings.find((x) => x.id === bookingId);
    if (b) b.customFields = customFields;
  });
}
