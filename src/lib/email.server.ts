import {
  findClientById,
  getSettings,
  hasEmailBeenSent,
  listBookings,
  listEmailRules,
  logEmail,
  type Booking,
  type EmailTrigger,
} from "./db.server";
import { zonedTimeToISO } from "./availability.server";
import { describePolicy } from "./policy";

// Transactional email via Resend's HTTP API. Chosen over SMTP specifically
// because it's a plain fetch() — no nodemailer, no native deps, consistent
// with the rest of this project.
//
// Like Google Calendar, this is optional: with no API key configured every
// send is logged as "skipped" and nothing throws, so the booking flow keeps
// working before email is set up.

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export function isEmailConfigured(settings: { resendApiKey: string; emailFrom: string }): boolean {
  return Boolean(settings.resendApiKey && settings.emailFrom);
}

/** Fill {{placeholders}}. Unknown keys are left visible so typos are obvious. */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
    key in vars ? vars[key] : match,
  );
}

export async function buildVars(booking: Booking): Promise<Record<string, string>> {
  const [settings, client] = await Promise.all([
    getSettings(),
    findClientById(booking.clientId),
  ]);

  const date = new Date(`${booking.date}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const [h, m] = booking.startTime.split(":").map(Number);
  const time = `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;

  return {
    name: client?.name?.split(" ")[0] ?? "there",
    fullName: client?.name ?? "",
    email: client?.email ?? "",
    phone: client?.phone ?? "",
    service: booking.serviceTitle,
    addOns: booking.addOnTitles?.join(", ") || "none",
    date,
    time,
    reference: booking.reference,
    total: `$${(booking.totalPrice ?? 0) + (booking.tip ?? 0)}`,
    location: booking.location === "mobile" ? `Mobile — ${booking.address}` : "At the shop",
    vehicle: booking.vehicle
      ? `${booking.vehicle.year} ${booking.vehicle.make} ${booking.vehicle.model}`
      : "your vehicle",
    notes: booking.notes ?? "None",
    business: settings.businessName,
    businessPhone: settings.contactPhone,
    businessEmail: settings.contactEmail,
    // Self-service. `manageLink` is the whole point of the confirmation
    // email: it is how a customer moves or cancels without phoning.
    manageLink: manageUrl(settings.siteUrl, booking.manageToken),
    deposit: booking.depositAmount ? `$${booking.depositAmount}` : "",
    depositLink: booking.depositPaidAt ? "" : (booking.depositUrl ?? ""),
    balance: booking.depositPaidAt
      ? `$${Math.max(0, (booking.totalPrice ?? 0) - (booking.depositAmount ?? 0))}`
      : `$${booking.totalPrice ?? 0}`,
    policy: describePolicy(settings),
  };
}

/**
 * The customer's private link to their own booking.
 *
 * Blank when there's no site URL configured or the booking predates tokens —
 * a template that prints an empty string is better than one that prints a
 * link to nowhere.
 */
function manageUrl(siteUrl: string, token?: string): string {
  if (!siteUrl || !token) return "";
  return `${siteUrl.replace(/\/+$/, "")}/manage/${token}`;
}

/** Placeholder values so a template can be previewed with no bookings yet. */
export function sampleVars(): Record<string, string> {
  return {
    name: "Alex", fullName: "Alex Carter", email: "alex@email.com", phone: "(705) 555-0142",
    service: "Diamond", addOns: "Pet hair removal", date: "Friday, September 4",
    time: "10:00 AM", reference: "DBN-1234", total: "$444",
    location: "Mobile — 450 Great Northern Rd", vehicle: "2021 BMW M340i",
    business: "Detailed by Nate", businessPhone: "(705) 555-0100",
    businessEmail: "book@detailedbynate.com", notes: "Gate code 4417",
    manageLink: "https://example.com/manage/preview", deposit: "$111",
    depositLink: "https://example.com/pay", balance: "$333",
    policy: "Free cancellation up to 24 hours before.",
  };
}

/** Low-level send. Returns null on success, or an error message. */
/**
 * The From header: a display name and an address.
 *
 * Left alone if the address already carries a name (someone may have typed
 * the whole thing into the address field, which is what the docs used to tell
 * them to do), and quotes are stripped from the name because an unescaped one
 * produces a header Resend rejects outright.
 */
function fromHeader(name: string, address: string): string {
  const addr = address.trim();
  if (!name.trim() || addr.includes("<")) return addr;
  return `${name.trim().replace(/["<>]/g, "")} <${addr}>`;
}

export async function sendEmail(input: {
  to: string;
  subject: string;
  text: string;
  /** Optional branded version. Both are sent; clients pick what they can render. */
  html?: string;
}): Promise<string | null> {
  const settings = await getSettings();
  if (!isEmailConfigured(settings)) return "Email is not configured.";

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromHeader(settings.emailFromName, settings.emailFrom),
        to: [input.to],
        subject: input.subject,
        text: input.text,
        ...(input.html ? { html: input.html } : {}),
        ...(settings.emailReplyTo ? { reply_to: settings.emailReplyTo } : {}),
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return `Resend returned ${res.status}. ${detail.slice(0, 200)}`;
    }
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : "Network error sending email.";
  }
}

/**
 * Fire one automation rule for a booking. Always writes a log entry — a
 * "skipped" row is far more useful than silence when an owner asks why a
 * customer never got their confirmation.
 */
export async function runTrigger(
  trigger: EmailTrigger,
  booking: Booking,
  opts: { force?: boolean; ruleId?: string; extraVars?: Record<string, string> } = {},
): Promise<{ status: "sent" | "failed" | "skipped"; error?: string }> {
  const [rules, settings, client] = await Promise.all([
    listEmailRules(),
    getSettings(),
    findClientById(booking.clientId),
  ]);

  const rule = opts.ruleId
    ? rules.find((r) => r.id === opts.ruleId)
    : rules.find((r) => r.id === trigger);
  // Log the rendered subject, not the raw template — the log is meant to show
  // what the customer actually saw in their inbox.
  const vars = rule ? { ...(await buildVars(booking)), ...(opts.extraVars ?? {}) } : null;
  const renderedSubject = rule && vars ? renderTemplate(rule.subject, vars) : trigger;

  const record = async (status: "sent" | "failed" | "skipped", error?: string) => {
    await logEmail({
      to: client?.email ?? "unknown",
      subject: renderedSubject,
      trigger: (rule?.trigger ?? trigger) as EmailTrigger,
      status,
      error,
      bookingId: booking.id,
    });
    return { status, error };
  };

  if (!rule) return record("skipped", "No rule defined.");
  if (!rule.enabled && !opts.force) return record("skipped", "Rule is turned off.");
  if (!client?.email) return record("skipped", "Customer has no email address.");
  if (!isEmailConfigured(settings)) return record("skipped", "Email is not configured.");
  if (!opts.force && !rule.custom && (await hasEmailBeenSent(booking.id, trigger))) {
    return record("skipped", "Already sent for this booking.");
  }

  const { renderEmail } = await import("./email-html.server");
  // The invoice is built here rather than passed in, so the numbers on the
  // email come from the same builder the Payments page uses.
  let invoice;
  if (trigger === "invoice") {
    const { buildInvoice } = await import("./invoice");
    invoice = buildInvoice(booking, settings.travelFee);
  }
  const { text, html } = await renderEmail(rule.body, vars!, booking, invoice);

  const error = await sendEmail({
    to: client.email,
    subject: renderedSubject,
    text,
    html,
  });

  return error ? record("failed", error) : record("sent");
}

/**
 * Fire the built-in rule for `trigger` plus any custom rules the owner has
 * attached to the same trigger point.
 */
export async function runTriggerAndCustom(
  trigger: EmailTrigger,
  booking: Booking,
): Promise<void> {
  await runTrigger(trigger, booking).catch(() => undefined);

  const rules = await listEmailRules();
  for (const rule of rules) {
    if (!rule.custom || !rule.enabled || rule.trigger !== trigger) continue;
    // Time-based custom rules are handled by processScheduledEmails instead.
    if (trigger === "reminder" || trigger === "after_service") continue;
    await runTrigger(trigger, booking, { ruleId: rule.id }).catch(() => undefined);
  }
}

/**
 * Time-based rules (reminder before, follow-up after). Called on a timer
 * and also whenever an admin loads the dashboard, so a low-traffic single
 * instance still catches up even if the timer missed a tick.
 */
export async function processScheduledEmails(): Promise<{ sent: number; checked: number }> {
  const [rules, settings, bookings] = await Promise.all([
    listEmailRules(),
    getSettings(),
    listBookings(),
  ]);
  if (!isEmailConfigured(settings)) return { sent: 0, checked: 0 };

  const now = Date.now();
  let sent = 0;
  let checked = 0;

  for (const rule of rules) {
    if (!rule.enabled) continue;
    const point = rule.custom ? rule.trigger : (rule.id as EmailTrigger);
    if (point !== "reminder" && point !== "after_service") continue;

    for (const booking of bookings) {
      if (booking.status === "cancelled") continue;
      checked += 1;

      /*
        The booking's start as a real instant.

        This used to be `new Date("2026-09-02T12:00:00")` with no zone on it,
        which JavaScript reads in the SERVER's timezone. The server runs in
        UTC, so every reminder was computed against a start four or five hours
        off — a "24 hours before" reminder went out at 7 or 8pm the evening
        before instead of at midday, and follow-ups drifted the same way.
      */
      const [bh, bm] = booking.startTime.split(":").map(Number);
      const start = new Date(
        zonedTimeToISO(booking.date, bh * 60 + bm, settings.timezone),
      ).getTime();
      if (Number.isNaN(start)) continue;

      const dueAt =
        point === "reminder"
          ? start - rule.offsetHours * 3_600_000
          : start + booking.durationMinutes * 60_000 + rule.offsetHours * 3_600_000;

      if (now < dueAt) continue;
      // Don't send a reminder for something that already happened, or spam
      // follow-ups for ancient jobs on first run.
      if (point === "reminder" && now > start) continue;
      if (point === "after_service" && now > dueAt + 7 * 86_400_000) continue;

      // Built-ins de-dupe by trigger; custom rules must not block each other.
      if (!rule.custom && (await hasEmailBeenSent(booking.id, point))) continue;
      const result = await runTrigger(point, booking, rule.custom ? { ruleId: rule.id } : {});
      if (result.status === "sent") sent += 1;
    }
  }

  return { sent, checked };
}

// --------------------------------------------------------------------------
// Background scheduler. Reminders and follow-ups are time-based, so something
// has to tick. On an always-on Node host this interval is enough; it's
// deliberately conservative (every 15 minutes) because each pass reads the
// whole JSON store.
//
// Guarded on globalThis so Vite's HMR doesn't stack up duplicate timers in
// development.
// --------------------------------------------------------------------------

const TICK_MS = 15 * 60_000;
const KEY = "__dbn_email_scheduler__";

declare global {
  // eslint-disable-next-line no-var
  var __dbn_email_scheduler__: ReturnType<typeof setInterval> | undefined;
}

if (!globalThis[KEY as keyof typeof globalThis]) {
  const timer = setInterval(() => {
    processScheduledEmails().catch((err) =>
      console.error("Scheduled email pass failed:", err),
    );
  }, TICK_MS);
  // Don't hold the process open just for this.
  timer.unref?.();
  globalThis.__dbn_email_scheduler__ = timer;
}
