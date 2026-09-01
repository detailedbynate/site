import { createHmac } from "node:crypto";

import { getSettings, type Booking } from "./db.server";

// Outgoing webhooks. One POST per booking event, so the shop can pipe
// bookings into Zapier / Make / n8n / a spreadsheet without this app needing
// to integrate with any of them individually.

export type WebhookEvent = "booking_created" | "booking_cancelled" | "booking_completed";

/**
 * Signed with HMAC-SHA256 over the exact body, the way Stripe and GitHub do
 * it. The receiver recomputes the digest to prove the call really came from
 * here — without it, anyone who learns the URL can post fake bookings.
 */
function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

export async function sendWebhook(event: WebhookEvent, booking: Booking): Promise<void> {
  const settings = await getSettings();
  const url = settings.webhookUrl?.trim();
  if (!url) return;
  if (settings.webhookEvents?.length && !settings.webhookEvents.includes(event)) return;

  const body = JSON.stringify({
    event,
    sentAt: new Date().toISOString(),
    booking: {
      id: booking.id,
      reference: booking.reference,
      status: booking.status,
      date: booking.date,
      startTime: booking.startTime,
      durationMinutes: booking.durationMinutes,
      service: booking.serviceTitle,
      addOns: booking.addOnTitles,
      location: booking.location,
      address: booking.address,
      vehicle: booking.vehicle,
      total: booking.totalPrice,
      discount: booking.discount ?? 0,
      tip: booking.tip ?? 0,
    },
  });

  const headers: Record<string, string> = {
    "content-type": "application/json",
    "user-agent": "DetailedByNate-Webhook/1",
    "x-dbn-event": event,
  };
  if (settings.webhookSecret?.trim()) {
    headers["x-dbn-signature"] = sign(body, settings.webhookSecret.trim());
  }

  // Never let a broken endpoint take a booking down with it. A webhook is a
  // notification, not part of the transaction.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    await fetch(url, { method: "POST", headers, body, signal: controller.signal });
  } catch (err) {
    console.error(`Webhook ${event} failed:`, err);
  } finally {
    clearTimeout(timer);
  }
}

/** Fire a sample payload so the shop can confirm the endpoint receives it. */
export async function sendTestWebhook(): Promise<{ status: number; ok: boolean }> {
  const settings = await getSettings();
  const url = settings.webhookUrl?.trim();
  if (!url) throw new Error("Add a webhook URL first.");

  const body = JSON.stringify({
    event: "test",
    sentAt: new Date().toISOString(),
    message: "Test delivery from Detailed by Nate.",
  });

  const headers: Record<string, string> = {
    "content-type": "application/json",
    "user-agent": "DetailedByNate-Webhook/1",
    "x-dbn-event": "test",
  };
  if (settings.webhookSecret?.trim()) {
    headers["x-dbn-signature"] = sign(body, settings.webhookSecret.trim());
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, { method: "POST", headers, body, signal: controller.signal });
    return { status: res.status, ok: res.ok };
  } catch (err) {
    throw new Error(
      err instanceof Error && err.name === "AbortError"
        ? "The endpoint didn't respond within 8 seconds."
        : "Couldn't reach that URL.",
    );
  } finally {
    clearTimeout(timer);
  }
}
