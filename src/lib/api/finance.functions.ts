import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { buildPeriodWindow, periodKey, type PeriodUnit } from "../periods";

// The money-out side of the business, and the profit-and-loss that falls out
// of combining it with completed jobs.
//
// Accounting model, kept deliberately simple and honest:
//
//   revenue        completed jobs only (price - discount + tip)
//   - cogs         expenses typed "cogs" — supplies consumed doing the work
//   = gross profit
//   - operating    expenses typed "operating" — fuel, insurance, ads, wages
//   = net profit   (before equipment)
//   - equipment    durable purchases, kept out of net so one machine doesn't
//                  make a good month look like a disaster
//
// Every figure traces to a real record. Nothing is estimated or extrapolated,
// with one exception that is always labelled as an estimate: the per-package
// margin, which uses the optional materialCost set on each service.

const idSchema = z.string().min(1).max(60);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const EXPENSE_TYPES = ["cogs", "operating", "equipment"] as const;

// ========================== Expense CRUD ================================

export const listAdminExpenses = createServerFn({ method: "GET" })
  .inputValidator(
    z
      .object({
        from: dateSchema.optional(),
        to: dateSchema.optional(),
        type: z.enum(EXPENSE_TYPES).optional(),
      })
      .default({}),
  )
  .handler(async ({ data }) => {
    const { listExpenses, listAssets, EXPENSE_CATEGORIES } = await import("../db.server");
    const { requireUser } = await import("../auth.server");
    await requireUser();

    const [expenses, assets] = await Promise.all([listExpenses(data), listAssets()]);
    const assetName = new Map(assets.map((a) => [a.id, a.name]));

    return {
      expenses: expenses.map((e) => ({
        ...e,
        assetName: e.assetId ? (assetName.get(e.assetId) ?? null) : null,
      })),
      categories: [...EXPENSE_CATEGORIES],
      assets: assets.map((a) => ({ id: a.id, name: a.name, kind: a.kind, unit: a.unit })),
      total: expenses.reduce((s, e) => s + e.amount, 0),
    };
  });

export const saveExpense = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      id: idSchema.optional(),
      date: dateSchema,
      description: z.string().min(1).max(200),
      category: z.string().min(1).max(60),
      vendor: z.string().max(80).optional(),
      type: z.enum(EXPENSE_TYPES).default("operating"),
      amount: z.number().min(0).max(10000000),
      quantity: z.number().min(0).max(1000000).optional(),
      unitCost: z.number().min(0).max(1000000).optional(),
      assetId: z.string().max(60).optional(),
      bookingId: z.string().max(60).optional(),
      paymentMethod: z.string().max(40).optional(),
      notes: z.string().max(1000).optional(),
      /** Also raise the linked item's stock by `quantity`. */
      restock: z.boolean().default(false),
    }),
  )
  .handler(async ({ data }) => {
    const { addExpense } = await import("../db.server");
    const { requireUser } = await import("../auth.server");
    await requireUser();

    const { restock, ...record } = data;
    const expense = await addExpense(
      {
        ...record,
        assetId: record.assetId || undefined,
        bookingId: record.bookingId || undefined,
        vendor: record.vendor || undefined,
      },
      restock && record.assetId ? record.assetId : undefined,
    );
    return { expense };
  });

export const removeExpense = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: idSchema }))
  .handler(async ({ data }) => {
    const { deleteExpense } = await import("../db.server");
    const { requireUser } = await import("../auth.server");
    await requireUser();
    await deleteExpense(data.id);
    return { ok: true };
  });

// ======================= Profit & loss ==================================

export const getFinance = createServerFn({ method: "GET" })
  .inputValidator(
    z
      .object({
        months: z.number().int().min(1).max(36).default(12),
        unit: z.enum(["week", "month"]).default("month"),
      })
      .default({ months: 12, unit: "month" }),
  )
  .handler(async ({ data }) => {
    const { listBookingsWithClients, listExpenses, listServices, getSettings, listAssets } =
      await import("../db.server");
    const { requireUser } = await import("../auth.server");
    await requireUser();

    const [bookings, expenses, services, settings, assets] = await Promise.all([
      listBookingsWithClients(),
      listExpenses(),
      listServices(),
      getSettings(),
      listAssets(),
    ]);

    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: settings.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());

    const earned = (b: (typeof bookings)[number]) =>
      (b.totalPrice ?? 0) - (b.discount ?? 0) + (b.tip ?? 0);

    const active = bookings.filter((b) => b.status !== "cancelled");
    const completed = active.filter((b) => b.status === "completed");

    const sumBy = (list: typeof expenses, type: string) =>
      list.filter((e) => e.type === type).reduce((s, e) => s + e.amount, 0);

    // ---- Month buckets, oldest first --------------------------------
    // The window runs to the current month, or past it when completed work
    // or expenses are dated later — otherwise a job finished for a date early
    // next month would drop out of the P&L entirely. See lib/months.ts.
    const unit: PeriodUnit = data.unit;
    const months = buildPeriodWindow(today, unit, data.months, [
      ...completed.map((b) => b.date),
      ...expenses.map((e) => e.date),
    ]).map(({ key, label, start, end }) => {
      const jobsIn = completed.filter((b) => periodKey(b.date, unit) === key);
      const expIn = expenses.filter((e) => periodKey(e.date, unit) === key);

      const revenue = jobsIn.reduce((s, b) => s + earned(b), 0);
      const cogs = sumBy(expIn, "cogs");
      const operating = sumBy(expIn, "operating");
      const equipment = sumBy(expIn, "equipment");

      return {
        key,
        label,
        start,
        end,
        revenue,
        cogs,
        operating,
        equipment,
        gross: revenue - cogs,
        net: revenue - cogs - operating,
        jobs: jobsIn.length,
      };
    });

    // ---- Period totals ----------------------------------------------
    // Everything below is scoped to the SELECTED WINDOW, not all time.
    // A P&L is a statement about a period, and if the headline covered all
    // history it could never reconcile with the chart above it.
    const windowKeys = new Set(months.map((m) => m.key));
    const inWindow = (d: string) => windowKeys.has(periodKey(d, unit));

    const periodJobs = completed.filter((b) => inWindow(b.date));
    const periodExpenses = expenses.filter((e) => inWindow(e.date));

    const revenue = periodJobs.reduce((s, b) => s + earned(b), 0);
    const cogs = sumBy(periodExpenses, "cogs");
    const operating = sumBy(periodExpenses, "operating");
    const equipment = sumBy(periodExpenses, "equipment");
    const grossProfit = revenue - cogs;
    const netProfit = grossProfit - operating;

    // Records dated outside the window would otherwise vanish with no trace,
    // which looks like lost data. Report them so the UI can say so.
    const outsideExpenses = expenses.filter((e) => !inWindow(e.date));

    const pct = (part: number, whole: number) =>
      whole > 0 ? Math.round((part / whole) * 1000) / 10 : null;

    // ---- Spend by category ------------------------------------------
    const catMap = new Map<string, { amount: number; type: string; count: number }>();
    for (const e of periodExpenses) {
      const hit = catMap.get(e.category) ?? { amount: 0, type: e.type, count: 0 };
      hit.amount += e.amount;
      hit.count += 1;
      catMap.set(e.category, hit);
    }
    const totalSpend = cogs + operating + equipment;
    const byCategory = [...catMap.entries()]
      .map(([category, v]) => ({
        category,
        amount: Math.round(v.amount),
        type: v.type,
        count: v.count,
        share: totalSpend > 0 ? Math.round((v.amount / totalSpend) * 100) : 0,
      }))
      .sort((a, b) => b.amount - a.amount);

    // ---- Per-package margin (ESTIMATE — uses service.materialCost) ---
    const svcMap = new Map<
      string,
      { title: string; jobs: number; revenue: number; materialCost: number }
    >();
    for (const b of periodJobs) {
      const svc = services.find((s) => s.id === b.serviceId);
      const hit = svcMap.get(b.serviceId) ?? {
        title: b.serviceTitle,
        jobs: 0,
        revenue: 0,
        materialCost: svc?.materialCost ?? 0,
      };
      hit.jobs += 1;
      hit.revenue += earned(b);
      svcMap.set(b.serviceId, hit);
    }
    const byService = [...svcMap.values()]
      .map((s) => {
        const estCost = s.materialCost * s.jobs;
        return {
          title: s.title,
          jobs: s.jobs,
          revenue: Math.round(s.revenue),
          materialCost: s.materialCost,
          estCost: Math.round(estCost),
          estProfit: Math.round(s.revenue - estCost),
          estMargin: pct(s.revenue - estCost, s.revenue),
          avgTicket: s.jobs > 0 ? Math.round(s.revenue / s.jobs) : 0,
        };
      })
      .sort((a, b) => b.revenue - a.revenue);

    /** True only once at least one package has a material cost entered. */
    const hasMaterialCosts = services.some((s) => (s.materialCost ?? 0) > 0);

    // ---- Vendors -----------------------------------------------------
    const vendorMap = new Map<string, number>();
    for (const e of periodExpenses) {
      if (!e.vendor) continue;
      vendorMap.set(e.vendor, (vendorMap.get(e.vendor) ?? 0) + e.amount);
    }
    const topVendors = [...vendorMap.entries()]
      .map(([vendor, amount]) => ({ vendor, amount: Math.round(amount) }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 6);

    // ---- Cash position ----------------------------------------------
    const outstanding = active
      .filter((b) => (b.paymentStatus ?? "unpaid") !== "paid" && b.paymentStatus !== "refunded")
      .reduce((s, b) => s + Math.max(0, earned(b) - (b.amountPaid ?? 0)), 0);

    // The bucket containing today, whatever unit is in play.
    const thisMonthKey = periodKey(today, unit);
    const thisMonth = months.find((m) => m.key === thisMonthKey);
    // The bucket immediately before the current one, taken from the window
    // itself so it can't drift from what the chart actually drew.
    const currentIndex = months.findIndex((m) => m.key === thisMonthKey);
    const prevKey = currentIndex > 0 ? months[currentIndex - 1].key : "";
    const prevMonth = months.find((m) => m.key === prevKey);

    return {
      totals: {
        revenue: Math.round(revenue),
        cogs: Math.round(cogs),
        grossProfit: Math.round(grossProfit),
        grossMargin: pct(grossProfit, revenue),
        operating: Math.round(operating),
        equipment: Math.round(equipment),
        netProfit: Math.round(netProfit),
        netMargin: pct(netProfit, revenue),
        totalSpend: Math.round(totalSpend),
        jobs: periodJobs.length,
        avgTicket: periodJobs.length ? Math.round(revenue / periodJobs.length) : 0,
        tips: Math.round(periodJobs.reduce((s, b) => s + (b.tip ?? 0), 0)),
        outstanding: Math.round(outstanding),
        stockValue: Math.round(
          assets
            .filter((a) => a.kind === "consumable")
            .reduce((s, a) => s + a.quantity * a.unitCost, 0),
        ),
        expenseCount: periodExpenses.length,
      },
      outside: {
        count: outsideExpenses.length,
        amount: Math.round(outsideExpenses.reduce((s, e) => s + e.amount, 0)),
      },
      thisMonth: {
        revenue: Math.round(thisMonth?.revenue ?? 0),
        net: Math.round(thisMonth?.net ?? 0),
        jobs: thisMonth?.jobs ?? 0,
        netChange:
          prevMonth && prevMonth.net !== 0
            ? Math.round((((thisMonth?.net ?? 0) - prevMonth.net) / Math.abs(prevMonth.net)) * 100)
            : null,
      },
      months,
      unit,
      byCategory,
      byService,
      hasMaterialCosts,
      topVendors,
      recentExpenses: periodExpenses.slice(0, 8).map((e) => ({
        id: e.id,
        date: e.date,
        description: e.description,
        category: e.category,
        type: e.type,
        amount: Math.round(e.amount),
        vendor: e.vendor ?? null,
      })),
      lowStock: assets
        .filter((a) => a.kind === "consumable" && a.reorderLevel > 0 && a.quantity <= a.reorderLevel)
        .map((a) => ({ id: a.id, name: a.name, quantity: a.quantity, unit: a.unit })),
    };
  });

// ======================= Stripe & webhooks ==============================

export const saveStripeSettings = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      stripeSecretKey: z.string().max(200).optional(),
      stripePublishableKey: z.string().max(200).optional(),
      stripeCurrency: z.string().min(3).max(3).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { updateSettings } = await import("../db.server");
    const { requireRole } = await import("../auth.server");
    // Payment credentials are owner-only — a staff account shouldn't be able
    // to point takings at a different Stripe account.
    await requireRole("owner");

    const patch: Record<string, string> = {};
    if (data.stripeSecretKey !== undefined) patch.stripeSecretKey = data.stripeSecretKey.trim();
    if (data.stripePublishableKey !== undefined) {
      patch.stripePublishableKey = data.stripePublishableKey.trim();
    }
    if (data.stripeCurrency) patch.stripeCurrency = data.stripeCurrency.toLowerCase();
    // Changing the key invalidates whatever account name we cached.
    if (data.stripeSecretKey !== undefined) patch.stripeAccountName = "";

    await updateSettings(patch);
    return { ok: true };
  });

/** Ask Stripe who the key belongs to — a real check, not a format test. */
export const testStripeConnection = createServerFn({ method: "POST" }).handler(async () => {
  const { getSettings, updateSettings } = await import("../db.server");
  const { verifyStripeKey } = await import("../stripe.server");
  const { requireRole } = await import("../auth.server");
  await requireRole("owner");

  const settings = await getSettings();
  const info = await verifyStripeKey(settings.stripeSecretKey);
  await updateSettings({ stripeAccountName: info.accountName });
  return info;
});

export const disconnectStripe = createServerFn({ method: "POST" }).handler(async () => {
  const { updateSettings } = await import("../db.server");
  const { requireRole } = await import("../auth.server");
  await requireRole("owner");
  await updateSettings({ stripeSecretKey: "", stripePublishableKey: "", stripeAccountName: "" });
  return { ok: true };
});

/** Create a hosted Stripe Payment Link for a booking's outstanding balance. */
export const createBookingPaymentLink = createServerFn({ method: "POST" })
  .inputValidator(z.object({ bookingId: idSchema }))
  .handler(async ({ data }) => {
    const { findBookingById, getSettings } = await import("../db.server");
    const { createPaymentLink } = await import("../stripe.server");
    const { requireUser } = await import("../auth.server");
    await requireUser();

    const booking = await findBookingById(data.bookingId);
    if (!booking) throw new Error("Booking not found.");

    const settings = await getSettings();
    const owed =
      (booking.totalPrice ?? 0) -
      (booking.discount ?? 0) +
      (booking.tip ?? 0) -
      (booking.amountPaid ?? 0);

    const link = await createPaymentLink({
      amount: Math.round(owed * 100) / 100,
      description: `${booking.serviceTitle} — ${settings.businessName} (${booking.reference})`,
      reference: booking.reference,
    });
    return link;
  });

export const saveWebhookSettings = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      webhookUrl: z.string().max(500),
      webhookSecret: z.string().max(200).optional(),
      webhookEvents: z
        .array(z.enum(["booking_created", "booking_cancelled", "booking_completed"]))
        .default([]),
    }),
  )
  .handler(async ({ data }) => {
    const { updateSettings } = await import("../db.server");
    const { requireRole } = await import("../auth.server");
    await requireRole("owner");

    const url = data.webhookUrl.trim();
    if (url) {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        throw new Error("That isn't a valid URL.");
      }
      // Plain http would send booking details, including addresses, in clear
      // text across the network.
      if (parsed.protocol !== "https:") throw new Error("The webhook URL must use https.");
    }

    await updateSettings({
      webhookUrl: url,
      webhookSecret: data.webhookSecret?.trim() ?? "",
      webhookEvents: data.webhookEvents,
    });
    return { ok: true };
  });

export const testWebhook = createServerFn({ method: "POST" }).handler(async () => {
  const { sendTestWebhook } = await import("../webhooks.server");
  const { requireRole } = await import("../auth.server");
  await requireRole("owner");
  return await sendTestWebhook();
});
