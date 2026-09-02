import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { quote } from "../services";

// NOTE: everything imported only *inside* a handler below (the .server.ts
// modules) is tree-shaken out of the client bundle. Keep it that way —
// don't hoist these imports to module scope.

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");
const idSchema = z.string().min(1).max(60);
const addOnIdsSchema = z.array(idSchema).max(20).default([]);

/**
 * The bookable catalog — packages, add-ons, travel fee, and the public
 * business details. Public on purpose: the wizard needs it before anyone
 * has identified themselves. Only `active` items are returned.
 */
export const getCatalog = createServerFn({ method: "GET" }).handler(async () => {
  const { listServices, listAddOns, getSettings, listFormFields } = await import("../db.server");

  const [services, addOns, settings, formFields] = await Promise.all([
    listServices(),
    listAddOns(),
    getSettings(),
    listFormFields(),
  ]);

  return {
    services: services
      .filter((s) => s.active)
      .map(({ id, title, subtitle, priceValue, durationMinutes, features, description }) => ({
        id,
        title,
        subtitle,
        priceValue,
        durationMinutes,
        features: features ?? [],
        description: description ?? "",
      })),
    addOns: addOns
      .filter((a) => a.active)
      .map(({ id, name, detail, price, durationMinutes }) => ({
        id,
        name,
        detail,
        price,
        durationMinutes,
      })),
    travelFee: settings.travelFee,
    formFields: formFields.filter((f) => f.active),
    business: {
      name: settings.businessName,
      email: settings.contactEmail,
      phone: settings.contactPhone,
      serviceArea: settings.serviceArea,
    },
  };
});

/**
 * Resolve a selection against the live catalog and price it. Shared by
 * every handler below so the catalog is read exactly one way.
 */
async function priceSelection(serviceId: string, addOnIds: string[], location: "mobile" | "shop" | null) {
  const { listServices, listAddOns, getSettings } = await import("../db.server");
  const [services, addOns, settings] = await Promise.all([
    listServices(),
    listAddOns(),
    getSettings(),
  ]);

  const service = services.find((s) => s.id === serviceId && s.active);
  if (!service) throw new Error("That package is no longer available.");

  const chosen = addOns.filter((a) => addOnIds.includes(a.id) && a.active);
  const q = quote({ service, addOns: chosen, location, travelFee: settings.travelFee });

  return { service, addOns: chosen, ...q };
}

export const getBookableDays = createServerFn({ method: "GET" })
  .inputValidator(
    z.object({
      serviceId: idSchema,
      addOnIds: addOnIdsSchema,
      // Mobile jobs can run a different schedule, so availability depends on it.
      location: z.enum(["mobile", "shop"]).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { getAvailableDays } = await import("../availability.server");
    const { durationMinutes } = await priceSelection(data.serviceId, data.addOnIds, null);
    return { days: await getAvailableDays(durationMinutes, undefined, data.location) };
  });

export const getAvailability = createServerFn({ method: "GET" })
  .inputValidator(
    z.object({
      date: dateSchema,
      serviceId: idSchema,
      addOnIds: addOnIdsSchema,
      location: z.enum(["mobile", "shop"]).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { getAvailableSlots } = await import("../availability.server");
    const { durationMinutes } = await priceSelection(data.serviceId, data.addOnIds, null);

    const slots = await getAvailableSlots(data.date, durationMinutes, undefined, data.location);
    return { slots: slots.map((s) => ({ startTime: s.startTime, startISO: s.startISO })) };
  });

/**
 * Decide what a code is worth against a subtotal.
 *
 * Used by BOTH the preview the customer sees and the real booking, so the
 * quoted discount and the charged discount can never disagree. Never throws
 * for a bad code — it returns a reason, because "SPRING25 has expired" is a
 * more useful thing to show than a generic failure.
 */
async function evaluateCoupon(code: string, subtotal: number, email?: string) {
  const { findCouponByCode, hasRedeemedCoupon } = await import("../db.server");
  const { applyDiscount } = await import("../services");

  const trimmed = code.trim();
  if (!trimmed) return { ok: false as const, reason: "Enter a code." };

  const coupon = await findCouponByCode(trimmed);
  if (!coupon || !coupon.active) {
    // Same message for "doesn't exist" and "switched off" — no reason to
    // help someone enumerate which codes are real.
    return { ok: false as const, reason: "That code isn't valid." };
  }
  if (coupon.expiresAt && coupon.expiresAt < new Date().toISOString().slice(0, 10)) {
    return { ok: false as const, reason: "That code has expired." };
  }
  if (coupon.maxUses != null && coupon.timesUsed >= coupon.maxUses) {
    return { ok: false as const, reason: "That code has been fully redeemed." };
  }
  if (coupon.oncePerCustomer && email && (await hasRedeemedCoupon(coupon.id, email))) {
    return { ok: false as const, reason: "You've already used that code." };
  }

  const newTotal = applyDiscount(subtotal, { type: coupon.type, value: coupon.value });
  const discount = Math.max(0, subtotal - newTotal);
  if (discount <= 0) {
    return { ok: false as const, reason: "That code doesn't apply to this order." };
  }

  return {
    ok: true as const,
    couponId: coupon.id,
    code: coupon.code,
    type: coupon.type,
    value: coupon.value,
    discount,
    newTotal,
  };
}

/** Live check as the customer types a code, before they commit to booking. */
export const checkCoupon = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      code: z.string().min(1).max(40),
      serviceId: idSchema,
      addOnIds: addOnIdsSchema,
      location: z.enum(["mobile", "shop"]).nullable().default(null),
      /** Known by the Review step, where the code is entered. Lets a
          one-per-customer code be refused in the preview rather than
          silently dropped at submit. */
      email: z.string().max(255).optional(),
    }),
  )
  .handler(async ({ data }) => {
    // Codes are short and guessable, and this endpoint says plainly whether
    // one is real. Without a limit a script can enumerate every live code.
    const { rateLimit } = await import("../rate-limit.server");
    rateLimit("coupon", {
      max: 20,
      windowMs: 10 * 60_000,
      message: "Too many code attempts. Please wait a few minutes and try again.",
    });

    // Price the order server-side; a client-supplied subtotal could be forged
    // to inflate a percentage discount.
    const { price } = await priceSelection(data.serviceId, data.addOnIds, data.location);
    const result = await evaluateCoupon(data.code, price, data.email);

    if (!result.ok) return { ok: false as const, reason: result.reason };
    return {
      ok: true as const,
      code: result.code,
      discount: result.discount,
      newTotal: result.newTotal,
      label: result.type === "percent" ? `${result.value}% off` : `$${result.value} off`,
    };
  });

export const createBooking = createServerFn({ method: "POST" })
  .inputValidator(
    z
      .object({
        name: z.string().min(1).max(120),
        email: z.string().email().max(255),
        phone: z.string().min(7).max(30),
        date: dateSchema,
        startTime: z.string().regex(/^\d{2}:\d{2}$/),
        serviceId: idSchema,
        addOnIds: addOnIdsSchema,
        location: z.enum(["mobile", "shop"]),
        address: z.string().max(200).optional(),
        vehicle: z.object({
          make: z.string().min(1).max(40),
          model: z.string().min(1).max(40),
          year: z.string().regex(/^\d{4}$/),
          color: z.string().min(1).max(30),
        }),
        notes: z.string().max(1000).optional(),
        customFields: z.record(z.string().max(60), z.string().max(500)).default({}),
        couponCode: z.string().max(40).optional(),
      })
      // Mobile jobs need somewhere to drive to. Enforced server-side so the
      // client validation isn't the only thing standing between a mobile
      // booking and a missing address.
      .refine((d) => d.location !== "mobile" || (d.address?.trim().length ?? 0) >= 5, {
        message: "A service address is required for mobile bookings.",
        path: ["address"],
      }),
  )
  .handler(async ({ data }) => {
    // Each booking writes a row, sends an email and creates a calendar event,
    // so a loop costs real money and fills a real calendar. Generous enough
    // that a family booking several cars in one sitting never notices.
    const { rateLimit } = await import("../rate-limit.server");
    rateLimit("booking", {
      max: 6,
      windowMs: 30 * 60_000,
      message: "That's a lot of bookings at once. Please call us and we'll sort the rest out.",
    });

    const { getAvailableSlots } = await import("../availability.server");
    const { findOrCreateClient, addBooking } = await import("../db.server");
    const { createCalendarEvent } = await import("../google-calendar.server");

    // Price and duration are recomputed here from the live catalog — the
    // client's numbers are display-only and never trusted.
    const { service, addOns, price: totalPrice, durationMinutes } = await priceSelection(
      data.serviceId,
      data.addOnIds,
      data.location,
    );

    // Re-check the slot is still open right before booking it — closes
    // the race where two people grab the same slot seconds apart.
    const freshSlots = await getAvailableSlots(
      data.date,
      durationMinutes,
      undefined,
      data.location,
    );
    const match = freshSlots.find((s) => s.startTime === data.startTime);
    if (!match) {
      // Distinguish "that whole day is closed/out of range" from "someone
      // beat you to that slot" — telling a customer their date was taken
      // when the shop is shut that day just sends them in circles.
      throw new Error(
        freshSlots.length === 0
          ? "That date isn't available for booking. Please choose another day."
          : "That time was just booked by someone else — please pick another slot.",
      );
    }

    // Re-evaluate the coupon here rather than trusting whatever the client
    // previewed. A code that expired or ran out between preview and submit is
    // simply not applied — the booking still goes through at full price
    // rather than failing outright, which would be a worse experience.
    let discount = 0;
    let appliedCoupon: string | undefined;
    if (data.couponCode?.trim()) {
      const result = await evaluateCoupon(data.couponCode, totalPrice, data.email);
      if (result.ok) {
        const { redeemCoupon } = await import("../db.server");
        // redeemCoupon re-checks BOTH caps inside its transaction, so two
        // bookings racing for the last use can't both win, and a double
        // submit can't spend a one-per-customer code twice.
        if (await redeemCoupon(result.couponId, { email: data.email })) {
          discount = result.discount;
          appliedCoupon = result.code;
        }
      }
    }

    const client = await findOrCreateClient({
      name: data.name,
      email: data.email,
      phone: data.phone,
    });

    const endISO = new Date(
      new Date(match.startISO).getTime() + durationMinutes * 60_000,
    ).toISOString();

    const vehicleLabel = `${data.vehicle.year} ${data.vehicle.make} ${data.vehicle.model} (${data.vehicle.color})`;
    const locationLabel = data.location === "mobile" ? `Mobile — ${data.address}` : "At the shop";

    const googleEventId = await createCalendarEvent({
      summary: `${service.title} Detail — ${data.name}`,
      description: [
        `Service: ${service.title} (${service.subtitle})`,
        addOns.length ? `Add-ons: ${addOns.map((a) => a.name).join(", ")}` : "Add-ons: none",
        `Total: $${totalPrice}`,
        `Location: ${locationLabel}`,
        `Vehicle: ${vehicleLabel}`,
        `Client: ${data.name}`,
        `Phone: ${data.phone}`,
        `Email: ${data.email}`,
        data.notes ? `Notes: ${data.notes}` : undefined,
      ]
        .filter(Boolean)
        .join("\n"),
      startISO: match.startISO,
      endISO,
      attendeeEmail: data.email,
      location: data.location === "mobile" ? data.address : undefined,
    }).catch((err) => {
      // Don't fail the whole booking if Calendar hiccups — the shop still
      // gets the booking locally and can add it to Calendar by hand.
      console.error("Google Calendar event creation failed:", err);
      return null;
    });

    const booking = await addBooking({
      clientId: client.id,
      serviceId: service.id,
      serviceTitle: service.title,
      date: data.date,
      startTime: data.startTime,
      durationMinutes,
      addOnIds: addOns.map((a) => a.id),
      addOnTitles: addOns.map((a) => a.name),
      location: data.location,
      address: data.location === "mobile" ? data.address : undefined,
      vehicle: data.vehicle,
      totalPrice,
      discount: discount > 0 ? discount : undefined,
      notes: data.notes,
      googleEventId: googleEventId ?? undefined,
    });

    if (Object.keys(data.customFields).length) {
      const { setBookingCustomFields } = await import("../db.server");
      await setBookingCustomFields(booking.id, data.customFields);
    }

    /*
      Deposit.

      Created after the booking exists, and never allowed to fail it: if
      Stripe is down or misconfigured the job is still booked and the owner
      can chase the deposit by hand. The alternative — refusing the booking —
      loses real work over a payments hiccup.
    */
    let depositUrl: string | undefined;
    let depositAmount = 0;
    const { getSettings: readSettings } = await import("../db.server");
    const settings = await readSettings();
    if (settings.depositEnabled) {
      const { depositFor } = await import("../policy");
      depositAmount = depositFor(settings, booking.totalPrice);
      if (depositAmount > 0) {
        try {
          const { createPaymentLink } = await import("../stripe.server");
          const { updateBookingCharges } = await import("../db.server");
          const link = await createPaymentLink({
            amount: depositAmount,
            description: `Deposit — ${booking.serviceTitle} (${booking.reference})`,
            reference: booking.reference,
          });
          depositUrl = link.url;
          await updateBookingCharges(booking.id, {
            depositAmount,
            depositUrl: link.url,
            depositLinkId: link.id,
          });
        } catch (err) {
          console.error("Couldn't create the deposit link:", err);
          depositAmount = 0;
        }
      }
    }

    // Confirmation email. Fire-and-forget and never throws — the booking is
    // already saved, and a mail outage must not fail the customer's booking.
    void import("../email.server")
      .then(({ runTriggerAndCustom }) => runTriggerAndCustom("booking_confirmed", booking))
      .catch(() => undefined);

    // Same contract for the outgoing webhook: a notification, not part of
    // the transaction.
    void import("../webhooks.server")
      .then(({ sendWebhook }) => sendWebhook("booking_created", booking))
      .catch(() => undefined);

    // `appliedCoupon` is reported back so the confirmation can say the code
    // landed — and, just as importantly, stay silent if it quietly didn't.
    return {
      booking,
      client,
      appliedCoupon,
      discount,
      // Shown on the confirmation screen and mailed out. Absent when
      // deposits are off, or when Stripe couldn't produce a link.
      depositAmount,
      depositUrl,
      manageToken: booking.manageToken,
    };
  });

/**
 * Public SEO/branding values for the site's <head>. Public on purpose —
 * these end up in meta tags that crawlers read.
 */
export const getSiteMeta = createServerFn({ method: "GET" }).handler(async () => {
  const { getSettings } = await import("../db.server");
  const s = await getSettings();
  return {
    title: s.siteTitle,
    tagline: s.siteTagline,
    description: s.siteDescription,
    keywords: s.siteKeywords,
    ogImageUrl: s.ogImageUrl,
    faviconUrl: s.faviconUrl,
    twitterHandle: s.twitterHandle,
    siteUrl: s.siteUrl,
    businessName: s.businessName,
    // Cookieless analytics only — see the settings comment. Sent to the
    // browser on purpose: it is a public script tag either way.
    analyticsScriptUrl: s.analyticsScriptUrl,
    analyticsSiteId: s.analyticsSiteId,
  };
});

/** Before/after pairs for the public gallery. */
export const getPublicGallery = createServerFn({ method: "GET" }).handler(async () => {
  const { listGallery, findPhoto } = await import("../db.server");
  const { readPhotoDataUrl } = await import("../uploads.server");

  const pairs = (await listGallery()).filter((p) => p.active);
  return {
    pairs: await Promise.all(
      pairs.map(async (p) => {
        const [b, a] = await Promise.all([findPhoto(p.beforePhotoId), findPhoto(p.afterPhotoId)]);
        return {
          id: p.id,
          label: p.label,
          detail: p.detail,
          description: p.description,
          packageLabel: p.packageLabel,
          beforeUrl: b ? await readPhotoDataUrl(b.id, b.mime) : null,
          afterUrl: a ? await readPhotoDataUrl(a.id, a.mime) : null,
        };
      }),
    ),
  };
});
