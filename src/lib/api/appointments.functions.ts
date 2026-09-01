import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// Editing an existing booking, its money breakdown, and bulk import of past
// jobs from a CSV.

const idSchema = z.string().min(1).max(60);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const timeSchema = z.string().regex(/^\d{2}:\d{2}$/);

export type BreakdownLine = {
  label: string;
  detail?: string;
  amount: number;
  /** Rendered in a muted style — informational, not part of the sum. */
  muted?: boolean;
};

/**
 * Itemise what a booking is worth.
 *
 * Prices are read from the live catalog, but the booking's stored total is
 * what was actually agreed. Those can diverge if the catalog changed after
 * the booking, so any gap becomes an explicit "Price adjustment" line rather
 * than being hidden — the breakdown always sums to the real total.
 */
export function buildBreakdown(
  booking: {
    serviceId: string;
    serviceTitle: string;
    addOnIds: string[];
    addOnTitles: string[];
    location: string;
    totalPrice: number;
    discount?: number;
    tip?: number;
    amountPaid?: number;
  },
  services: { id: string; title: string; priceValue: number }[],
  addOns: { id: string; name: string; price: number }[],
  travelFee: number,
): { lines: BreakdownLine[]; subtotal: number; grandTotal: number; balance: number } {
  const lines: BreakdownLine[] = [];

  const service = services.find((s) => s.id === booking.serviceId);
  const servicePrice = service?.priceValue ?? 0;
  lines.push({
    label: booking.serviceTitle,
    detail: "Package",
    amount: servicePrice,
  });

  let addOnTotal = 0;
  booking.addOnIds.forEach((id, i) => {
    const addOn = addOns.find((a) => a.id === id);
    const price = addOn?.price ?? 0;
    addOnTotal += price;
    lines.push({
      label: addOn?.name ?? booking.addOnTitles[i] ?? "Add-on",
      detail: "Add-on",
      amount: price,
    });
  });

  const travel = booking.location === "mobile" ? travelFee : 0;
  if (travel) lines.push({ label: "Mobile travel", detail: "Callout", amount: travel });

  const computed = servicePrice + addOnTotal + travel;
  const drift = Math.round((booking.totalPrice - computed) * 100) / 100;
  if (drift !== 0) {
    lines.push({
      label: "Price adjustment",
      detail: "Catalog prices have changed since this was booked",
      amount: drift,
    });
  }

  const subtotal = booking.totalPrice;
  if (booking.discount) {
    lines.push({ label: "Discount", detail: "Coupon", amount: -booking.discount });
  }
  if (booking.tip) {
    lines.push({ label: "Tip", detail: "Added after service", amount: booking.tip });
  }

  const grandTotal = subtotal - (booking.discount ?? 0) + (booking.tip ?? 0);
  return {
    lines,
    subtotal,
    grandTotal,
    balance: Math.max(0, grandTotal - (booking.amountPaid ?? 0)),
  };
}

/** Full detail for one booking, including its itemised money breakdown. */
export const getAppointmentDetail = createServerFn({ method: "GET" })
  .inputValidator(z.object({ id: idSchema }))
  .handler(async ({ data }) => {
    const { findBookingById, findClientById, listServices, listAddOns, getSettings } =
      await import("../db.server");
    const { requireUser } = await import("../auth.server");
    await requireUser();

    const booking = await findBookingById(data.id);
    if (!booking) throw new Error("Booking not found.");

    const [client, services, addOns, settings] = await Promise.all([
      findClientById(booking.clientId),
      listServices(),
      listAddOns(),
      getSettings(),
    ]);

    return {
      booking,
      client: client ?? null,
      breakdown: buildBreakdown(booking, services, addOns, settings.travelFee),
      catalog: {
        services: services.map((s) => ({
          id: s.id,
          title: s.title,
          priceValue: s.priceValue,
          durationMinutes: s.durationMinutes,
        })),
        addOns: addOns.map((a) => ({
          id: a.id,
          name: a.name,
          price: a.price,
          durationMinutes: a.durationMinutes,
        })),
        travelFee: settings.travelFee,
      },
    };
  });

/**
 * Edit an existing booking's contents.
 *
 * Re-prices from the live catalog exactly the way a new booking would, so an
 * edit can't quietly leave the total inconsistent with what's on it. The
 * owner can still override the total when a job was agreed at a special
 * price — that's an explicit choice, not a silent drift.
 */
export const updateAppointment = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      id: idSchema,
      serviceId: idSchema,
      addOnIds: z.array(idSchema).max(20).default([]),
      location: z.enum(["mobile", "shop"]),
      address: z.string().max(200).optional(),
      vehicle: z.object({
        make: z.string().max(40).default(""),
        model: z.string().max(40).default(""),
        year: z.string().max(4).default(""),
        color: z.string().max(30).default(""),
      }),
      notes: z.string().max(1000).optional(),
      /** Leave undefined to use the recomputed catalog price. */
      priceOverride: z.number().min(0).max(1000000).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { findBookingById, listServices, listAddOns, getSettings, updateBookingDetails } =
      await import("../db.server");
    const { requireUser } = await import("../auth.server");
    await requireUser();

    const existing = await findBookingById(data.id);
    if (!existing) throw new Error("Booking not found.");

    const [services, addOns, settings] = await Promise.all([
      listServices(),
      listAddOns(),
      getSettings(),
    ]);

    const service = services.find((s) => s.id === data.serviceId);
    if (!service) throw new Error("That package no longer exists.");
    const chosen = addOns.filter((a) => data.addOnIds.includes(a.id));

    if (data.location === "mobile" && (data.address?.trim().length ?? 0) < 5) {
      throw new Error("A service address is required for mobile jobs.");
    }

    const travel = data.location === "mobile" ? settings.travelFee : 0;
    const computed =
      service.priceValue + chosen.reduce((s, a) => s + a.price, 0) + travel;
    const durationMinutes =
      service.durationMinutes + chosen.reduce((s, a) => s + a.durationMinutes, 0);

    const booking = await updateBookingDetails(data.id, {
      serviceId: service.id,
      serviceTitle: service.title,
      addOnIds: chosen.map((a) => a.id),
      addOnTitles: chosen.map((a) => a.name),
      location: data.location,
      address: data.location === "mobile" ? data.address?.trim() : undefined,
      vehicle: data.vehicle,
      notes: data.notes?.trim() || undefined,
      totalPrice: data.priceOverride ?? computed,
      durationMinutes,
    });

    return { booking, recomputed: computed, durationMinutes };
  });

// ========================== CSV import ==================================

const importRow = z.object({
  date: dateSchema,
  startTime: timeSchema.default("09:00"),
  name: z.string().min(1).max(120),
  email: z.string().max(255).default(""),
  phone: z.string().max(30).default(""),
  service: z.string().max(80).default(""),
  addOns: z.string().max(500).default(""),
  location: z.string().max(20).default("shop"),
  address: z.string().max(200).default(""),
  vehicle: z.string().max(120).default(""),
  total: z.number().min(0).max(1000000).default(0),
  tip: z.number().min(0).max(100000).default(0),
  discount: z.number().min(0).max(1000000).default(0),
  /** Exported systems usually know the real duration — prefer it. */
  durationMinutes: z.number().int().min(0).max(1440).default(0),
  status: z.string().max(20).default("completed"),
  notes: z.string().max(1000).default(""),
});

/**
 * Bulk-import past jobs from a CSV export.
 *
 * Deliberately lenient about the catalog: a historical job may name a package
 * that no longer exists, and refusing the import would be worse than keeping
 * the label as typed. The row's own total is trusted, because that is what
 * was actually charged at the time.
 *
 * Imported jobs are marked `completed` by default and DO occupy their slot,
 * so importing history won't make old dates look bookable.
 */
export const importAppointments = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      rows: z.array(importRow).min(1).max(2000),
      /** Preview only — validate and report, write nothing. */
      dryRun: z.boolean().default(false),
    }),
  )
  .handler(async ({ data }) => {
    const {
      findOrCreateClient,
      addBooking,
      listBookings,
      listServices,
      listAddOns,
      updateBookingStatus,
      updateBookingPayment,
    } = await import("../db.server");
    const { requireUser } = await import("../auth.server");
    await requireUser();

    const [services, addOns, existing] = await Promise.all([
      listServices(),
      listAddOns(),
      listBookings(),
    ]);

    // A job on the same day, time and customer name is almost certainly the
    // same job — so re-running the same file doesn't duplicate history.
    const seen = new Set(existing.map((b) => `${b.date}|${b.startTime}|${b.clientId}`));

    let created = 0;
    let skipped = 0;
    const problems: string[] = [];

    for (const [i, row] of data.rows.entries()) {
      const line = i + 2; // +1 for zero-index, +1 for the header row
      try {
        // Match the package loosely. Other systems name things "Diamond
        // Detail" where this one just says "Diamond", so an exact compare
        // would leave every historical job unlinked.
        const wanted = row.service.trim().toLowerCase();
        const service =
          services.find((s) => s.title.toLowerCase() === wanted) ??
          services.find(
            (s) => wanted.includes(s.title.toLowerCase()) || s.title.toLowerCase().includes(wanted),
          );

        const wantedAddOns = row.addOns
          .split(/[;|,]/)
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean);
        // Same loose match for extras: "Excessive Pet Hair Removal" should
        // find "Pet hair removal".
        const matchedAddOns = addOns.filter((a) => {
          const name = a.name.toLowerCase();
          return wantedAddOns.some((w) => w === name || w.includes(name) || name.includes(w));
        });

        const location = row.location.trim().toLowerCase() === "mobile" ? "mobile" : "shop";
        const [year = "", make = "", ...rest] = row.vehicle.trim().split(/\s+/);
        const status = ["completed", "cancelled", "confirmed"].includes(
          row.status.trim().toLowerCase(),
        )
          ? (row.status.trim().toLowerCase() as "completed" | "cancelled" | "confirmed")
          : "completed";

        if (data.dryRun) {
          created += 1;
          if (!service && row.service.trim()) {
            problems.push(`Line ${line}: no package named "${row.service}" — will import as-is.`);
          }
          continue;
        }

        const client = await findOrCreateClient({
          name: row.name.trim(),
          // A blank email would collapse every such customer into one record,
          // so give them a stable, obviously-synthetic placeholder instead.
          email: row.email.trim() || `imported-${row.name.trim().toLowerCase().replace(/\s+/g, "-")}@import.local`,
          phone: row.phone.trim(),
        });

        const key = `${row.date}|${row.startTime}|${client.id}`;
        if (seen.has(key)) {
          skipped += 1;
          continue;
        }
        seen.add(key);

        const booking = await addBooking({
          clientId: client.id,
          serviceId: service?.id ?? "imported",
          serviceTitle: service?.title ?? row.service.trim() ?? "Imported job",
          date: row.date,
          startTime: row.startTime,
          // The file's own duration wins — it's what the job actually took,
          // and it keeps historical blocks the right size on the calendar.
          durationMinutes:
            row.durationMinutes ||
            (service?.durationMinutes ?? 120) +
              matchedAddOns.reduce((s, a) => s + a.durationMinutes, 0),
          addOnIds: matchedAddOns.map((a) => a.id),
          addOnTitles: matchedAddOns.length
            ? matchedAddOns.map((a) => a.name)
            : row.addOns.split(/[;|]/).map((s) => s.trim()).filter(Boolean),
          location,
          address: location === "mobile" ? row.address.trim() || undefined : undefined,
          vehicle: row.vehicle.trim()
            ? { year, make, model: rest.join(" "), color: "" }
            : undefined,
          totalPrice: row.total,
          discount: row.discount || undefined,
          notes: row.notes.trim() || undefined,
        });

        if (status !== "confirmed") await updateBookingStatus(booking.id, status);
        // Historical jobs are already settled; recording that keeps the
        // Payments page from showing years of phantom debt. Upcoming ones
        // are left unpaid, because they genuinely are.
        if (status === "completed") {
          await updateBookingPayment(booking.id, {
            tip: row.tip || undefined,
            amountPaid: row.total - row.discount + row.tip,
            paymentStatus: "paid",
            paymentMethod: "Imported",
          });
        }
        created += 1;
      } catch (err) {
        problems.push(`Line ${line}: ${err instanceof Error ? err.message : "could not import"}`);
      }
    }

    return { created, skipped, problems: problems.slice(0, 25), dryRun: data.dryRun };
  });
