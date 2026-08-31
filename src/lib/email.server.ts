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
    business: settings.businessName,
    businessPhone: settings.contactPhone,
    businessEmail: settings.contactEmail,
  };
}

/** Low-level send. Returns null on success, or an error message. */
export async function sendEmail(input: {
  to: string;
  subject: string;
  text: string;
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
        from: settings.emailFrom,
        to: [input.to],
        subject: input.subject,
        text: input.text,
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
  opts: { force?: boolean } = {},
): Promise<{ status: "sent" | "failed" | "skipped"; error?: string }> {
  const [rules, settings, client] = await Promise.all([
    listEmailRules(),
    getSettings(),
    findClientById(booking.clientId),
  ]);

  const rule = rules.find((r) => r.id === trigger);
  // Log the rendered subject, not the raw template — the log is meant to show
  // what the customer actually saw in their inbox.
  const vars = rule ? await buildVars(booking) : null;
  const renderedSubject = rule && vars ? renderTemplate(rule.subject, vars) : trigger;

  const record = async (status: "sent" | "failed" | "skipped", error?: string) => {
    await logEmail({
      to: client?.email ?? "unknown",
      subject: renderedSubject,
      trigger,
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
  if (!opts.force && (await hasEmailBeenSent(booking.id, trigger))) {
    return record("skipped", "Already sent for this booking.");
  }

  const error = await sendEmail({
    to: client.email,
    subject: renderedSubject,
    text: renderTemplate(rule.body, vars!),
  });

  return error ? record("failed", error) : record("sent");
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
    if (rule.id !== "reminder" && rule.id !== "after_service") continue;

    for (const booking of bookings) {
      if (booking.status === "cancelled") continue;
      checked += 1;

      // The booking's wall-clock start, read back in the business timezone.
      const start = new Date(`${booking.date}T${booking.startTime}:00`).getTime();
      if (Number.isNaN(start)) continue;

      const dueAt =
        rule.id === "reminder"
          ? start - rule.offsetHours * 3_600_000
          : start + booking.durationMinutes * 60_000 + rule.offsetHours * 3_600_000;

      if (now < dueAt) continue;
      // Don't send a reminder for something that already happened, or spam
      // follow-ups for ancient jobs on first run.
      if (rule.id === "reminder" && now > start) continue;
      if (rule.id === "after_service" && now > dueAt + 7 * 86_400_000) continue;

      if (await hasEmailBeenSent(booking.id, rule.id)) continue;
      const result = await runTrigger(rule.id, booking);
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
