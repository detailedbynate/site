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
      .map(({ id, title, subtitle, priceValue, durationMinutes }) => ({
        id,
        title,
        subtitle,
        priceValue,
        durationMinutes,
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
      throw new Error("That time was just booked by someone else — please pick another slot.");
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
      notes: data.notes,
      googleEventId: googleEventId ?? undefined,
    });

    if (Object.keys(data.customFields).length) {
      const { setBookingCustomFields } = await import("../db.server");
      await setBookingCustomFields(booking.id, data.customFields);
    }

    // Confirmation email. Fire-and-forget and never throws — the booking is
    // already saved, and a mail outage must not fail the customer's booking.
    void import("../email.server")
      .then(({ runTriggerAndCustom }) => runTriggerAndCustom("booking_confirmed", booking))
      .catch(() => undefined);

    return { booking, client };
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
          beforeUrl: b ? await readPhotoDataUrl(b.id, b.mime) : null,
          afterUrl: a ? await readPhotoDataUrl(a.id, a.mime) : null,
        };
      }),
    ),
  };
});
