import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// Every function here begins with requireUser(), which reads the HTTP-only
// session cookie and throws UNAUTHORIZED if it isn't a valid, unexpired
// session. That is the single choke point for admin authorization — there
// is no password field on these calls any more.

const idSchema = z.string().min(1).max(60);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// --------------------------- Dashboard --------------------------------

export const getDashboard = createServerFn({ method: "GET" }).handler(async () => {
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

  // Revenue for the last 6 months, oldest first — drives the dashboard chart.
  const months: { month: string; label: string; revenue: number; jobs: number }[] = [];
  const cursor = new Date(`${today}T12:00:00`);
  for (let i = 5; i >= 0; i--) {
    const d = new Date(cursor.getFullYear(), cursor.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const inMonth = active.filter((b) => b.date.startsWith(key) && b.status === "completed");
    months.push({
      month: key,
      label: d.toLocaleString("en-US", { month: "short" }),
      revenue: inMonth.reduce((s, b) => s + earned(b), 0),
      jobs: inMonth.length,
    });
  }

  // Which packages actually sell.
  const byService = new Map<string, { title: string; count: number; revenue: number }>();
  for (const b of active) {
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
      pipeline,
      completedAllTime: active.filter((b) => b.status === "completed").length,
      cancelledAllTime: bookings.filter((b) => b.status === "cancelled").length,
      tipsThisMonth: active
        .filter((b) => b.date.startsWith(thisMonth))
        .reduce((sum, b) => sum + (b.tip ?? 0), 0),
    },
    today: active
      .filter((b) => b.date === today)
      .sort((a, b) => a.startTime.localeCompare(b.startTime)),
    upcoming: upcoming.slice(0, 8),
    months,
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
      const { runTrigger } = await import("../email.server");
      // Fire-and-forget: a mail failure must not block freeing the slot.
      void runTrigger("booking_cancelled", booking).catch(() => undefined);
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
      active: z.boolean().default(true),
      sortOrder: z.number().int().min(0).max(999).default(0),
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
