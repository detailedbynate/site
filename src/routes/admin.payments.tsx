import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  BanknoteArrowUp,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  ExternalLink,
  HandCoins,
  Link as LinkIcon,
  RotateCcw,
  Wallet,
} from "lucide-react";

import { listOrders, recordPayment } from "@/lib/api/admin.functions";
import { createBookingPaymentLink } from "@/lib/api/finance.functions";
import { EditorModal, FieldRow } from "@/components/admin/EditorModal";
import { TabBar } from "@/components/admin/TabBar";
import {
  Button,
  EmptyState,
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

export const Route = createFileRoute("/admin/payments")({
  component: Payments,
});

type Data = Awaited<ReturnType<typeof listOrders>>;
type Order = Data["orders"][number];

const FILTERS = ["outstanding", "paid", "refunded", "all"] as const;
type Filter = (typeof FILTERS)[number];

const FILTER_LABEL: Record<Filter, string> = {
  outstanding: "Owed",
  paid: "Paid",
  refunded: "Refunded",
  all: "Everything",
};

const STATUS_STYLE: Record<string, string> = {
  paid: "bg-emerald-400/12 text-emerald-300 ring-emerald-400/25",
  partial: "bg-amber-400/12 text-amber-300 ring-amber-400/25",
  unpaid: "bg-[var(--fill-2)] text-muted-foreground ring-[var(--line-2)]",
  refunded: "bg-violet-400/12 text-violet-300 ring-violet-400/25",
};

const METHODS = ["Cash", "E-transfer", "Card", "Cheque", "Other"];

function Payments() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("outstanding");
  const [taking, setTaking] = useState<Order | null>(null);
  const [form, setForm] = useState({ amount: "", method: "Cash", tip: "" });
  const [saving, setSaving] = useState(false);
  const [linking, setLinking] = useState<string | null>(null);
  const [link, setLink] = useState<{ reference: string; url: string } | null>(null);

  /** Create a hosted Stripe link for the outstanding balance. */
  const makeLink = async (o: Order) => {
    setLinking(o.id);
    setError(null);
    try {
      const res = await createBookingPaymentLink({ data: { bookingId: o.id } });
      setLink({ reference: o.reference, url: res.url });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Couldn't create a payment link. Check Stripe under Integrations.",
      );
    } finally {
      setLinking(null);
    }
  };

  const load = useCallback(async () => {
    try {
      setData(await listOrders());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const flash = (m: string) => {
    setOk(m);
    setTimeout(() => setOk(null), 2600);
  };

  const shown = useMemo(() => {
    if (!data) return [];
    const live = data.orders.filter((o) => o.status !== "cancelled");
    if (filter === "all") return data.orders;
    if (filter === "paid") return live.filter((o) => o.paymentStatus === "paid");
    if (filter === "refunded") return data.orders.filter((o) => o.paymentStatus === "refunded");
    return live.filter((o) => o.paymentStatus !== "paid" && o.paymentStatus !== "refunded");
  }, [data, filter]);

  const openTake = (o: Order) => {
    setTaking(o);
    setForm({ amount: String(o.balance || o.grandTotal), method: o.paymentMethod || "Cash", tip: "" });
    setError(null);
  };

  const take = async () => {
    if (!taking) return;
    const amount = Number(form.amount);
    const tip = form.tip ? Number(form.tip) : undefined;
    if (!Number.isFinite(amount) || amount < 0) return setError("Enter a valid amount.");

    setSaving(true);
    setError(null);
    try {
      const alreadyPaid = taking.amountPaid ?? 0;
      const nowPaid = alreadyPaid + amount;
      // The tip raises the grand total, so decide paid/partial against the
      // total this payment is actually settling.
      const target = taking.grandTotal + (tip ?? 0);

      await recordPayment({
        data: {
          bookingId: taking.id,
          amountPaid: nowPaid,
          tip: tip !== undefined ? (taking.tip ?? 0) + tip : undefined,
          paymentMethod: form.method,
          paymentStatus: nowPaid >= target - 0.005 ? "paid" : nowPaid > 0 ? "partial" : "unpaid",
        },
      });
      setTaking(null);
      flash(`Recorded ${money(amount)}${tip ? ` + ${money(tip)} tip` : ""}.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record it.");
    } finally {
      setSaving(false);
    }
  };

  const markRefunded = async (o: Order) => {
    if (!confirm(`Mark ${o.reference} as refunded? This does not move any real money.`)) return;
    try {
      await recordPayment({ data: { bookingId: o.id, paymentStatus: "refunded" } });
      flash("Marked refunded.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update it.");
    }
  };

  if (error && !data) return <ErrorNote>{error}</ErrorNote>;
  if (!data) return <Spinner label="Loading payments…" />;

  const t = data.totals;
  const overdueCount = data.orders.filter(
    (o) => o.status === "completed" && o.paymentStatus !== "paid" && o.paymentStatus !== "refunded",
  ).length;

  return (
    <>
      <PageHeader
        title="Payments"
        subtitle="What you've collected and what's still owed. Recording a payment here updates the job, the Orders invoice and the Finance totals together."
      />

      <AnimatePresence>{ok && <SuccessNote>{ok}</SuccessNote>}</AnimatePresence>
      {error && (
        <div className="mb-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile index={0} label="Collected" value={money(t.collected)} hint="fully paid jobs" icon={Wallet} accent />
        <StatTile index={1} label="Outstanding" value={money(t.outstanding)} hint="still to come in" icon={Clock3} />
        <StatTile index={2} label="Tips" value={money(t.tips)} hint="on top of job totals" icon={HandCoins} />
        <StatTile
          index={3}
          label="Done but unpaid"
          value={overdueCount}
          hint={overdueCount ? "worth chasing" : "nothing outstanding"}
          icon={CircleDollarSign}
        />
      </div>

      <div className="mt-6">
        <TabBar
          layoutId="payments-filter"
          value={filter}
          onChange={setFilter}
          tabs={FILTERS.map((f) => ({ value: f, label: FILTER_LABEL[f] }))}
        />
      </div>

      {shown.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            icon={CheckCircle2}
            title={filter === "outstanding" ? "Nothing outstanding" : "Nothing here"}
            body={
              filter === "outstanding"
                ? "Every job that isn't cancelled has been paid in full. Good place to be."
                : "No jobs match this filter yet."
            }
          />
        </div>
      ) : (
        <div className="mt-4 space-y-1.5">
          <AnimatePresence initial={false}>
            {shown.map((o, i) => (
              <motion.div
                key={o.id}
                layout
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0, transition: { delay: Math.min(i * 0.025, 0.25) } }}
                exit={{ opacity: 0, scale: 0.99 }}
                className={`flex flex-wrap items-center gap-3 rounded-xl border border-[var(--line-1)] bg-[var(--fill-1)] px-4 py-3.5 ${
                  o.status === "cancelled" ? "opacity-55" : ""
                }`}
              >
                <span className="rounded-md bg-[var(--fill-2)] px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                  {o.reference}
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
                  {o.client?.name ?? "Unknown"}
                  <span className="ml-1.5 text-[11.5px] text-muted-foreground">
                    · {o.serviceTitle}
                  </span>
                </span>
                <span className="text-[11.5px] text-muted-foreground">{prettyDate(o.date)}</span>

                <span
                  className={`rounded-md px-2 py-1 text-[10.5px] font-semibold capitalize ring-1 ring-inset ${
                    STATUS_STYLE[o.paymentStatus] ?? STATUS_STYLE.unpaid
                  }`}
                >
                  {o.paymentStatus}
                </span>

                <div className="w-24 text-right">
                  <p className="tnum text-[13px] font-bold text-foreground">{money(o.grandTotal)}</p>
                  {o.balance > 0 && o.paymentStatus !== "refunded" && (
                    <p className="tnum text-[11px] text-amber-300">{money(o.balance)} owed</p>
                  )}
                </div>

                {o.status !== "cancelled" && o.paymentStatus !== "refunded" && (
                  <Button size="sm" variant={o.balance > 0 ? "primary" : "outline"} onClick={() => openTake(o)}>
                    <BanknoteArrowUp className="h-3.5 w-3.5" />
                    {o.balance > 0 ? "Take payment" : "Adjust"}
                  </Button>
                )}
                {o.status !== "cancelled" && o.balance > 0 && o.paymentStatus !== "refunded" && (
                  <button
                    type="button"
                    onClick={() => makeLink(o)}
                    disabled={linking === o.id}
                    aria-label={`Create a card payment link for ${o.reference}`}
                    title="Create a Stripe payment link"
                    className="rounded-md p-1.5 text-muted-foreground transition hover:bg-[var(--fill-3)] hover:text-foreground disabled:opacity-40"
                  >
                    <LinkIcon className="h-3.5 w-3.5" />
                  </button>
                )}
                {o.paymentStatus === "paid" && (
                  <button
                    type="button"
                    onClick={() => markRefunded(o)}
                    aria-label={`Mark ${o.reference} refunded`}
                    className="rounded-md p-1.5 text-muted-foreground transition hover:bg-[var(--fill-3)] hover:text-foreground"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </button>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      <GlassCard index={5} className="mt-5 p-5">
        <p className="text-[13.5px] font-semibold text-foreground">Taking money online</p>
        <p className="mt-1 max-w-3xl text-[12px] text-muted-foreground">
          Everything here is a record of payments you collect yourself — cash, e-transfer, or a card
          reader. The site does not charge cards or hold deposits, and nothing on this page moves
          real money. Card payments and deposits at booking time would need a Stripe or Square
          account wired in; ask and it can be added.
        </p>
      </GlassCard>

      {/* Payment link result. Shown rather than auto-copied so it's obvious
          what's being sent to the customer. */}
      <EditorModal
        open={!!link}
        onClose={() => setLink(null)}
        title={`Payment link for ${link?.reference ?? ""}`}
        footer={<Button onClick={() => setLink(null)}>Done</Button>}
      >
        {link && (
          <>
            <p className="text-[12.5px] text-muted-foreground">
              Send this to the customer. Stripe hosts the page and takes the card — nothing
              sensitive touches this site. Mark the job paid here once the money lands.
            </p>
            <div className="flex gap-2">
              <input readOnly value={link.url} className={inputCls} onFocus={(e) => e.target.select()} />
              <Button
                onClick={() => {
                  void navigator.clipboard?.writeText(link.url);
                  flash("Link copied.");
                }}
              >
                Copy
              </Button>
            </div>
            <a
              href={link.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-primary hover:underline"
            >
              Open it yourself <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </>
        )}
      </EditorModal>

      <EditorModal
        open={!!taking}
        onClose={() => setTaking(null)}
        title={`Payment for ${taking?.reference ?? ""}`}
        footer={
          <>
            <Button onClick={() => setTaking(null)}>Cancel</Button>
            <Button variant="primary" loading={saving} onClick={take}>
              Record payment
            </Button>
          </>
        }
      >
        {taking && (
          <>
            <div className="rounded-lg border border-[var(--line-2)] bg-[var(--fill-1)] px-3.5 py-3 text-[12.5px]">
              <Row label="Job total" value={money(taking.grandTotal)} />
              {taking.amountPaid > 0 && <Row label="Already paid" value={money(taking.amountPaid)} />}
              <Row label="Outstanding" value={money(taking.balance)} strong />
            </div>

            <FieldRow>
              <Field label="Amount received">
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  className={inputCls}
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                />
              </Field>
              <Field label="Method">
                <select
                  className={inputCls}
                  value={form.method}
                  onChange={(e) => setForm({ ...form, method: e.target.value })}
                >
                  {METHODS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </Field>
            </FieldRow>

            <Field label="Tip" hint="Optional — added on top of the job total">
              <input
                type="number"
                min={0}
                step="0.01"
                className={inputCls}
                value={form.tip}
                onChange={(e) => setForm({ ...form, tip: e.target.value })}
              />
            </Field>
          </>
        )}
      </EditorModal>
    </>
  );
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between py-0.5">
      <span className="text-muted-foreground">{label}</span>
      <span className={`tnum ${strong ? "font-bold text-foreground" : "text-foreground"}`}>{value}</span>
    </div>
  );
}
