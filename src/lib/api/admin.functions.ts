import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { buildPeriodWindow, periodKey, type PeriodUnit } from "../periods";

// Every function here begins with requireUser(), which reads the HTTP-only
// session cookie and throws UNAUTHORIZED if it isn't a valid, unexpired
// session. That is the single choke point for admin authorization — there
// is no password field on these calls any more.

const idSchema = z.string().min(1).max(60);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// --------------------------- Dashboard --------------------------------

export const getDashboard = createServerFn({ method: "GET" })
  .inputValidator(
    z
      .object({
        unit: z.enum(["week", "month"]).default("month"),
        count: z.number().int().min(2).max(26).default(6),
      })
      .default({ unit: "month", count: 6 }),
  )
  .handler(async ({ data }) => {
  const { listBookingsWithClients, listClients, getSettings } = await import("../db.server");
  const { requireUser } = await import("../auth.server");
  await requireUser();

  const [bookings, clients, settings] = await Promise.all([
    listBookingsWithClients(),
    listClients(),
    getSettings(),
  ]);

  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: settings.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  const active = bookings.filter((b) => b.status !== "cancelled");
  const upcoming = active
    .filter((b) => b.date >= today && b.status === "confirmed")
    .sort((a, b) => `${a.date}T${a.startTime}`.localeCompare(`${b.date}T${b.startTime}`));

  const thisMonth = today.slice(0, 7);
  // Tips are real money earned, so they belong in revenue.
  const earned = (b: { totalPrice?: number; tip?: number; discount?: number }) =>
    (b.totalPrice ?? 0) - (b.discount ?? 0) + (b.tip ?? 0);

  const revenueThisMonth = active
    .filter((b) => b.date.startsWith(thisMonth) && b.status === "completed")
    .reduce((sum, b) => sum + earned(b), 0);

  const pipeline = upcoming.reduce((sum, b) => sum + (b.totalPrice ?? 0), 0);

  // Last calendar month, computed here rather than read off the chart: the
  // chart can be showing weeks, in which case there is no "last month"
  // bucket to look at and the comparison would silently read zero.
  const prevMonthKey = (() => {
    const d = new Date(`${today}T12:00:00`);
    d.setDate(1);
    d.setMonth(d.getMonth() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  })();

  // Revenue for the last 6 months, oldest first — drives the dashboard chart.
  // The window extends past the current month when completed work is dated
  // there, so finishing a job booked for early next month moves the graph
  // immediately instead of waiting for the month to roll over.
  const completedBookings = active.filter((b) => b.status === "completed");
  const unit: PeriodUnit = data.unit;
  const months = buildPeriodWindow(
    today,
    unit,
    data.count,
    completedBookings.map((b) => b.date),
  ).map((bucket) => {
    const inPeriod = completedBookings.filter((b) => periodKey(b.date, unit) === bucket.key);
    // Confirmed work in the same period, shown alongside as pipeline so the
    // chart says what is booked as well as what has been earned.
    const bookedIn = active.filter(
      (b) => b.status === "confirmed" && periodKey(b.date, unit) === bucket.key,
    );
    return {
      month: bucket.key,
      label: bucket.label,
      start: bucket.start,
      end: bucket.end,
      revenue: inPeriod.reduce((s, b) => s + earned(b), 0),
      jobs: inPeriod.length,
      booked: bookedIn.reduce((s, b) => s + earned(b), 0),
      bookedJobs: bookedIn.length,
    };
  });

  // Completed work dated in a future month is real money that "this month"
  // legitimately excludes. Reported separately so it can be shown rather
  // than silently vanishing between the tile and the chart.
  const aheadRevenue = completedBookings
    .filter((b) => b.date.slice(0, 7) > thisMonth)
    .reduce((s, b) => s + earned(b), 0);

  // Which packages actually sell.
  //
  // COMPLETED jobs only, deliberately. This used to count every non-cancelled
  // booking, so a job that was merely booked contributed revenue here while
  // the chart beside it counted only finished work — the two cards disagreed
  // and neither was obviously wrong. Same basis everywhere now.
  const byService = new Map<string, { title: string; count: number; revenue: number }>();
  for (const b of completedBookings) {
    const entry = byService.get(b.serviceId) ?? { title: b.serviceTitle, count: 0, revenue: 0 };
    entry.count += 1;
    entry.revenue += earned(b);
    byService.set(b.serviceId, entry);
  }

  return {
    stats: {
      todayCount: active.filter((b) => b.date === today && b.status === "confirmed").length,
      upcomingCount: upcoming.length,
      totalClients: clients.length,
      revenueThisMonth,
      revenueLastMonth: active
        .filter((b) => b.date.startsWith(prevMonthKey) && b.status === "completed")
        .reduce((sum, b) => sum + earned(b), 0),
      aheadRevenue,
      // The current calendar month, so the client can locate it in `months`
      // rather than assuming it is the last bucket — it is not, whenever the
      // window has been extended to cover future-dated work.
      thisMonthKey: thisMonth,
      pipeline,
      completedAllTime: active.filter((b) => b.status === "completed").length,
      cancelledAllTime: bookings.filter((b) => b.status === "cancelled").length,
      // Completed only, to match how revenue is counted everywhere else.
      tipsThisMonth: completedBookings
        .filter((b) => b.date.startsWith(thisMonth))
        .reduce((sum, b) => sum + (b.tip ?? 0), 0),
    },
    today: active
      .filter((b) => b.date === today)
      .sort((a, b) => a.startTime.localeCompare(b.startTime)),
    upcoming: upcoming.slice(0, 8),
    months,
    unit,
    byService: [...byService.values()].sort((a, b) => b.revenue - a.revenue),
  };
  });

// -------------------------- Appointments ------------------------------

export const listAppointments = createServerFn({ method: "GET" }).handler(async () => {
  const { listBookingsWithClients } = await import("../db.server");
  const { requireUser } = await import("../auth.server");
  await requireUser();
  return { bookings: await listBookingsWithClients() };
});

/**
 * Change a booking's status.
 *
 * Cancelling is the important one: `listBookingsForDate` (which feeds the
 * availability calculation) filters out cancelled bookings, so the slot
 * becomes bookable again the instant this returns. We also delete the
 * Google Calendar event so the slot isn't still blocked by freebusy.
 */
export const setBookingStatus = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      bookingId: idSchema,
      status: z.enum(["confirmed", "completed", "cancelled"]),
      reason: z.string().max(300).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { findBookingById, updateBookingStatus } = await import("../db.server");
    const { deleteCalendarEvent } = await import("../google-calendar.server");
    const { requireUser } = await import("../auth.server");
    await requireUser();

    const existing = await findBookingById(data.bookingId);
    if (!existing) throw new Error("Booking not found.");

    // Un-cancelling has to re-check the slot: cancelling frees it, so
    // someone else may have taken that time in the meantime. Without this,
    // restoring would silently double-book.
    if (existing.status === "cancelled" && data.status !== "cancelled") {
      const { getAvailableSlots } = await import("../availability.server");
      const slots = await getAvailableSlots(
        existing.date,
        existing.durationMinutes,
        existing.id,
      );
      if (!slots.some((s) => s.startTime === existing.startTime)) {
        throw new Error(
          "That time has since been booked by someone else. Reschedule this appointment instead of restoring it.",
        );
      }
    }

    const booking = await updateBookingStatus(data.bookingId, data.status, data.reason);

    if (data.status === "cancelled" && booking) {
      const { runTriggerAndCustom } = await import("../email.server");
      // Fire-and-forget: a mail failure must not block freeing the slot.
      void runTriggerAndCustom("booking_cancelled", booking).catch(() => undefined);
    }

    // Notify any configured webhook of the state change, same fire-and-forget
    // contract — an unreachable endpoint must never block the status update.
    if (booking && (data.status === "cancelled" || data.status === "completed")) {
      void import("../webhooks.server")
        .then(({ sendWebhook }) =>
          sendWebhook(data.status === "cancelled" ? "booking_cancelled" : "booking_completed", booking),
        )
        .catch(() => undefined);
    }

    if (data.status === "cancelled" && existing.googleEventId) {
      // Best-effort: a Calendar hiccup shouldn't block freeing the slot
      // locally, which is what actually governs availability.
      await deleteCalendarEvent(existing.googleEventId).catch((err) =>
        console.error("Failed to delete calendar event on cancel:", err),
      );
    }

    return { booking };
  });

/** Slots available for moving an existing booking (its own time included). */
export const getRescheduleOptions = createServerFn({ method: "GET" })
  .inputValidator(z.object({ bookingId: idSchema, date: dateSchema }))
  .handler(async ({ data }) => {
    const { findBookingById } = await import("../db.server");
    const { getAvailableSlots } = await import("../availability.server");
    const { requireUser } = await import("../auth.server");
    await requireUser();

    const booking = await findBookingById(data.bookingId);
    if (!booking) throw new Error("Booking not found.");

    // Ignore this booking's own block, otherwise it would rule out the very
    // times adjacent to where it already sits.
    const slots = await getAvailableSlots(data.date, booking.durationMinutes, booking.id);
    return { slots: slots.map((s) => ({ startTime: s.startTime, startISO: s.startISO })) };
  });

export const rescheduleAppointment = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      bookingId: idSchema,
      date: dateSchema,
      startTime: z.string().regex(/^\d{2}:\d{2}$/),
    }),
  )
  .handler(async ({ data }) => {
    const { findBookingById, findClientById, rescheduleBooking } = await import("../db.server");
    const { getAvailableSlots } = await import("../availability.server");
    const { createCalendarEvent, deleteCalendarEvent } = await import("../google-calendar.server");
    const { requireUser } = await import("../auth.server");
    await requireUser();

    const booking = await findBookingById(data.bookingId);
    if (!booking) throw new Error("Booking not found.");

    const slots = await getAvailableSlots(data.date, booking.durationMinutes, booking.id);
    const match = slots.find((s) => s.startTime === data.startTime);
    if (!match) throw new Error("That slot isn't available any more.");

    // Replace the calendar event rather than trying to patch it.
    let googleEventId: string | undefined;
    if (booking.googleEventId) {
      await deleteCalendarEvent(booking.googleEventId).catch(() => undefined);
    }
    const client = await findClientById(booking.clientId);
    const endISO = new Date(
      new Date(match.startISO).getTime() + booking.durationMinutes * 60_000,
    ).toISOString();

    const created = await createCalendarEvent({
      summary: `${booking.serviceTitle} Detail — ${client?.name ?? "Client"}`,
      description: `Rescheduled. Reference ${booking.reference}.`,
      startISO: match.startISO,
      endISO,
      attendeeEmail: client?.email,
      location: booking.location === "mobile" ? booking.address : undefined,
    }).catch(() => null);
    googleEventId = created ?? undefined;

    const updated = await rescheduleBooking(
      data.bookingId,
      data.date,
      data.startTime,
      googleEventId,
    );
    return { booking: updated };
  });

/** Hard-delete. Cancelling is preferred; this is for scrubbing test data. */
export const removeAppointment = createServerFn({ method: "POST" })
  .inputValidator(z.object({ bookingId: idSchema }))
  .handler(async ({ data }) => {
    const { findBookingById, deleteBooking } = await import("../db.server");
    const { deleteCalendarEvent } = await import("../google-calendar.server");
    const { requireRole } = await import("../auth.server");
    await requireRole("owner");

    const existing = await findBookingById(data.bookingId);
    if (existing?.googleEventId) {
      await deleteCalendarEvent(existing.googleEventId).catch(() => undefined);
    }
    await deleteBooking(data.bookingId);
    return { ok: true };
  });

// --------------------------- Customers --------------------------------

export const listCustomers = createServerFn({ method: "GET" }).handler(async () => {
  const { listClients, listBookings } = await import("../db.server");
  const { requireUser } = await import("../auth.server");
  await requireUser();

  const [clients, bookings] = await Promise.all([listClients(), listBookings()]);

  return {
    clients: clients.map((c) => {
      const theirs = bookings.filter((b) => b.clientId === c.id && b.status !== "cancelled");
      return {
        ...c,
        bookingCount: theirs.length,
        lifetimeValue: theirs
          .filter((b) => b.status === "completed")
          .reduce((s, b) => s + (b.totalPrice ?? 0), 0),
        lastVisit: theirs.map((b) => b.date).sort().at(-1) ?? null,
      };
    }),
  };
});

export const saveCustomer = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      id: idSchema.optional(),
      name: z.string().min(1).max(120),
      email: z.string().email().max(255),
      phone: z.string().min(7).max(30),
      notes: z.string().max(1000).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { addClientManual, updateClient } = await import("../db.server");
    const { requireUser } = await import("../auth.server");
    await requireUser();

    const client = data.id
      ? await updateClient(data.id, data)
      : await addClientManual(data);
    if (!client) throw new Error("Customer not found.");
    return { client };
  });

export const removeCustomer = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: idSchema }))
  .handler(async ({ data }) => {
    const { deleteClient, listBookings } = await import("../db.server");
    const { requireRole } = await import("../auth.server");
    await requireRole("owner");

    const bookings = await listBookings();
    if (bookings.some((b) => b.clientId === data.id && b.status === "confirmed")) {
      throw new Error("That customer still has upcoming bookings — cancel those first.");
    }
    await deleteClient(data.id);
    return { ok: true };
  });

// ---------------------------- Services --------------------------------

export const listCatalog = createServerFn({ method: "GET" }).handler(async () => {
  const { listServices, listAddOns } = await import("../db.server");
  const { requireUser } = await import("../auth.server");
  await requireUser();

  const [services, addOns] = await Promise.all([listServices(), listAddOns()]);
  return { services, addOns };
});

export const saveService = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      id: idSchema,
      title: z.string().min(1).max(60),
      subtitle: z.string().max(80).default(""),
      priceValue: z.number().int().min(0).max(100000),
      durationMinutes: z.number().int().min(15).max(1440),
      features: z.array(z.string().min(1).max(60)).max(12).default([]),
      description: z.string().max(600).default(""),
      active: z.boolean().default(true),
      sortOrder: z.number().int().min(0).max(999).default(0),
      // Estimated product cost per job — feeds the margin estimate on Finance.
      materialCost: z.number().min(0).max(100000).default(0),
    }),
  )
  .handler(async ({ data }) => {
    const { upsertService } = await import("../db.server");
    const { requireUser } = await import("../auth.server");
    await requireUser();
    return { service: await upsertService(data) };
  });

export const removeService = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: idSchema }))
  .handler(async ({ data }) => {
    const { deleteService } = await import("../db.server");
    const { requireRole } = await import("../auth.server");
    await requireRole("owner");
    await deleteService(data.id);
    return { ok: true };
  });

export const saveAddOn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      id: idSchema,
      name: z.string().min(1).max(60),
      detail: z.string().max(120).default(""),
      price: z.number().int().min(0).max(100000),
      durationMinutes: z.number().int().min(0).max(1440),
      active: z.boolean().default(true),
      sortOrder: z.number().int().min(0).max(999).default(0),
    }),
  )
  .handler(async ({ data }) => {
    const { upsertAddOn } = await import("../db.server");
    const { requireUser } = await import("../auth.server");
    await requireUser();
    return { addOn: await upsertAddOn(data) };
  });

export const removeAddOn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: idSchema }))
  .handler(async ({ data }) => {
    const { deleteAddOn } = await import("../db.server");
    const { requireRole } = await import("../auth.server");
    await requireRole("owner");
    await deleteAddOn(data.id);
    return { ok: true };
  });

// ---------------------------- Settings --------------------------------

export const getAdminSettings = createServerFn({ method: "GET" }).handler(async () => {
  const { getSettings } = await import("../db.server");
  const { requireUser } = await import("../auth.server");
  await requireUser();
  return { settings: await getSettings() };
});

export const saveSettings = createServerFn({ method: "POST" })
  .inputValidator(
    z
      .object({
        businessName: z.string().min(1).max(80),
        contactEmail: z.string().email().max(255),
        contactPhone: z.string().min(5).max(40),
        serviceArea: z.string().max(120),
        timezone: z.string().min(1).max(60),
        openHour: z.number().int().min(0).max(23),
        closeHour: z.number().int().min(1).max(24),
        slotIncrementMinutes: z.number().int().min(15).max(240),
        leadDays: z.number().int().min(0).max(60),
        closedDays: z.array(z.number().int().min(0).max(6)).max(7),
        bookingWindowDays: z.number().int().min(1).max(120),
        travelFee: z.number().int().min(0).max(10000),
      })
      .refine((s) => s.closeHour > s.openHour, {
        message: "Closing time must be after opening time.",
        path: ["closeHour"],
      })
      .refine((s) => s.closedDays.length < 7, {
        message: "You can't be closed every day.",
        path: ["closedDays"],
      }),
  )
  .handler(async ({ data }) => {
    const { updateSettings } = await import("../db.server");
    const { requireUser } = await import("../auth.server");
    await requireUser();

    // Reject a timezone the runtime can't resolve, otherwise every
    // availability calculation would throw later.
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: data.timezone });
    } catch {
      throw new Error(`"${data.timezone}" isn't a valid timezone.`);
    }

    return { settings: await updateSettings(data) };
  });

// ---------------------------- Coupons ---------------------------------

export const listAdminCoupons = createServerFn({ method: "GET" }).handler(async () => {
  const { listCoupons } = await import("../db.server");
  const { requireUser } = await import("../auth.server");
  await requireUser();
  return { coupons: await listCoupons() };
});

export const saveCoupon = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      id: idSchema.optional(),
      code: z.string().min(3).max(24).regex(/^[A-Za-z0-9_-]+$/, "Letters, numbers, - and _ only."),
      type: z.enum(["percent", "fixed"]),
      value: z.number().min(1).max(10000),
      active: z.boolean().default(true),
      maxUses: z.number().int().min(1).max(100000).optional(),
      expiresAt: z.string().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { upsertCoupon, findCouponByCode } = await import("../db.server");
    const { requireUser } = await import("../auth.server");
    const { randomUUID } = await import("node:crypto");
    await requireUser();

    if (data.type === "percent" && data.value > 100) {
      throw new Error("A percentage discount can't exceed 100%.");
    }

    const clash = await findCouponByCode(data.code);
    if (clash && clash.id !== data.id) throw new Error("That code already exists.");

    return {
      coupon: await upsertCoupon({
        id: data.id ?? randomUUID(),
        code: data.code,
        type: data.type,
        value: data.value,
        active: data.active,
        timesUsed: clash?.timesUsed ?? 0,
        maxUses: data.maxUses,
        expiresAt: data.expiresAt,
      }),
    };
  });

export const removeCoupon = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: idSchema }))
  .handler(async ({ data }) => {
    const { deleteCoupon } = await import("../db.server");
    const { requireUser } = await import("../auth.server");
    await requireUser();
    await deleteCoupon(data.id);
    return { ok: true };
  });

// ============================ Orders & payments =========================

/**
 * Orders are a view over bookings: each becomes an itemised order (package,
 * add-ons, travel, discount, tip) with payment state. There is no separate
 * orders table because an order and a booking are the same event here —
 * duplicating them would just create two things to keep in sync.
 */
export const listOrders = createServerFn({ method: "GET" }).handler(async () => {
  const { listBookingsWithClients, getSettings } = await import("../db.server");
  const { requireUser } = await import("../auth.server");
  await requireUser();

  const [bookings, settings] = await Promise.all([listBookingsWithClients(), getSettings()]);

  const orders = bookings.map((b) => {
    // Reconstruct the breakdown from what was stored on the booking.
    const travel = b.location === "mobile" ? settings.travelFee : 0;
    const base = (b.totalPrice ?? 0) - travel;
    const lines: { label: string; detail?: string; amount: number }[] = [
      { label: b.serviceTitle, detail: "Package", amount: base },
    ];
    if (b.addOnTitles?.length) {
      lines.push({
        label: "Add-ons",
        detail: b.addOnTitles.join(", "),
        amount: 0,
      });
    }
    if (travel) lines.push({ label: "Mobile travel", amount: travel });
    if (b.discount) lines.push({ label: "Discount", amount: -b.discount });
    if (b.tip) lines.push({ label: "Tip", detail: "Added after service", amount: b.tip });

    const grandTotal = (b.totalPrice ?? 0) - (b.discount ?? 0) + (b.tip ?? 0);
    const paid = b.amountPaid ?? 0;

    return {
      id: b.id,
      reference: b.reference,
      date: b.date,
      startTime: b.startTime,
      status: b.status,
      paymentStatus: b.paymentStatus ?? "unpaid",
      paymentMethod: b.paymentMethod,
      client: b.client,
      serviceTitle: b.serviceTitle,
      lines,
      subtotal: b.totalPrice ?? 0,
      discount: b.discount ?? 0,
      tip: b.tip ?? 0,
      grandTotal,
      amountPaid: paid,
      balance: Math.max(0, grandTotal - paid),
    };
  });

  const active = orders.filter((o) => o.status !== "cancelled");

  return {
    orders,
    totals: {
      collected: active
        .filter((o) => o.paymentStatus === "paid")
        .reduce((s, o) => s + o.grandTotal, 0),
      outstanding: active
        .filter((o) => o.paymentStatus !== "paid" && o.paymentStatus !== "refunded")
        .reduce((s, o) => s + o.balance, 0),
      tips: active.reduce((s, o) => s + o.tip, 0),
    },
  };
});

export const recordPayment = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      bookingId: idSchema,
      tip: z.number().min(0).max(100000).optional(),
      discount: z.number().min(0).max(100000).optional(),
      amountPaid: z.number().min(0).max(1000000).optional(),
      paymentStatus: z.enum(["unpaid", "partial", "paid", "refunded"]).optional(),
      paymentMethod: z.string().max(40).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { updateBookingPayment } = await import("../db.server");
    const { requireUser } = await import("../auth.server");
    await requireUser();

    const { bookingId, ...patch } = data;
    const booking = await updateBookingPayment(bookingId, patch);
    if (!booking) throw new Error("Booking not found.");
    return { booking };
  });

// ============================ Photos ====================================

export const uploadPhoto = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      bookingId: idSchema.optional(),
      clientId: idSchema.optional(),
      kind: z.enum(["before", "after", "other"]).default("other"),
      mime: z.enum(["image/jpeg", "image/png", "image/webp"]),
      // Base64 without the data: prefix. ~5.6MB of base64 = 4MB binary.
      base64: z.string().min(1).max(6_000_000),
      caption: z.string().max(120).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { addPhoto } = await import("../db.server");
    const { savePhotoFile } = await import("../uploads.server");
    const { requireUser } = await import("../auth.server");
    const { randomUUID } = await import("node:crypto");
    await requireUser();

    const id = randomUUID();
    const size = await savePhotoFile(id, data.mime, data.base64);
    const photo = await addPhoto({
      id,
      bookingId: data.bookingId,
      clientId: data.clientId,
      kind: data.kind,
      mime: data.mime,
      size,
      caption: data.caption,
    });
    return { photo };
  });

export const getPhotos = createServerFn({ method: "GET" })
  .inputValidator(z.object({ bookingId: idSchema.optional(), clientId: idSchema.optional() }))
  .handler(async ({ data }) => {
    const { listPhotos } = await import("../db.server");
    const { readPhotoDataUrl } = await import("../uploads.server");
    const { requireUser } = await import("../auth.server");
    await requireUser();

    const photos = await listPhotos(data);
    const withData = await Promise.all(
      photos.map(async (p) => ({ ...p, dataUrl: await readPhotoDataUrl(p.id, p.mime) })),
    );
    return { photos: withData };
  });

export const deletePhotoById = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: idSchema }))
  .handler(async ({ data }) => {
    const { deletePhoto } = await import("../db.server");
    const { deletePhotoFile } = await import("../uploads.server");
    const { requireUser } = await import("../auth.server");
    await requireUser();

    const photo = await deletePhoto(data.id);
    if (photo) await deletePhotoFile(photo.id, photo.mime);
    return { ok: true };
  });

// ============================ Automation ================================

export const getAutomation = createServerFn({ method: "GET" }).handler(async () => {
  const { listEmailRules, listEmailLog, getSettings } = await import("../db.server");
  const { isEmailConfigured } = await import("../email.server");
  const { requireUser } = await import("../auth.server");
  await requireUser();

  const [rules, log, settings] = await Promise.all([
    listEmailRules(),
    listEmailLog(60),
    getSettings(),
  ]);

  return {
    rules,
    log,
    configured: isEmailConfigured(settings),
    from: settings.emailFrom,
    replyTo: settings.emailReplyTo,
    hasKey: Boolean(settings.resendApiKey),
  };
});

export const saveEmailRule = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      id: z.enum(["booking_confirmed", "reminder", "after_service", "booking_cancelled"]),
      enabled: z.boolean(),
      subject: z.string().min(1).max(200),
      body: z.string().min(1).max(5000),
      offsetHours: z.number().int().min(0).max(720),
    }),
  )
  .handler(async ({ data }) => {
    const { updateEmailRule } = await import("../db.server");
    const { requireUser } = await import("../auth.server");
    await requireUser();

    const { id, ...patch } = data;
    const rule = await updateEmailRule(id, patch);
    if (!rule) throw new Error("Rule not found.");
    return { rule };
  });

export const saveEmailSettings = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      resendApiKey: z.string().max(200),
      emailFrom: z.string().max(200),
      emailReplyTo: z.string().max(200),
    }),
  )
  .handler(async ({ data }) => {
    const { updateSettings, getSettings } = await import("../db.server");
    const { requireUser } = await import("../auth.server");
    await requireUser();

    // An empty key field means "leave it alone" — the UI never shows the
    // stored key back, so blanking it must not wipe it by accident.
    const current = await getSettings();
    await updateSettings({
      resendApiKey: data.resendApiKey.trim() || current.resendApiKey,
      emailFrom: data.emailFrom.trim(),
      emailReplyTo: data.emailReplyTo.trim(),
    });
    return { ok: true };
  });

/** Send one rule to a booking right now, ignoring enabled/already-sent. */
export const sendTestEmail = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      bookingId: idSchema,
      trigger: z.enum(["booking_confirmed", "reminder", "after_service", "booking_cancelled"]),
    }),
  )
  .handler(async ({ data }) => {
    const { findBookingById } = await import("../db.server");
    const { runTrigger } = await import("../email.server");
    const { requireUser } = await import("../auth.server");
    await requireUser();

    const booking = await findBookingById(data.bookingId);
    if (!booking) throw new Error("Booking not found.");
    return await runTrigger(data.trigger, booking, { force: true });
  });

/** Manually run the time-based rules. */
export const runAutomationNow = createServerFn({ method: "POST" }).handler(async () => {
  const { processScheduledEmails } = await import("../email.server");
  const { requireUser } = await import("../auth.server");
  await requireUser();
  return await processScheduledEmails();
});

// ============================ CSV import ================================

export const importCustomers = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      rows: z
        .array(
          z.object({
            name: z.string().min(1).max(120),
            email: z.string().email().max(255),
            phone: z.string().max(40).default(""),
            notes: z.string().max(1000).optional(),
          }),
        )
        .min(1)
        .max(5000),
    }),
  )
  .handler(async ({ data }) => {
    const { importClients } = await import("../db.server");
    const { requireUser } = await import("../auth.server");
    await requireUser();
    return await importClients(data.rows);
  });

// ============================ Schedule ==================================

const daySchema = z.object({
  open: z.boolean(),
  openHour: z.number().int().min(0).max(23),
  closeHour: z.number().int().min(1).max(24),
});
const weekSchema = z.array(daySchema).length(7);

export const saveSchedule = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      weeklySchedule: weekSchema,
      mobileScheduleEnabled: z.boolean(),
      mobileSchedule: weekSchema,
      slotIncrementMinutes: z.number().int().min(15).max(240),
      leadDays: z.number().int().min(0).max(60),
      bookingWindowDays: z.number().int().min(1).max(120),
    }),
  )
  .handler(async ({ data }) => {
    const { updateSettings } = await import("../db.server");
    const { requireUser } = await import("../auth.server");
    await requireUser();

    const bad = (w: typeof data.weeklySchedule, label: string) => {
      for (let i = 0; i < 7; i++) {
        if (w[i].open && w[i].closeHour <= w[i].openHour) {
          throw new Error(`${label}: closing time must be after opening time.`);
        }
      }
      if (w.every((d) => !d.open)) throw new Error(`${label}: you can't be closed every day.`);
    };
    bad(data.weeklySchedule, "Shop schedule");
    if (data.mobileScheduleEnabled) bad(data.mobileSchedule, "Mobile schedule");

    // Keep the legacy single-window fields roughly in step so anything still
    // reading them (and the .env seed docs) isn't wildly misleading.
    const openDays = data.weeklySchedule.filter((d) => d.open);
    const settings = await updateSettings({
      ...data,
      openHour: Math.min(...openDays.map((d) => d.openHour)),
      closeHour: Math.max(...openDays.map((d) => d.closeHour)),
      closedDays: data.weeklySchedule.flatMap((d, i) => (d.open ? [] : [i])),
    });
    return { settings };
  });

// ============================ Sales =====================================

/**
 * Sales reporting. Revenue is recognised on COMPLETED jobs only —
 * confirmed-but-not-yet-done work is reported separately as pipeline, so the
 * headline number can't be inflated by bookings that might still cancel.
 */
export const getSales = createServerFn({ method: "GET" })
  .inputValidator(
    z.object({ months: z.number().int().min(1).max(36).default(12) }).default({ months: 12 }),
  )
  .handler(async ({ data }) => {
    const { listBookingsWithClients, getSettings } = await import("../db.server");
    const { requireUser } = await import("../auth.server");
    await requireUser();

    const [bookings, settings] = await Promise.all([listBookingsWithClients(), getSettings()]);

    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: settings.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());

    const net = (b: (typeof bookings)[number]) =>
      (b.totalPrice ?? 0) - (b.discount ?? 0) + (b.tip ?? 0);

    const active = bookings.filter((b) => b.status !== "cancelled");
    const completed = active.filter((b) => b.status === "completed");
    const upcoming = active.filter((b) => b.status === "confirmed");

    // Month buckets, oldest first.
    const cursor = new Date(`${today}T12:00:00`);
    const months: {
      key: string;
      label: string;
      revenue: number;
      tips: number;
      jobs: number;
    }[] = [];
    for (let i = data.months - 1; i >= 0; i--) {
      const d = new Date(cursor.getFullYear(), cursor.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const inMonth = completed.filter((b) => b.date.startsWith(key));
      months.push({
        key,
        label: d.toLocaleString("en-US", { month: "short" }),
        revenue: inMonth.reduce((s, b) => s + net(b), 0),
        tips: inMonth.reduce((s, b) => s + (b.tip ?? 0), 0),
        jobs: inMonth.length,
      });
    }

    // By service.
    const svc = new Map<string, { title: string; jobs: number; revenue: number }>();
    for (const b of completed) {
      const e = svc.get(b.serviceId) ?? { title: b.serviceTitle, jobs: 0, revenue: 0 };
      e.jobs += 1;
      e.revenue += net(b);
      svc.set(b.serviceId, e);
    }

    // Add-on attach rate — which extras actually sell.
    const addons = new Map<string, number>();
    for (const b of completed) {
      for (const t of b.addOnTitles ?? []) addons.set(t, (addons.get(t) ?? 0) + 1);
    }

    // Best customers by spend.
    const byClient = new Map<string, { name: string; jobs: number; spend: number }>();
    for (const b of completed) {
      const key = b.clientId;
      const e = byClient.get(key) ?? { name: b.client?.name ?? "Unknown", jobs: 0, spend: 0 };
      e.jobs += 1;
      e.spend += net(b);
      byClient.set(key, e);
    }

    const revenue = completed.reduce((s, b) => s + net(b), 0);
    const thisMonth = today.slice(0, 7);
    const lastMonthDate = new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1);
    const lastMonthKey = `${lastMonthDate.getFullYear()}-${String(lastMonthDate.getMonth() + 1).padStart(2, "0")}`;

    const mtd = completed
      .filter((b) => b.date.startsWith(thisMonth))
      .reduce((s, b) => s + net(b), 0);
    const lastMonth = completed
      .filter((b) => b.date.startsWith(lastMonthKey))
      .reduce((s, b) => s + net(b), 0);

    const mobile = completed.filter((b) => b.location === "mobile");

    return {
      totals: {
        revenue,
        jobs: completed.length,
        avgJob: completed.length ? Math.round(revenue / completed.length) : 0,
        tips: completed.reduce((s, b) => s + (b.tip ?? 0), 0),
        discounts: completed.reduce((s, b) => s + (b.discount ?? 0), 0),
        mtd,
        lastMonth,
        // Percent change month over month; null when there's no baseline.
        momChange: lastMonth > 0 ? Math.round(((mtd - lastMonth) / lastMonth) * 100) : null,
        pipeline: upcoming.reduce((s, b) => s + net(b), 0),
        pipelineJobs: upcoming.length,
        outstanding: active
          .filter((b) => b.paymentStatus !== "paid" && b.paymentStatus !== "refunded")
          .reduce((s, b) => s + Math.max(0, net(b) - (b.amountPaid ?? 0)), 0),
        cancelled: bookings.filter((b) => b.status === "cancelled").length,
        mobileShare: completed.length
          ? Math.round((mobile.length / completed.length) * 100)
          : 0,
        repeatCustomers: [...byClient.values()].filter((c) => c.jobs > 1).length,
      },
      months,
      byService: [...svc.values()].sort((a, b) => b.revenue - a.revenue),
      byAddOn: [...addons.entries()]
        .map(([title, count]) => ({ title, count }))
        .sort((a, b) => b.count - a.count),
      topCustomers: [...byClient.values()].sort((a, b) => b.spend - a.spend).slice(0, 8),
      recent: completed
        .slice()
        .sort((a, b) => `${b.date}${b.startTime}`.localeCompare(`${a.date}${a.startTime}`))
        .slice(0, 10)
        .map((b) => ({
          id: b.id,
          reference: b.reference,
          date: b.date,
          client: b.client?.name ?? "—",
          service: b.serviceTitle,
          tip: b.tip ?? 0,
          total: net(b),
        })),
    };
  });

// ============================ Integrations ==============================

/** The redirect URI Google must have registered. Derived from the request. */
async function currentRedirectUri(): Promise<string> {
  const { getSettings } = await import("../db.server");
  const settings = await getSettings();

  // Behind a proxy the request origin can be the internal address, so an
  // explicitly configured Site URL wins when it's set.
  if (settings.siteUrl) return `${settings.siteUrl.replace(/\/+$/, "")}/admin/integrations`;

  const { getRequestUrl } = await import("@tanstack/react-start/server");
  const url = getRequestUrl({ xForwardedHost: true, xForwardedProto: true });
  return `${url.origin}/admin/integrations`;
}

export const getIntegrations = createServerFn({ method: "GET" }).handler(async () => {
  const { getSettings } = await import("../db.server");
  const { isGoogleCalendarConfigured, listCalendars } = await import("../google-calendar.server");
  const { isEmailConfigured } = await import("../email.server");
  const { requireUser } = await import("../auth.server");
  await requireUser();

  const settings = await getSettings();
  const connected = await isGoogleCalendarConfigured();

  // Only fetch the calendar list when actually connected, so a broken token
  // doesn't make the whole page fail to load.
  let calendars: Awaited<ReturnType<typeof listCalendars>> = [];
  let listError: string | null = null;
  if (connected) {
    try {
      calendars = await listCalendars();
    } catch (err) {
      listError = err instanceof Error ? err.message : "Couldn't list calendars.";
    }
  }

  return {
    google: {
      connected,
      // Never send the secret or refresh token to the browser.
      hasClientId: Boolean(settings.googleClientId),
      hasClientSecret: Boolean(settings.googleClientSecret),
      clientId: settings.googleClientId,
      accountEmail: settings.googleAccountEmail,
      calendarId: settings.googleCalendarId,
      calendars,
      listError,
      // Why the last calendar call failed. Calendar work is non-fatal by
      // design, so without surfacing this a broken connection looks fine.
      lastError: settings.googleLastError,
      lastErrorAt: settings.googleLastErrorAt,
      redirectUri: await currentRedirectUri(),
    },
    email: {
      configured: isEmailConfigured(settings),
      from: settings.emailFrom,
    },
    stripe: {
      // Never send the secret key back to the browser — only whether one
      // exists, and the last 4 characters so the shop can tell keys apart.
      configured: Boolean(settings.stripeSecretKey),
      keyHint: settings.stripeSecretKey ? `••••${settings.stripeSecretKey.slice(-4)}` : "",
      publishableKey: settings.stripePublishableKey,
      accountName: settings.stripeAccountName,
      currency: settings.stripeCurrency || "cad",
      livemode: settings.stripeSecretKey.startsWith("sk_live"),
    },
    webhook: {
      url: settings.webhookUrl,
      hasSecret: Boolean(settings.webhookSecret),
      events: settings.webhookEvents ?? [],
    },
  };
});

export const saveGoogleCredentials = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      clientId: z.string().max(300),
      clientSecret: z.string().max(300),
    }),
  )
  .handler(async ({ data }) => {
    const { updateSettings, getSettings } = await import("../db.server");
    const { requireUser } = await import("../auth.server");
    await requireUser();

    // A blank secret means "keep the stored one" — the UI never echoes it back.
    const current = await getSettings();
    await updateSettings({
      googleClientId: data.clientId.trim(),
      googleClientSecret: data.clientSecret.trim() || current.googleClientSecret,
    });
    return { ok: true };
  });

/** Step 1 of connecting: the Google consent screen URL. */
export const getGoogleConsentUrl = createServerFn({ method: "GET" }).handler(async () => {
  const { getSettings } = await import("../db.server");
  const { buildConsentUrl } = await import("../google-calendar.server");
  const { requireUser } = await import("../auth.server");
  await requireUser();

  const s = await getSettings();
  if (!s.googleClientId || !s.googleClientSecret) {
    throw new Error("Add your Client ID and Client secret first, then save.");
  }
  return {
    url: buildConsentUrl(s.googleClientId, s.googleClientSecret, await currentRedirectUri()),
  };
});

/** Step 2: exchange the ?code= Google sent back for a refresh token. */
export const completeGoogleConnect = createServerFn({ method: "POST" })
  .inputValidator(z.object({ code: z.string().min(1).max(500) }))
  .handler(async ({ data }) => {
    const { getSettings, updateSettings } = await import("../db.server");
    const { exchangeCodeForToken } = await import("../google-calendar.server");
    const { requireUser } = await import("../auth.server");
    await requireUser();

    const s = await getSettings();
    const { refreshToken, email } = await exchangeCodeForToken(
      s.googleClientId,
      s.googleClientSecret,
      await currentRedirectUri(),
      data.code,
    );

    await updateSettings({ googleRefreshToken: refreshToken, googleAccountEmail: email });
    return { email };
  });

export const setGoogleCalendar = createServerFn({ method: "POST" })
  .inputValidator(z.object({ calendarId: z.string().min(1).max(200) }))
  .handler(async ({ data }) => {
    const { updateSettings } = await import("../db.server");
    const { requireUser } = await import("../auth.server");
    await requireUser();
    await updateSettings({ googleCalendarId: data.calendarId });
    return { ok: true };
  });

export const testGoogleConnection = createServerFn({ method: "POST" }).handler(async () => {
  const { testConnection } = await import("../google-calendar.server");
  const { requireUser } = await import("../auth.server");
  await requireUser();
  return await testConnection();
});

/**
 * The events already on your Google calendar for a month, so the admin
 * calendar shows the whole picture — jobs booked through the site AND
 * everything else you've committed to — instead of only half of it.
 *
 * Returns [] when Google isn't connected; the page renders bookings alone.
 */
export const getCalendarEvents = createServerFn({ method: "GET" })
  .inputValidator(
    z.object({
      from: dateSchema,
      to: dateSchema,
    }),
  )
  .handler(async ({ data }) => {
    const { listCalendarEvents } = await import("../google-calendar.server");
    const { requireUser } = await import("../auth.server");
    const { getSettings } = await import("../db.server");
    await requireUser();

    const settings = await getSettings();
    const events = await listCalendarEvents(
      new Date(`${data.from}T00:00:00Z`).toISOString(),
      // Exclusive end, plus a day of slack so an event starting late on the
      // last day of the month still comes back.
      new Date(`${data.to}T00:00:00Z`).toISOString(),
    );

    return {
      connected: Boolean(settings.googleRefreshToken),
      calendarId: settings.googleCalendarId,
      events,
    };
  });

export const disconnectGoogle = createServerFn({ method: "POST" }).handler(async () => {
  const { updateSettings } = await import("../db.server");
  const { requireUser } = await import("../auth.server");
  await requireUser();

  // Drop the token but keep the client id/secret, so reconnecting is one click.
  await updateSettings({ googleRefreshToken: "", googleAccountEmail: "" });
  return { ok: true };
});

// ============================ Site / SEO ================================

export const saveSiteSettings = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      siteUrl: z.string().max(200),
      siteTitle: z.string().min(1).max(120),
      siteTagline: z.string().max(160),
      siteDescription: z.string().max(320),
      siteKeywords: z.string().max(300),
      ogImageUrl: z.string().max(500),
      faviconUrl: z.string().max(500),
      twitterHandle: z.string().max(40),
      // Homepage hero copy and the counters beneath it.
      heroHeadline: z.string().max(80),
      heroHeadlineAccent: z.string().max(80),
      heroSubtext: z.string().max(400),
      statClients: z.number().int().min(0).max(1000000),
      statVehicles: z.number().int().min(0).max(1000000),
    }),
  )
  .handler(async ({ data }) => {
    const { updateSettings } = await import("../db.server");
    const { requireUser } = await import("../auth.server");
    await requireUser();

    const url = data.siteUrl.trim().replace(/\/+$/, "");
    if (url && !/^https?:\/\//i.test(url)) {
      throw new Error("Site URL must start with http:// or https://");
    }
    return { settings: await updateSettings({ ...data, siteUrl: url }) };
  });

export const saveCalendarTemplates = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      calendarEventTitle: z.string().min(1).max(300),
      calendarEventDescription: z.string().max(4000),
    }),
  )
  .handler(async ({ data }) => {
    const { updateSettings } = await import("../db.server");
    const { requireUser } = await import("../auth.server");
    await requireUser();
    return { settings: await updateSettings(data) };
  });

/** Render the calendar templates against a real (or sample) booking. */
export const previewCalendarTemplate = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      title: z.string().max(300),
      description: z.string().max(4000),
      bookingId: idSchema.optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { listBookings } = await import("../db.server");
    const { buildVars, renderTemplate, sampleVars } = await import("../email.server");
    const { requireUser } = await import("../auth.server");
    await requireUser();

    const bookings = await listBookings();
    const booking = data.bookingId
      ? bookings.find((b) => b.id === data.bookingId)
      : bookings.at(-1);

    const vars = booking ? await buildVars(booking) : sampleVars();
    return {
      title: renderTemplate(data.title, vars),
      description: renderTemplate(data.description, vars),
      usedSample: !booking,
    };
  });

// ============================ Form fields ===============================

export const listAdminFormFields = createServerFn({ method: "GET" }).handler(async () => {
  const { listFormFields, listServices } = await import("../db.server");
  const { requireUser } = await import("../auth.server");
  await requireUser();

  const [fields, services] = await Promise.all([listFormFields(), listServices()]);
  return { fields, services: services.map((s) => ({ id: s.id, title: s.title })) };
});

export const saveFormField = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      id: idSchema.optional(),
      label: z.string().min(1).max(80),
      type: z.enum(["text", "textarea", "select", "checkbox", "number", "date"]),
      required: z.boolean(),
      placeholder: z.string().max(120).optional(),
      helpText: z.string().max(200).optional(),
      options: z.array(z.string().min(1).max(60)).max(30).default([]),
      onlyForServices: z.array(idSchema).max(30).default([]),
      active: z.boolean(),
      sortOrder: z.number().int().min(0).max(999),
    }),
  )
  .handler(async ({ data }) => {
    const { upsertFormField } = await import("../db.server");
    const { requireUser } = await import("../auth.server");
    const { randomUUID } = await import("node:crypto");
    await requireUser();

    if (data.type === "select" && data.options.length === 0) {
      throw new Error("A dropdown needs at least one option.");
    }
    return { field: await upsertFormField({ ...data, id: data.id ?? randomUUID() }) };
  });

export const removeFormField = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: idSchema }))
  .handler(async ({ data }) => {
    const { deleteFormField } = await import("../db.server");
    const { requireUser } = await import("../auth.server");
    await requireUser();
    await deleteFormField(data.id);
    return { ok: true };
  });

// ============================ Gallery ===================================

export const listAdminGallery = createServerFn({ method: "GET" }).handler(async () => {
  const { listGallery } = await import("../db.server");
  const { readPhotoDataUrl } = await import("../uploads.server");
  const { findPhoto } = await import("../db.server");
  const { requireUser } = await import("../auth.server");
  await requireUser();

  const pairs = await listGallery();
  const withImages = await Promise.all(
    pairs.map(async (p) => {
      const [b, a] = await Promise.all([findPhoto(p.beforePhotoId), findPhoto(p.afterPhotoId)]);
      return {
        ...p,
        beforeUrl: b ? await readPhotoDataUrl(b.id, b.mime) : null,
        afterUrl: a ? await readPhotoDataUrl(a.id, a.mime) : null,
      };
    }),
  );
  return { pairs: withImages };
});

export const saveGalleryPair = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      id: idSchema.optional(),
      label: z.string().min(1).max(80),
      beforePhotoId: idSchema,
      afterPhotoId: idSchema,
      sortOrder: z.number().int().min(0).max(999).default(0),
      active: z.boolean().default(true),
      // Copy shown on the Results page beneath each slider.
      detail: z.string().max(80).default(""),
      description: z.string().max(600).default(""),
      packageLabel: z.string().max(40).default(""),
    }),
  )
  .handler(async ({ data }) => {
    const { upsertGalleryPair } = await import("../db.server");
    const { requireUser } = await import("../auth.server");
    const { randomUUID } = await import("node:crypto");
    await requireUser();
    return { pair: await upsertGalleryPair({ ...data, id: data.id ?? randomUUID() }) };
  });

export const removeGalleryPair = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: idSchema }))
  .handler(async ({ data }) => {
    const { deleteGalleryPair, deletePhoto } = await import("../db.server");
    const { deletePhotoFile } = await import("../uploads.server");
    const { requireUser } = await import("../auth.server");
    await requireUser();

    const pair = await deleteGalleryPair(data.id);
    // Gallery photos aren't attached to a booking, so nothing else references
    // them — clean the files up rather than orphaning them on disk.
    for (const pid of [pair?.beforePhotoId, pair?.afterPhotoId].filter(Boolean) as string[]) {
      const photo = await deletePhoto(pid);
      if (photo) await deletePhotoFile(photo.id, photo.mime);
    }
    return { ok: true };
  });

// ==================== Automation: custom workflows ======================

export const createCustomRule = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      name: z.string().min(1).max(80),
      trigger: z.enum(["booking_confirmed", "reminder", "after_service", "booking_cancelled"]),
      subject: z.string().min(1).max(200),
      body: z.string().min(1).max(5000),
      offsetHours: z.number().int().min(0).max(720),
      enabled: z.boolean().default(true),
    }),
  )
  .handler(async ({ data }) => {
    const { createEmailRule } = await import("../db.server");
    const { requireUser } = await import("../auth.server");
    const { randomUUID } = await import("node:crypto");
    await requireUser();

    return {
      rule: await createEmailRule({ ...data, id: randomUUID(), custom: true }),
    };
  });

export const removeCustomRule = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: idSchema }))
  .handler(async ({ data }) => {
    const { deleteEmailRule } = await import("../db.server");
    const { requireUser } = await import("../auth.server");
    await requireUser();
    await deleteEmailRule(data.id);
    return { ok: true };
  });
