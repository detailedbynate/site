import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// --------------------------------------------------------------------------
// Customer self-service: view, move or cancel your own booking from a link.
//
// Authentication is the token in the link and nothing else. That means every
// handler here must look the booking up BY TOKEN — never accept a booking id
// from the client — or the link stops being a key and becomes a suggestion.
//
// Nothing here requires an account, and nothing here can see another
// customer's booking.
// --------------------------------------------------------------------------

const tokenSchema = z.string().min(16).max(120);

/** Booking start as a real instant, in the business timezone. */
async function startInstant(booking: { date: string; startTime: string }): Promise<string> {
  const { getSettings } = await import("../db.server");
  const { zonedTimeToISO } = await import("../availability.server");
  const settings = await getSettings();
  const [h, m] = booking.startTime.split(":").map(Number);
  return zonedTimeToISO(booking.date, h * 60 + m, settings.timezone);
}

/**
 * Reconcile a booking's Stripe links against Stripe.
 *
 * This project takes no inbound webhooks, so payment state is pulled at the
 * moments it matters — chiefly when the customer comes back from paying.
 * Cheap: it only calls Stripe for links that are recorded but not yet marked
 * paid, so a settled booking costs nothing.
 */
async function reconcilePayments(bookingId: string) {
  const { findBookingById, updateBookingCharges } = await import("../db.server");
  const booking = await findBookingById(bookingId);
  if (!booking) return undefined;

  const { isPaymentLinkPaid } = await import("../stripe.server");
  const patch: Record<string, unknown> = {};

  if (booking.depositLinkId && !booking.depositPaidAt) {
    const res = await isPaymentLinkPaid(booking.depositLinkId);
    if (res?.paid) patch.depositPaidAt = res.paidAt ?? new Date().toISOString();
  }
  if (booking.cancelFeeLinkId && !booking.cancelFeePaidAt) {
    const res = await isPaymentLinkPaid(booking.cancelFeeLinkId);
    if (res?.paid) patch.cancelFeePaidAt = res.paidAt ?? new Date().toISOString();
  }

  if (!Object.keys(patch).length) return booking;
  return await updateBookingCharges(bookingId, patch);
}

/** Everything the manage page needs, resolved from the link's token. */
export const getManagedBooking = createServerFn({ method: "GET" })
  .inputValidator(z.object({ token: tokenSchema }))
  .handler(async ({ data }) => {
    const { findBookingByToken, findClientById, getSettings } = await import("../db.server");
    const { evaluateCancellation, canReschedule, describePolicy } = await import("../policy");

    let booking = await findBookingByToken(data.token);
    if (!booking) return { found: false as const };

    booking = (await reconcilePayments(booking.id)) ?? booking;

    const [client, settings] = await Promise.all([
      booking.clientId ? findClientById(booking.clientId) : undefined,
      getSettings(),
    ]);

    const startISO = await startInstant(booking);
    const forPolicy = {
      status: booking.status,
      startISO,
      total: booking.totalPrice,
      depositPaid: booking.depositPaidAt ? (booking.depositAmount ?? 0) : 0,
    };

    return {
      found: true as const,
      booking: {
        reference: booking.reference,
        status: booking.status,
        date: booking.date,
        startTime: booking.startTime,
        startISO,
        durationMinutes: booking.durationMinutes,
        serviceTitle: booking.serviceTitle,
        addOnTitles: booking.addOnTitles ?? [],
        location: booking.location,
        address: booking.address,
        totalPrice: booking.totalPrice,
        discount: booking.discount ?? 0,
        depositAmount: booking.depositAmount ?? 0,
        depositPaid: Boolean(booking.depositPaidAt),
        depositUrl: booking.depositPaidAt ? undefined : booking.depositUrl,
        cancelFeeAmount: booking.cancelFeeAmount ?? 0,
        cancelFeePaid: Boolean(booking.cancelFeePaidAt),
        cancelFeeUrl: booking.cancelFeePaidAt ? undefined : booking.cancelFeeUrl,
        customerName: client?.name ?? "",
      },
      business: {
        name: settings.businessName,
        phone: settings.contactPhone,
        email: settings.contactEmail,
      },
      policy: describePolicy(settings),
      cancellation: evaluateCancellation(settings, forPolicy, new Date()),
      reschedule: canReschedule(settings, forPolicy, new Date()),
    };
  });

/** Open days for the customer to move their own booking into. */
export const getManagedBookingDays = createServerFn({ method: "GET" })
  .inputValidator(z.object({ token: tokenSchema }))
  .handler(async ({ data }) => {
    const { findBookingByToken, getSettings } = await import("../db.server");
    const { getAvailableDays } = await import("../availability.server");
    const { canReschedule } = await import("../policy");

    const booking = await findBookingByToken(data.token);
    if (!booking) return { days: [] };

    const settings = await getSettings();
    const allowed = canReschedule(
      settings,
      {
        status: booking.status,
        startISO: await startInstant(booking),
        total: booking.totalPrice,
        depositPaid: 0,
      },
      new Date(),
    );
    if (!allowed.allowed) return { days: [] };

    // Its own slot is excluded from the busy set, same as an admin reschedule.
    const days = await getAvailableDays(booking.durationMinutes, booking.id, booking.location);
    return { days };
  });

export const getManagedBookingSlots = createServerFn({ method: "GET" })
  .inputValidator(
    z.object({ token: tokenSchema, date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
  )
  .handler(async ({ data }) => {
    const { findBookingByToken } = await import("../db.server");
    const { getAvailableSlots } = await import("../availability.server");

    const booking = await findBookingByToken(data.token);
    if (!booking) return { slots: [] };

    const slots = await getAvailableSlots(
      data.date,
      booking.durationMinutes,
      booking.id,
      booking.location,
    );
    return { slots: slots.map((s) => ({ startTime: s.startTime })) };
  });

/** Move a booking. Re-checks the policy and the slot server-side. */
export const rescheduleOwnBooking = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      token: tokenSchema,
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      startTime: z.string().regex(/^\d{2}:\d{2}$/),
    }),
  )
  .handler(async ({ data }) => {
    const { findBookingByToken, getSettings, rescheduleBooking } = await import("../db.server");
    const { getAvailableSlots } = await import("../availability.server");
    const { canReschedule } = await import("../policy");

    const booking = await findBookingByToken(data.token);
    if (!booking) throw new Error("We couldn't find that booking.");

    const settings = await getSettings();
    // Re-checked here, not just in the UI: the page could have been open for
    // hours, and the cutoff may have passed while it sat there.
    const allowed = canReschedule(
      settings,
      {
        status: booking.status,
        startISO: await startInstant(booking),
        total: booking.totalPrice,
        depositPaid: 0,
      },
      new Date(),
    );
    if (!allowed.allowed) throw new Error(allowed.reason ?? "This booking can't be moved.");

    const slots = await getAvailableSlots(
      data.date,
      booking.durationMinutes,
      booking.id,
      booking.location,
    );
    if (!slots.some((s) => s.startTime === data.startTime)) {
      throw new Error("That time has just been taken. Please pick another.");
    }

    await rescheduleBooking(booking.id, data.date, data.startTime);
    const { syncBookingToCalendar } = await import("../calendar-sync.server");
    await syncBookingToCalendar(booking.id);

    // Re-send the confirmation rather than inventing a "rescheduled" trigger:
    // the customer needs the new date and time, which is exactly what the
    // confirmation says, and it keeps the templates the owner edits to one.
    void import("../email.server")
      .then(async ({ runTriggerAndCustom }) => {
        const { findBookingById } = await import("../db.server");
        const fresh = await findBookingById(booking.id);
        if (fresh) await runTriggerAndCustom("booking_confirmed", fresh);
      })
      .catch(() => undefined);

    return { ok: true as const, date: data.date, startTime: data.startTime };
  });

/**
 * Cancel a booking, or produce the payment link that unlocks cancelling.
 *
 * The fee is charged BEFORE the cancellation goes through. Cancelling first
 * and invoicing after would mean handing back the slot and then chasing
 * someone who no longer has any reason to pay.
 */
export const cancelOwnBooking = createServerFn({ method: "POST" })
  .inputValidator(z.object({ token: tokenSchema, reason: z.string().max(400).optional() }))
  .handler(async ({ data }) => {
    const { findBookingByToken, getSettings, updateBookingStatus, updateBookingCharges } =
      await import("../db.server");
    const { evaluateCancellation } = await import("../policy");

    let booking = await findBookingByToken(data.token);
    if (!booking) throw new Error("We couldn't find that booking.");

    booking = (await reconcilePayments(booking.id)) ?? booking;

    const settings = await getSettings();
    const outcome = evaluateCancellation(
      settings,
      {
        status: booking.status,
        startISO: await startInstant(booking),
        total: booking.totalPrice,
        depositPaid: booking.depositPaidAt ? (booking.depositAmount ?? 0) : 0,
      },
      new Date(),
    );

    if (outcome.kind === "unavailable") throw new Error(outcome.reason);
    if (outcome.kind === "locked") {
      throw new Error(
        `Cancelling online isn't possible inside ${outcome.lockHours} hours of your appointment — please call ${settings.contactPhone || "us"}.`,
      );
    }

    if (outcome.kind === "fee") {
      // Already settled? Then the cancellation may proceed.
      if (!booking.cancelFeePaidAt) {
        // Reuse the existing link rather than minting a second one for the
        // same fee — two live links is two ways to be paid twice.
        if (booking.cancelFeeUrl && booking.cancelFeeAmount === outcome.fee) {
          return { ok: false as const, needsPayment: true as const, fee: outcome.fee, url: booking.cancelFeeUrl };
        }
        const { createPaymentLink, isStripeConfigured } = await import("../stripe.server");
        // A fee is owed but there is no way to take it — which can happen if
        // Stripe is disconnected after the policy was set. Never cancel for
        // free in that case, and never show the customer an error written
        // for the shop owner.
        if (!isStripeConfigured(settings)) {
          throw new Error(
            `A $${outcome.fee} cancellation fee applies to this booking, and card payments are temporarily unavailable. Please call ${settings.contactPhone || "us"} and we'll sort it out.`,
          );
        }
        const link = await createPaymentLink({
          amount: outcome.fee,
          description: `Late cancellation fee — ${booking.serviceTitle} (${booking.reference})`,
          reference: booking.reference,
        });
        await updateBookingCharges(booking.id, {
          cancelFeeAmount: outcome.fee,
          cancelFeeUrl: link.url,
          cancelFeeLinkId: link.id,
        });
        return { ok: false as const, needsPayment: true as const, fee: outcome.fee, url: link.url };
      }
    }

    const updated = await updateBookingStatus(
      booking.id,
      "cancelled",
      data.reason?.trim() || "Cancelled by the customer.",
    );

    // Free the calendar, and stop any unpaid deposit link being payable for
    // a job that is no longer happening.
    const { syncBookingToCalendar } = await import("../calendar-sync.server");
    await syncBookingToCalendar(booking.id);
    if (booking.depositLinkId && !booking.depositPaidAt) {
      void import("../stripe.server")
        .then(({ deactivatePaymentLink }) => deactivatePaymentLink(booking!.depositLinkId!))
        .catch(() => undefined);
    }

    if (updated) {
      void import("../webhooks.server")
        .then(({ sendWebhook }) => sendWebhook("booking_cancelled", updated))
        .catch(() => undefined);
      void import("../email.server")
        .then(({ runTriggerAndCustom }) => runTriggerAndCustom("booking_cancelled", updated))
        .catch(() => undefined);
    }

    return { ok: true as const, needsPayment: false as const };
  });
