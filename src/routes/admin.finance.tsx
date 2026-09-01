import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Boxes,
  Coins,
  Info,
  Landmark,
  Plus,
  Receipt,
  Trash2,
  TrendingDown,
  TrendingUp,
  Wallet,
  Wrench,
} from "lucide-react";

import { getFinance, listAdminExpenses, removeExpense, saveExpense } from "@/lib/api/finance.functions";
import { EditorModal, FieldRow } from "@/components/admin/EditorModal";
import { TabBar } from "@/components/admin/TabBar";
import {
  Button,
  ErrorNote,
  Field,
  GlassCard,
  PageHeader,
  Spinner,
  StatTile,
  SuccessNote,
  inputCls,
  money,
  prettyDate,
} from "@/components/admin/ui";

export const Route = createFileRoute("/admin/finance")({
  component: Finance,
});

type Finance = Awaited<ReturnType<typeof getFinance>>;
type Expenses = Awaited<ReturnType<typeof listAdminExpenses>>;

const TYPE_LABEL: Record<string, string> = {
  cogs: "Cost of goods",
  operating: "Operating",
  equipment: "Equipment",
};

const TYPE_STYLE: Record<string, string> = {
  cogs: "bg-amber-400/12 text-amber-300 ring-amber-400/25",
  operating: "bg-sky-400/12 text-sky-300 ring-sky-400/25",
  equipment: "bg-violet-400/12 text-violet-300 ring-violet-400/25",
};

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

type Draft = {
  id?: string;
  date: string;
  description: string;
  category: string;
  vendor: string;
  type: "cogs" | "operating" | "equipment";
  amount: number;
  quantity: string;
  unitCost: string;
  assetId: string;
  paymentMethod: string;
  notes: string;
  restock: boolean;
};

function blankDraft(categories: string[]): Draft {
  return {
    date: todayISO(),
    description: "",
    category: categories[0] ?? "Other",
    vendor: "",
    type: "cogs",
    amount: 0,
    quantity: "",
    unitCost: "",
    assetId: "",
    paymentMethod: "",
    notes: "",
    restock: false,
  };
}

function Finance() {
  const [fin, setFin] = useState<Finance | null>(null);
  const [exp, setExp] = useState<Expenses | null>(null);
  const [months, setMonths] = useState(12);
  const [unit, setUnit] = useState<"week" | "month">("month");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [f, e] = await Promise.all([
        getFinance({ data: { months, unit } }),
        listAdminExpenses({ data: {} }),
      ]);
      setFin(f);
      setExp(e);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load.");
    }
  }, [months, unit]);

  useEffect(() => {
    void load();
  }, [load]);

  const flash = (m: string) => {
    setOk(m);
    setTimeout(() => setOk(null), 2600);
  };

  // Amount is derived whenever both quantity and unit cost are filled in, so
  // a per-unit purchase can't be entered inconsistently with its total.
  const derivedAmount = useMemo(() => {
    if (!draft) return null;
    const q = Number(draft.quantity);
    const u = Number(draft.unitCost);
    if (!draft.quantity || !draft.unitCost || !Number.isFinite(q) || !Number.isFinite(u)) return null;
    return Math.round(q * u * 100) / 100;
  }, [draft]);

  const save = async () => {
    if (!draft) return;
    const amount = derivedAmount ?? Number(draft.amount);
    if (!draft.description.trim()) return setError("Give the expense a description.");
    if (!Number.isFinite(amount) || amount <= 0) return setError("Enter an amount above zero.");

    setSaving(true);
    setError(null);
    try {
      await saveExpense({
        data: {
          id: draft.id,
          date: draft.date,
          description: draft.description.trim(),
          category: draft.category,
          vendor: draft.vendor.trim() || undefined,
          type: draft.type,
          amount,
          quantity: draft.quantity ? Number(draft.quantity) : undefined,
          unitCost: draft.unitCost ? Number(draft.unitCost) : undefined,
          assetId: draft.assetId || undefined,
          paymentMethod: draft.paymentMethod.trim() || undefined,
          notes: draft.notes.trim() || undefined,
          restock: draft.restock && !!draft.assetId,
        },
      });
      setDraft(null);
      flash("Expense recorded.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save it.");
    } finally {
      setSaving(false);
    }
  };

  const del = async (id: string) => {
    if (!confirm("Delete this expense? The P&L will change.")) return;
    try {
      await removeExpense({ data: { id } });
      flash("Expense deleted.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete it.");
    }
  };

  const exportCsv = () => {
    if (!exp) return;
    const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    const rows = [
      ["Date", "Description", "Category", "Type", "Vendor", "Amount"],
      ...exp.expenses.map((e) => [e.date, e.description, e.category, e.type, e.vendor ?? "", e.amount]),
    ];
    const csv = rows.map((r) => r.map(esc).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `expenses-${todayISO()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (error && !fin) return <ErrorNote>{error}</ErrorNote>;
  if (!fin || !exp) return <Spinner label="Building the P&L…" />;

  const t = fin.totals;
  const peak = Math.max(1, ...fin.months.map((m) => Math.max(m.revenue, m.cogs + m.operating + m.equipment)));

  return (
    <>
      <PageHeader
        title="Finance"
        subtitle={`Revenue from completed jobs, minus what you actually spent, over the last ${months} ${unit === "week" ? "weeks" : "months"}. Every figure traces to a real record — nothing is estimated unless it says so.`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <TabBar
              layoutId="fin-unit"
              size="sm"
              value={unit}
              onChange={(u) => {
                setUnit(u);
                // A sensible span for each: a quarter of weeks, or a year.
                setMonths(u === "week" ? 12 : 12);
              }}
              tabs={[
                { value: "week" as const, label: "Weekly" },
                { value: "month" as const, label: "Monthly" },
              ]}
            />
            <select
              value={months}
              onChange={(e) => setMonths(Number(e.target.value))}
              aria-label="How far back to look"
              className="rounded-lg border border-[var(--line-2)] bg-[var(--fill-1)] px-3 py-2 text-[13px] font-semibold text-foreground outline-none focus:border-primary/60"
            >
              {(unit === "week" ? [4, 8, 12, 26] : [3, 6, 12, 24]).map((n) => (
                <option key={n} value={n}>
                  Last {n} {unit === "week" ? "weeks" : "months"}
                </option>
              ))}
            </select>
            <Button onClick={exportCsv}>Export CSV</Button>
            <Button variant="primary" onClick={() => setDraft(blankDraft(exp.categories))}>
              <Plus className="h-3.5 w-3.5" /> Add expense
            </Button>
          </div>
        }
      />

      <AnimatePresence>{ok && <SuccessNote>{ok}</SuccessNote>}</AnimatePresence>
      {error && (
        <div className="mb-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      {fin.outside.count > 0 && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-[var(--line-2)] bg-[var(--fill-1)] px-3.5 py-2.5 text-[12.5px] text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            {fin.outside.count} expense{fin.outside.count === 1 ? "" : "s"} totalling{" "}
            <span className="font-semibold text-foreground">{money(fin.outside.amount)}</span> fall
            outside this period and aren't counted above. Widen the range to include them.
          </span>
        </div>
      )}

      {/* ---- The P&L headline ---- */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          index={0}
          label="Revenue"
          value={money(t.revenue)}
          hint={`${t.jobs} completed · ${money(t.avgTicket)} avg`}
          icon={Wallet}
        />
        <StatTile
          index={1}
          label="Gross profit"
          value={money(t.grossProfit)}
          hint={t.grossMargin === null ? "no revenue yet" : `${t.grossMargin}% margin · after ${money(t.cogs)} COGS`}
          icon={TrendingUp}
          accent
        />
        <StatTile
          index={2}
          label="Net profit"
          value={money(t.netProfit)}
          hint={t.netMargin === null ? "no revenue yet" : `${t.netMargin}% margin · after ${money(t.operating)} operating`}
          icon={Coins}
        />
        <StatTile
          index={3}
          label="Total spend"
          value={money(t.totalSpend)}
          hint={`${t.expenseCount} expense${t.expenseCount === 1 ? "" : "s"} logged`}
          icon={TrendingDown}
        />
      </div>

      {/* ---- Waterfall: how revenue becomes profit ---- */}
      <GlassCard index={4} className="mt-5 p-6">
        <p className="text-[15px] font-semibold tracking-tight text-foreground">
          Where the money goes
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Revenue, less each cost in turn. Equipment sits outside net profit so one big purchase
          doesn't distort the month.
        </p>

        {t.revenue === 0 && t.totalSpend === 0 ? (
          <p className="mt-6 text-[13px] text-muted-foreground">
            Nothing to show yet. Complete a job or log an expense and this fills in.
          </p>
        ) : (
          <div className="mt-6 space-y-3">
            <Waterfall label="Revenue" amount={t.revenue} total={Math.max(t.revenue, 1)} tone="revenue" />
            <Waterfall label="− Cost of goods" amount={t.cogs} total={Math.max(t.revenue, 1)} tone="cogs" />
            <Waterfall label="= Gross profit" amount={t.grossProfit} total={Math.max(t.revenue, 1)} tone="gross" emphasis />
            <Waterfall label="− Operating" amount={t.operating} total={Math.max(t.revenue, 1)} tone="operating" />
            <Waterfall label="= Net profit" amount={t.netProfit} total={Math.max(t.revenue, 1)} tone="net" emphasis />
            {t.equipment > 0 && (
              <Waterfall label="Equipment (separate)" amount={t.equipment} total={Math.max(t.revenue, 1)} tone="equipment" />
            )}
          </div>
        )}
      </GlassCard>

      {/* ---- Monthly revenue vs cost ---- */}
      <GlassCard index={5} className="mt-5 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[15px] font-semibold tracking-tight text-foreground">
              Revenue vs spend
            </p>
            <p className="text-xs text-muted-foreground">
              Hover a {unit === "week" ? "week" : "month"} for the breakdown
            </p>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
            <Legend color="var(--gradient-brand)" gradient label="Revenue" />
            <Legend color="rgb(251 191 36 / 0.75)" label="COGS" />
            <Legend color="rgb(56 189 248 / 0.7)" label="Operating" />
          </div>
        </div>

        {/* items-stretch so each column gets the container's full height —
            with items-end the columns size to content and every bar
            collapses to a sliver. */}
        <div className="mt-8 flex h-56 items-stretch gap-2">
          {fin.months.map((m, i) => {
            const spend = m.cogs + m.operating + m.equipment;
            return (
              <div key={m.key} className="group relative flex flex-1 flex-col items-center gap-2">
                <div className="relative flex w-full flex-1 items-end gap-[3px]">
                  <motion.div
                    initial={{ height: 0 }}
                    animate={{ height: `${(m.revenue / peak) * 100}%` }}
                    transition={{ delay: 0.05 + i * 0.03, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                    className="w-1/2 rounded-t-md"
                    style={{
                      backgroundImage: "var(--gradient-brand)",
                      minHeight: m.revenue > 0 ? 4 : 2,
                      opacity: m.revenue > 0 ? 1 : 0.2,
                    }}
                  />
                  <motion.div
                    initial={{ height: 0 }}
                    animate={{ height: `${(spend / peak) * 100}%` }}
                    transition={{ delay: 0.08 + i * 0.03, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                    className="relative w-1/2 overflow-hidden rounded-t-md bg-sky-400/70"
                    style={{ minHeight: spend > 0 ? 4 : 2, opacity: spend > 0 ? 1 : 0.2 }}
                  >
                    {spend > 0 && (
                      <div
                        className="absolute inset-x-0 bottom-0 bg-amber-400/75"
                        style={{ height: `${(m.cogs / spend) * 100}%` }}
                      />
                    )}
                  </motion.div>

                  <div className="pointer-events-none absolute -top-1 left-1/2 z-10 hidden -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg border border-[var(--line-3)] bg-[var(--card)] px-2.5 py-2 text-[11px] shadow-lg group-hover:block">
                    <p className="font-semibold text-foreground">
                      {unit === "week" ? `Week of ${m.label}` : m.label} · {m.jobs} job
                      {m.jobs === 1 ? "" : "s"}
                    </p>
                    <p className="mt-1 text-muted-foreground">Revenue {money(m.revenue)}</p>
                    <p className="text-muted-foreground">COGS {money(m.cogs)}</p>
                    <p className="text-muted-foreground">Operating {money(m.operating)}</p>
                    <p
                      className={`mt-1 font-semibold ${m.net >= 0 ? "text-emerald-300" : "text-destructive"}`}
                    >
                      Net {money(m.net)}
                    </p>
                  </div>
                </div>
                <span className="text-[10px] font-medium text-muted-foreground">{m.label}</span>
              </div>
            );
          })}
        </div>
      </GlassCard>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        {/* ---- Spend by category ---- */}
        <GlassCard index={6} className="p-6">
          <p className="text-[15px] font-semibold tracking-tight text-foreground">
            Spend by category
          </p>
          {fin.byCategory.length === 0 ? (
            <p className="mt-4 text-[13px] text-muted-foreground">
              No expenses logged yet. Add one and this breaks down where the money goes.
            </p>
          ) : (
            <div className="mt-5 space-y-3.5">
              {fin.byCategory.map((c, i) => (
                <div key={c.category}>
                  <div className="mb-1.5 flex items-baseline justify-between gap-2">
                    <span className="flex items-center gap-2 text-[13px] font-medium text-foreground">
                      {c.category}
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${TYPE_STYLE[c.type] ?? ""}`}
                      >
                        {TYPE_LABEL[c.type] ?? c.type}
                      </span>
                    </span>
                    <span className="tnum text-[12px] text-muted-foreground">
                      {money(c.amount)} · {c.share}%
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-[var(--fill-2)]">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${c.share}%` }}
                      transition={{ delay: 0.1 + i * 0.05, duration: 0.6 }}
                      className="h-full rounded-full"
                      style={{ backgroundImage: "var(--gradient-brand)" }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          {fin.topVendors.length > 0 && (
            <>
              <p className="mt-7 text-[15px] font-semibold tracking-tight text-foreground">
                Top suppliers
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {fin.topVendors.map((v) => (
                  <span
                    key={v.vendor}
                    className="rounded-lg bg-[var(--fill-2)] px-2.5 py-1.5 text-[12px] text-foreground ring-1 ring-inset ring-[var(--line-2)]"
                  >
                    {v.vendor}
                    <span className="tnum ml-1.5 font-semibold text-primary">{money(v.amount)}</span>
                  </span>
                ))}
              </div>
            </>
          )}
        </GlassCard>

        {/* ---- Per-package margin ---- */}
        <GlassCard index={7} className="p-6">
          <p className="text-[15px] font-semibold tracking-tight text-foreground">
            Profit by package
          </p>
          <p className="mt-1 flex items-start gap-1.5 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3 w-3 shrink-0" />
            {fin.hasMaterialCosts
              ? "Estimated — uses the product cost you set on each package, not recorded expenses."
              : "Set a product cost per package in Services to see margins here."}
          </p>

          {fin.byService.length === 0 ? (
            <p className="mt-4 text-[13px] text-muted-foreground">No completed jobs yet.</p>
          ) : (
            <div className="mt-5 space-y-2">
              {fin.byService.map((s) => (
                <div
                  key={s.title}
                  className="rounded-xl border border-[var(--line-1)] bg-[var(--fill-1)] px-3.5 py-3"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-[13px] font-semibold text-foreground">{s.title}</span>
                    <span className="tnum text-[12px] text-muted-foreground">
                      {s.jobs} job{s.jobs === 1 ? "" : "s"} · {money(s.avgTicket)} avg
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[12px]">
                    <span className="tnum text-muted-foreground">
                      Revenue <span className="font-semibold text-foreground">{money(s.revenue)}</span>
                    </span>
                    {s.materialCost > 0 && (
                      <>
                        <span className="tnum text-muted-foreground">
                          Cost <span className="font-semibold text-foreground">{money(s.estCost)}</span>
                        </span>
                        <span className="tnum text-emerald-300">
                          Profit <span className="font-semibold">{money(s.estProfit)}</span>
                          {s.estMargin !== null && ` (${s.estMargin}%)`}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="mt-6 grid grid-cols-3 gap-3 border-t border-[var(--line-2)] pt-5">
            <Mini icon={Landmark} label="Outstanding" value={money(t.outstanding)} />
            <Mini icon={Boxes} label="Stock value" value={money(t.stockValue)} />
            <Mini icon={Wrench} label="Equipment" value={money(t.equipment)} />
          </div>
        </GlassCard>
      </div>

      {fin.lowStock.length > 0 && (
        <GlassCard index={8} className="mt-5 p-5">
          <p className="flex items-center gap-2 text-[13px] font-semibold text-amber-300">
            <AlertTriangle className="h-4 w-4" /> Running low
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {fin.lowStock.map((a) => (
              <span
                key={a.id}
                className="rounded-lg bg-amber-400/10 px-2.5 py-1.5 text-[12px] text-amber-200 ring-1 ring-inset ring-amber-400/25"
              >
                {a.name}
                <span className="tnum ml-1.5 font-semibold">
                  {a.quantity} {a.unit}
                </span>
              </span>
            ))}
          </div>
        </GlassCard>
      )}

      {/* ---- Expense ledger ---- */}
      <GlassCard index={9} className="mt-5 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[15px] font-semibold tracking-tight text-foreground">
            Expenses
            <span className="ml-2 text-[12px] font-normal text-muted-foreground">
              {exp.expenses.length} record{exp.expenses.length === 1 ? "" : "s"} · {money(exp.total)}
            </span>
          </p>
          <Button size="sm" onClick={() => setDraft(blankDraft(exp.categories))}>
            <Plus className="h-3.5 w-3.5" /> Add
          </Button>
        </div>

        {exp.expenses.length === 0 ? (
          <p className="mt-5 text-[13px] text-muted-foreground">
            Nothing logged yet. Add what you spend on chemicals, pads, fuel and insurance and the
            profit figures above become real.
          </p>
        ) : (
          <div className="mt-4 space-y-1.5">
            <AnimatePresence initial={false}>
              {exp.expenses.map((e, i) => (
                <motion.div
                  key={e.id}
                  layout
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0, transition: { delay: Math.min(i * 0.02, 0.2) } }}
                  exit={{ opacity: 0, scale: 0.99 }}
                  className="group flex flex-wrap items-center gap-3 rounded-xl border border-[var(--line-1)] bg-[var(--fill-1)] px-3.5 py-2.5"
                >
                  <span className="tnum w-[86px] shrink-0 text-[11.5px] text-muted-foreground">
                    {prettyDate(e.date)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
                    {e.description}
                    {e.assetName && (
                      <span className="ml-1.5 text-[11px] text-muted-foreground">
                        · {e.assetName}
                      </span>
                    )}
                  </span>
                  <span className="text-[11.5px] text-muted-foreground">{e.category}</span>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${TYPE_STYLE[e.type] ?? ""}`}
                  >
                    {TYPE_LABEL[e.type] ?? e.type}
                  </span>
                  <span className="tnum text-[13px] font-bold text-foreground">
                    {money(e.amount)}
                  </span>
                  <button
                    type="button"
                    onClick={() => del(e.id)}
                    aria-label={`Delete ${e.description}`}
                    className="rounded-md p-1.5 text-muted-foreground opacity-0 transition hover:bg-destructive/15 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </GlassCard>

      {/* ---- Add / edit expense ---- */}
      <EditorModal
        open={!!draft}
        onClose={() => setDraft(null)}
        title={draft?.id ? "Edit expense" : "Add an expense"}
        footer={
          <>
            <Button onClick={() => setDraft(null)}>Cancel</Button>
            <Button variant="primary" loading={saving} onClick={save}>
              Save expense
            </Button>
          </>
        }
      >
        {draft && (
          <>
            <FieldRow>
              <Field label="Date">
                <input
                  type="date"
                  className={inputCls}
                  value={draft.date}
                  onChange={(e) => setDraft({ ...draft, date: e.target.value })}
                />
              </Field>
              <Field label="Amount" hint={derivedAmount !== null ? "Calculated from qty × unit cost" : undefined}>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  className={inputCls}
                  value={derivedAmount !== null ? derivedAmount : (draft.amount || "")}
                  disabled={derivedAmount !== null}
                  onChange={(e) => setDraft({ ...draft, amount: Number(e.target.value) })}
                />
              </Field>
            </FieldRow>

            <Field label="Description">
              <input
                className={inputCls}
                value={draft.description}
                maxLength={200}
                placeholder="Ceramic sealant, 5L"
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              />
            </Field>

            <FieldRow>
              <Field label="Category">
                <select
                  className={inputCls}
                  value={draft.category}
                  onChange={(e) => setDraft({ ...draft, category: e.target.value })}
                >
                  {exp.categories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label="Counts as"
                hint={
                  draft.type === "cogs"
                    ? "Subtracted to get gross profit"
                    : draft.type === "operating"
                      ? "Subtracted after gross, to get net"
                      : "Kept out of net profit"
                }
              >
                <select
                  className={inputCls}
                  value={draft.type}
                  onChange={(e) => setDraft({ ...draft, type: e.target.value as Draft["type"] })}
                >
                  <option value="cogs">Cost of goods (supplies used on jobs)</option>
                  <option value="operating">Operating cost (running the business)</option>
                  <option value="equipment">Equipment (durable purchase)</option>
                </select>
              </Field>
            </FieldRow>

            <FieldRow>
              <Field label="Quantity" hint="Optional">
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  className={inputCls}
                  value={draft.quantity}
                  onChange={(e) => setDraft({ ...draft, quantity: e.target.value })}
                />
              </Field>
              <Field label="Unit cost" hint="Optional">
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  className={inputCls}
                  value={draft.unitCost}
                  onChange={(e) => setDraft({ ...draft, unitCost: e.target.value })}
                />
              </Field>
            </FieldRow>

            <FieldRow>
              <Field label="Supplier" hint="Optional">
                <input
                  className={inputCls}
                  value={draft.vendor}
                  maxLength={80}
                  onChange={(e) => setDraft({ ...draft, vendor: e.target.value })}
                />
              </Field>
              <Field label="Paid with" hint="Optional">
                <input
                  className={inputCls}
                  value={draft.paymentMethod}
                  maxLength={40}
                  placeholder="Card, cash, e-transfer"
                  onChange={(e) => setDraft({ ...draft, paymentMethod: e.target.value })}
                />
              </Field>
            </FieldRow>

            {exp.assets.length > 0 && (
              <Field label="Link to an inventory item" hint="Optional — lets you add the stock at the same time">
                <select
                  className={inputCls}
                  value={draft.assetId}
                  onChange={(e) => setDraft({ ...draft, assetId: e.target.value })}
                >
                  <option value="">Not linked</option>
                  {exp.assets.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.kind})
                    </option>
                  ))}
                </select>
              </Field>
            )}

            {draft.assetId && (
              <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-[var(--line-2)] bg-[var(--fill-1)] px-3.5 py-3">
                <input
                  type="checkbox"
                  checked={draft.restock}
                  onChange={(e) => setDraft({ ...draft, restock: e.target.checked })}
                  className="mt-0.5 h-4 w-4 accent-[var(--primary)]"
                />
                <span className="text-[12.5px] text-foreground">
                  Add {draft.quantity || "0"} to stock
                  <span className="block text-[11px] text-muted-foreground">
                    Raises the item's quantity by the amount above.
                  </span>
                </span>
              </label>
            )}
          </>
        )}
      </EditorModal>
    </>
  );
}

function Waterfall({
  label,
  amount,
  total,
  tone,
  emphasis = false,
}: {
  label: string;
  amount: number;
  total: number;
  tone: string;
  emphasis?: boolean;
}) {
  const tones: Record<string, string> = {
    revenue: "var(--gradient-brand)",
    cogs: "linear-gradient(90deg, rgb(251 191 36 / 0.85), rgb(251 191 36 / 0.55))",
    gross: "linear-gradient(90deg, rgb(52 211 153 / 0.9), rgb(52 211 153 / 0.5))",
    operating: "linear-gradient(90deg, rgb(56 189 248 / 0.85), rgb(56 189 248 / 0.5))",
    net: "linear-gradient(90deg, rgb(52 211 153 / 0.95), rgb(45 212 191 / 0.6))",
    equipment: "linear-gradient(90deg, rgb(167 139 250 / 0.85), rgb(167 139 250 / 0.5))",
  };
  const width = Math.min(100, Math.abs(amount / total) * 100);
  const negative = amount < 0;

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span
          className={`text-[13px] ${emphasis ? "font-bold text-foreground" : "font-medium text-muted-foreground"}`}
        >
          {label}
        </span>
        <span
          className={`tnum text-[13px] font-bold ${
            negative ? "text-destructive" : emphasis ? "text-emerald-300" : "text-foreground"
          }`}
        >
          {money(amount)}
        </span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-[var(--fill-2)]">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${width}%` }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="h-full rounded-full"
          style={{ backgroundImage: negative ? "linear-gradient(90deg, rgb(248 113 113 / 0.9), rgb(248 113 113 / 0.5))" : tones[tone] }}
        />
      </div>
    </div>
  );
}

function Legend({ color, label, gradient = false }: { color: string; label: string; gradient?: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className="h-2 w-2 rounded-sm"
        style={gradient ? { backgroundImage: color } : { backgroundColor: color }}
      />
      {label}
    </span>
  );
}

function Mini({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div>
      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Icon className="h-3 w-3" />
        {label}
      </p>
      <p className="tnum mt-0.5 text-[16px] font-bold text-foreground">{value}</p>
    </div>
  );
}
