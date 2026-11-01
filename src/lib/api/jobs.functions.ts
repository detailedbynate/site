import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// --------------------------------------------------------------------------
// Job mode (/admin/job/$id): the on-site flow for one booking —
// Arrive → Before photos → Checklist → After photos → Payment & finish.
// Progress (start time, ticked items, current step) is saved on the booking,
// so closing the app mid-job and coming back resumes exactly where you were.
// --------------------------------------------------------------------------

const idSchema = z.string().min(1).max(60);

/**
 * The checklist for a job: a walk-around first, then what the package
 * promises (its feature list), then each add-on, then the hand-over. Built
 * from the live catalog, so editing a package's features changes the list.
 */
function checklistFor(features: string[], addOns: string[]): string[] {
  const items = [
    "Walk-around with the customer — note any existing damage",
    ...features,
    ...addOns.map((a) => `Add-on: ${a}`),
    "Final inspection and hand-over",
  ];
  return [...new Set(items.map((i) => i.trim()).filter(Boolean))];
}

export const getJob = createServerFn({ method: "GET" })
  .inputValidator(z.object({ id: idSchema }))
  .handler(async ({ data }) => {
    const { requireUser } = await import("../auth.server");
    await requireUser();
    const { findBookingById, findClientById, listServices, getSettings } = await import("../db.server");
    const booking = await findBookingById(data.id);
    if (!booking) throw new Error("Booking not found.");
    const [client, services, settings] = await Promise.all([
      booking.clientId ? findClientById(booking.clientId) : undefined,
      listServices(),
      getSettings(),
    ]);
    const service = services.find((s) => s.id === booking.serviceId);
    const owed =
      (booking.totalPrice ?? 0) - (booking.discount ?? 0) + (booking.tip ?? 0) - (booking.amountPaid ?? 0);
    return {
      booking,
      client: client ?? null,
      checklist: checklistFor(service?.features ?? [], booking.addOnTitles ?? []),
      owed: Math.max(0, Math.round(owed * 100) / 100),
      businessName: settings.businessName,
    };
  });

/** "I'm here — start the job": stamps the start once; re-tapping keeps the first time. */
export const startJob = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: idSchema }))
  .handler(async ({ data }) => {
    const { requireUser } = await import("../auth.server");
    await requireUser();
    const { findBookingById, saveJobProgress } = await import("../db.server");
    const booking = await findBookingById(data.id);
    if (!booking) throw new Error("Booking not found.");
    if (booking.status === "cancelled") throw new Error("This booking is cancelled.");
    return {
      booking: await saveJobProgress(data.id, {
        jobStartedAt: booking.jobStartedAt ?? new Date().toISOString(),
        jobStep: Math.max(booking.jobStep ?? 0, 1),
      }),
    };
  });

export const saveJob = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      id: idSchema,
      step: z.number().int().min(0).max(4).optional(),
      checklist: z.array(z.string().max(200)).max(60).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { requireUser } = await import("../auth.server");
    await requireUser();
    const { saveJobProgress } = await import("../db.server");
    const booking = await saveJobProgress(data.id, { jobStep: data.step, jobChecklist: data.checklist });
    if (!booking) throw new Error("Booking not found.");
    return { ok: true };
  });

/**
 * Finish: record the payment (if any) and stamp the finish time. Marking the
 * booking completed goes through the existing setBookingStatus on the client,
 * so the calendar sync, webhooks and completion emails all run exactly as
 * they do from Appointments.
 */
export const finishJob = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      id: idSchema,
      paid: z.boolean(),
      tip: z.number().min(0).max(100000).default(0),
      method: z.string().max(40).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { requireUser } = await import("../auth.server");
    await requireUser();
    const { findBookingById, updateBookingPayment, saveJobProgress } = await import("../db.server");
    const booking = await findBookingById(data.id);
    if (!booking) throw new Error("Booking not found.");

    if (data.paid) {
      const total = (booking.totalPrice ?? 0) - (booking.discount ?? 0) + data.tip;
      await updateBookingPayment(data.id, {
        tip: data.tip || undefined,
        amountPaid: Math.round(total * 100) / 100,
        paymentStatus: "paid",
        paymentMethod: data.method,
      });
    } else if (data.tip) {
      await updateBookingPayment(data.id, { tip: data.tip });
    }
    await saveJobProgress(data.id, { jobFinishedAt: new Date().toISOString(), jobStep: 4 });
    return { ok: true };
  });
