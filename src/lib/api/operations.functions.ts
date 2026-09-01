import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// Agents (staff), Locations (shops + service zones) and Assets (equipment +
// consumables). Same conventions as the other .functions.ts files: server
// modules are imported dynamically inside the handler so nothing here can
// leak into the client bundle, and every call starts with requireUser().

const idSchema = z.string().min(1).max(60);

// ============================ Agents ====================================

export const listAdminAgents = createServerFn({ method: "GET" }).handler(async () => {
  const { listAgents, listBookingsWithClients, listUsers } = await import("../db.server");
  const { requireUser } = await import("../auth.server");
  await requireUser();

  const [agents, bookings, users] = await Promise.all([
    listAgents(),
    listBookingsWithClients(),
    listUsers(),
  ]);

  const active = bookings.filter((b) => b.status !== "cancelled");
  const earned = (b: { totalPrice?: number; discount?: number; tip?: number }) =>
    (b.totalPrice ?? 0) - (b.discount ?? 0) + (b.tip ?? 0);

  const withStats = agents.map((a) => {
    const mine = active.filter((b) => b.agentId === a.id);
    const done = mine.filter((b) => b.status === "completed");
    const revenue = done.reduce((s, b) => s + earned(b), 0);
    const minutes = done.reduce((s, b) => s + (b.durationMinutes ?? 0), 0);

    // An ESTIMATE of what this person has earned, from their pay setup. It is
    // deliberately not folded into the P&L — record real wages as an expense
    // so reported profit always traces to money that actually moved.
    const estimatedPay =
      a.payType === "commission"
        ? Math.round((revenue * a.payRate) / 100)
        : a.payType === "hourly"
          ? Math.round((minutes / 60) * a.payRate)
          : 0;

    return {
      ...a,
      jobsAssigned: mine.length,
      jobsCompleted: done.length,
      upcoming: mine.filter((b) => b.status === "confirmed").length,
      revenue,
      hours: Math.round((minutes / 60) * 10) / 10,
      estimatedPay,
      linkedAccount: a.userId ? (users.find((u) => u.id === a.userId)?.email ?? null) : null,
    };
  });

  return {
    agents: withStats,
    unassigned: active.filter((b) => !b.agentId && b.status !== "cancelled").length,
    accounts: users.map((u) => ({ id: u.id, email: u.email, name: u.name, role: u.role })),
  };
});

export const saveAgent = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      id: idSchema,
      name: z.string().min(1).max(80),
      email: z.string().max(160).optional().default(""),
      phone: z.string().max(40).optional().default(""),
      title: z.string().max(60).optional().default(""),
      payType: z.enum(["none", "hourly", "commission"]).default("none"),
      payRate: z.number().min(0).max(100000).default(0),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#38bdf8"),
      userId: z.string().max(60).optional(),
      notes: z.string().max(1000).optional(),
      active: z.boolean().default(true),
      sortOrder: z.number().int().min(0).max(999).default(0),
    }),
  )
  .handler(async ({ data }) => {
    const { upsertAgent, findAgentById } = await import("../db.server");
    const { requireUser } = await import("../auth.server");
    await requireUser();

    // A commission rate above 100% would quietly produce negative margins.
    if (data.payType === "commission" && data.payRate > 100) {
      throw new Error("A commission rate can't be above 100%.");
    }

    const existing = await findAgentById(data.id);
    return {
      agent: await upsertAgent({
        ...data,
        userId: data.userId || undefined,
        createdAt: existing?.createdAt ?? new Date().toISOString(),
      }),
    };
  });

export const removeAgent = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: idSchema }))
  .handler(async ({ data }) => {
    const { deleteAgent } = await import("../db.server");
    const { requireUser } = await import("../auth.server");
    await requireUser();
    await deleteAgent(data.id);
    return { ok: true };
  });

/** Assign or clear the staff member / location on one booking. */
export const assignAppointment = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      bookingId: idSchema,
      agentId: z.string().max(60).nullable().optional(),
      locationId: z.string().max(60).nullable().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { assignBooking } = await import("../db.server");
    const { requireUser } = await import("../auth.server");
    await requireUser();

    const { bookingId, ...patch } = data;
    const booking = await assignBooking(bookingId, {
      agentId: patch.agentId === "" ? null : patch.agentId,
      locationId: patch.locationId === "" ? null : patch.locationId,
    });
    if (!booking) throw new Error("Booking not found.");
    return { booking };
  });

// ========================== Locations ===================================

export const listAdminLocations = createServerFn({ method: "GET" }).handler(async () => {
  const { listLocations, listBookingsWithClients, getSettings } = await import("../db.server");
  const { requireUser } = await import("../auth.server");
  await requireUser();

  const [locations, bookings, settings] = await Promise.all([
    listLocations(),
    listBookingsWithClients(),
    getSettings(),
  ]);

  const active = bookings.filter((b) => b.status !== "cancelled");
  const withStats = locations.map((l) => {
    const mine = active.filter((b) => b.locationId === l.id);
    return {
      ...l,
      jobs: mine.length,
      revenue: mine
        .filter((b) => b.status === "completed")
        .reduce((s, b) => s + (b.totalPrice ?? 0) - (b.discount ?? 0) + (b.tip ?? 0), 0),
    };
  });

  return {
    locations: withStats,
    // The global fallback, shown so the per-zone fees have context.
    defaultTravelFee: settings.travelFee,
    serviceArea: settings.serviceArea,
    unassigned: active.filter((b) => !b.locationId).length,
  };
});

export const saveLocation = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      id: idSchema,
      name: z.string().min(1).max(80),
      kind: z.enum(["shop", "zone"]).default("zone"),
      address: z.string().max(200).optional().default(""),
      city: z.string().max(80).optional().default(""),
      postalCode: z.string().max(20).optional().default(""),
      travelFee: z.number().min(0).max(10000).default(0),
      radiusKm: z.number().min(0).max(1000).default(0),
      notes: z.string().max(1000).optional(),
      active: z.boolean().default(true),
      sortOrder: z.number().int().min(0).max(999).default(0),
    }),
  )
  .handler(async ({ data }) => {
    const { upsertLocation, listLocations } = await import("../db.server");
    const { requireUser } = await import("../auth.server");
    await requireUser();

    const existing = (await listLocations()).find((l) => l.id === data.id);
    return {
      location: await upsertLocation({
        ...data,
        createdAt: existing?.createdAt ?? new Date().toISOString(),
      }),
    };
  });

export const removeLocation = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: idSchema }))
  .handler(async ({ data }) => {
    const { deleteLocation } = await import("../db.server");
    const { requireUser } = await import("../auth.server");
    await requireUser();
    await deleteLocation(data.id);
    return { ok: true };
  });

// ============================ Assets ====================================

export const listAdminAssets = createServerFn({ method: "GET" }).handler(async () => {
  const { listAssets, listExpenses } = await import("../db.server");
  const { requireUser } = await import("../auth.server");
  await requireUser();

  const [assets, expenses] = await Promise.all([listAssets(), listExpenses()]);

  const spendByAsset = new Map<string, number>();
  for (const e of expenses) {
    if (e.assetId) spendByAsset.set(e.assetId, (spendByAsset.get(e.assetId) ?? 0) + e.amount);
  }

  const withStats = assets.map((a) => ({
    ...a,
    stockValue: Math.round(a.quantity * a.unitCost),
    spentToDate: Math.round(spendByAsset.get(a.id) ?? 0),
    low: a.kind === "consumable" && a.reorderLevel > 0 && a.quantity <= a.reorderLevel,
  }));

  const consumables = withStats.filter((a) => a.kind === "consumable");
  const equipment = withStats.filter((a) => a.kind === "equipment");

  return {
    assets: withStats,
    totals: {
      stockValue: consumables.reduce((s, a) => s + a.stockValue, 0),
      equipmentValue: equipment.reduce((s, a) => s + a.stockValue, 0),
      lowCount: withStats.filter((a) => a.low).length,
      consumableCount: consumables.length,
      equipmentCount: equipment.length,
    },
  };
});

export const saveAsset = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      id: idSchema,
      name: z.string().min(1).max(80),
      kind: z.enum(["equipment", "consumable"]).default("consumable"),
      category: z.string().max(60).optional().default(""),
      unit: z.string().max(20).optional().default("each"),
      unitCost: z.number().min(0).max(1000000).default(0),
      quantity: z.number().min(0).max(1000000).default(0),
      reorderLevel: z.number().min(0).max(1000000).default(0),
      supplier: z.string().max(80).optional(),
      notes: z.string().max(1000).optional(),
      active: z.boolean().default(true),
    }),
  )
  .handler(async ({ data }) => {
    const { upsertAsset, findAssetById } = await import("../db.server");
    const { requireUser } = await import("../auth.server");
    await requireUser();

    const existing = await findAssetById(data.id);
    return {
      asset: await upsertAsset({
        ...data,
        createdAt: existing?.createdAt ?? new Date().toISOString(),
      }),
    };
  });

export const removeAsset = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: idSchema }))
  .handler(async ({ data }) => {
    const { deleteAsset } = await import("../db.server");
    const { requireUser } = await import("../auth.server");
    await requireUser();
    await deleteAsset(data.id);
    return { ok: true };
  });

/** Consume or correct stock without logging a purchase. */
export const adjustStock = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({ id: idSchema, delta: z.number().min(-1000000).max(1000000) }),
  )
  .handler(async ({ data }) => {
    const { adjustAssetStock } = await import("../db.server");
    const { requireUser } = await import("../auth.server");
    await requireUser();
    const asset = await adjustAssetStock(data.id, data.delta);
    if (!asset) throw new Error("Item not found.");
    return { asset };
  });

/**
 * Buy more of a consumable: records the expense AND raises stock in one
 * transaction, so the ledger and the shelf can't drift apart.
 */
export const restockAsset = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      id: idSchema,
      quantity: z.number().min(0.01).max(1000000),
      unitCost: z.number().min(0).max(1000000),
      vendor: z.string().max(80).optional(),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }),
  )
  .handler(async ({ data }) => {
    const { findAssetById, addExpense, upsertAsset } = await import("../db.server");
    const { requireUser } = await import("../auth.server");
    await requireUser();

    const asset = await findAssetById(data.id);
    if (!asset) throw new Error("Item not found.");

    const amount = Math.round(data.quantity * data.unitCost * 100) / 100;

    await addExpense(
      {
        date: data.date,
        description: `Restock — ${asset.name}`,
        // Consumables are cost of goods; equipment is a capital purchase.
        category: asset.kind === "equipment" ? "Equipment" : "Chemicals & supplies",
        type: asset.kind === "equipment" ? "equipment" : "cogs",
        vendor: data.vendor || asset.supplier,
        amount,
        quantity: data.quantity,
        unitCost: data.unitCost,
        assetId: asset.id,
      },
      asset.id,
    );

    // Keep the unit cost current so stock value reflects what it costs today.
    // Re-read first: addExpense just raised the quantity, and writing back the
    // pre-restock snapshot would silently undo the stock we just added.
    if (data.unitCost > 0 && data.unitCost !== asset.unitCost) {
      const fresh = await findAssetById(asset.id);
      if (fresh) await upsertAsset({ ...fresh, unitCost: data.unitCost });
    }

    const updated = await findAssetById(asset.id);
    return { ok: true, amount, quantity: updated?.quantity ?? asset.quantity };
  });
