import {
  findBookingById,
  findClientById,
  setBookingGoogleEventId,
  type Booking,
  type Client,
} from "./db.server";
import {
  createCalendarEvent,
  deleteCalendarEvent,
  updateCalendarEvent,
} from "./google-calendar.server";

// --------------------------------------------------------------------------
// Server-only. One place that answers "what should Google look like for this
// booking?", so every path that changes a booking keeps the calendar in step.
//
// Before this existed the four call sites each did their own thing, and each
// had a different hole:
//   - editing a booking didn't touch Google at all, so changing Silver to
//     Diamond left a 1.5 hour block on the calendar for a 4 hour job;
//   - rescheduling rebuilt the event with a stub description, throwing away
//     the customer's phone, address, vehicle and add-ons — exactly what you
//     need on your phone when you turn up;
//   - cancelling deleted the event but left the booking pointing at its id,
//     so a restored job could never get back onto the calendar;
//   - restoring a cancelled booking never recreated the event.
// --------------------------------------------------------------------------

/** What the calendar entry should say for a booking, as Google fields. */
function describe(booking: Booking, client: Client | undefined) {
  const name = client?.name ?? "Client";
  const v = booking.vehicle;
  const vehicle = v && (v.year || v.make || v.model)
    ? [v.year, v.make, v.model].filter(Boolean).join(" ") + (v.color ? ` (${v.color})` : "")
    : "";

  const lines = [
    `Service: ${booking.serviceTitle}`,
    booking.addOnTitles?.length
      ? `Add-ons: ${booking.addOnTitles.join(", ")}`
      : "Add-ons: none",
    `Total: $${booking.totalPrice ?? 0}`,
    `Location: ${booking.location === "mobile" ? `Mobile — ${booking.address ?? ""}` : "At the shop"}`,
    vehicle ? `Vehicle: ${vehicle}` : undefined,
    `Client: ${name}`,
    client?.phone ? `Phone: ${client.phone}` : undefined,
    client?.email ? `Email: ${client.email}` : undefined,
    booking.notes ? `Notes: ${booking.notes}` : undefined,
    `Reference: ${booking.reference}`,
  ].filter(Boolean) as string[];

  return {
    summary: `${booking.serviceTitle} Detail — ${name}`,
    description: lines.join("\n"),
    location: booking.location === "mobile" ? booking.address : undefined,
    attendeeEmail: client?.email || undefined,
  };
}

/**
 * Make Google match this booking, whatever state it's in.
 *
 * Cancelled bookings lose their event and their link to it. Everything else
 * gets an event that matches the booking's current time, duration and
 * contents — patched in place when one already exists, recreated if it has
 * been deleted on Google's side.
 *
 * Never throws. A calendar problem must not take down the operation that
 * triggered it: the local booking is what governs availability, and the
 * failure is recorded for the Integrations page either way.
 */
export async function syncBookingToCalendar(bookingId: string): Promise<void> {
  try {
    const booking = await findBookingById(bookingId);
    if (!booking) return;

    if (booking.status === "cancelled") {
      if (booking.googleEventId) {
        await deleteCalendarEvent(booking.googleEventId).catch(() => undefined);
        // Clear the link even if the delete failed — a cancelled booking
        // should never keep claiming an event.
        await setBookingGoogleEventId(bookingId, null);
      }
      return;
    }

    const client = booking.clientId ? await findClientById(booking.clientId) : undefined;
    const { zonedTimeToISO } = await import("./availability.server");
    const { getSettings } = await import("./db.server");
    const settings = await getSettings();

    const [h, m] = booking.startTime.split(":").map(Number);
    const startISO = zonedTimeToISO(booking.date, h * 60 + m, settings.timezone);
    const endISO = new Date(
      new Date(startISO).getTime() + booking.durationMinutes * 60_000,
    ).toISOString();

    const input = { ...describe(booking, client), startISO, endISO };

    if (booking.googleEventId) {
      const patched = await updateCalendarEvent(booking.googleEventId, input);
      if (patched) return;
      // The event is gone from Google — fall through and make a new one.
    }

    const created = await createCalendarEvent(input);
    if (created && created !== booking.googleEventId) {
      await setBookingGoogleEventId(bookingId, created);
    }
  } catch (err) {
    console.error("Calendar sync failed for booking", bookingId, err);
  }
}
