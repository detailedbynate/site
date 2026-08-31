import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence } from "motion/react";
import { Banknote, Receipt, Search, Wallet } from "lucide-react";

import { listOrders, recordPayment } from "@/lib/api/admin.functions";
import {
  Avatar,
  Button,
  DetailField,
  DetailGroup,
  DetailPanel,
  EmptyState,
  ErrorNote,
  Field,
  ListRow,
  PageHeader,
  Spinner,
  StatTile,
  StatusPill,
  inputCls,
  money,
  prettyDate,
} from "@/components/admin/ui";

export const Route = createFileRoute("/admin/orders")({
  component: Orders,
});

type Data = Awaited<ReturnType<typeof listOrders>>;
type Order = Data["orders"][number];
type PayStatus = "unpaid" | "partial" | "paid" | "refunded";

const payStyles: Record<PayStatus, string> = {
  paid: "bg-emerald-400/12 text-emerald-300 ring-emerald-400/25",
  partial: "bg-amber-400/12 text-amber-300 ring-amber-400/25",
  unpaid: "bg-white/[0.05] text-muted-foreground ring-white/[0.08]",
  refunded: "bg-destructive/12 text-destructive ring-destructive/25",
};

function PayPill({ status }: { status: PayStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-1 text-[11px] font-semibold capitalize ring-1 ring-inset ${payStyles[status]}`}
    >
      {status}
    </span>
  );
}

function Orders() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | PayStatus>("all");
  const [openId, setOpenId] = useState<string | null>(null);

  const load = async () => {
    try {
      setData(await listOrders());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load orders.");
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.orders ?? []).filter((o) => {
      if (filter !== "all" && o.paymentStatus !== filter) return false;
      if (!q) return true;
      return [o.reference, o.client?.name, o.serviceTitle].some((v) =>
        String(v ?? "").toLowerCase().includes(q),
      );
    });
  }, [data, query, filter]);

  const open = data?.orders.find((o) => o.id === openId) ?? null;

  if (!data && !error) return <Spinner label="Loading orders…" />;
  if (error) return <ErrorNote>{error}</ErrorNote>;

  return (
    <>
      <PageHeader
        title="Orders"
        subtitle="Every booking as an itemised order. Record what you were paid, and add tips here."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile
          index={0}
          label="Collected"
          value={money(data!.totals.collected)}
          hint="fully paid orders"
          icon={Wallet}
          accent
        />
        <StatTile
          index={1}
          label="Outstanding"
          value={money(data!.totals.outstanding)}
          hint="still owed"
          icon={Receipt}
        />
        <StatTile
          index={2}
          label="Tips"
          value={money(data!.totals.tips)}
          hint="on top of job totals"
          icon={Banknote}
        />
      </div>

      <div className="my-5 flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-0.5 rounded-xl bg-white/[0.04] p-1 ring-1 ring-inset ring-white/[0.06]">
          {(["all", "unpaid", "partial", "paid", "refunded"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`rounded-lg px-3 py-1.5 text-[12px] font-semibold capitalize transition-colors ${
                filter === f
                  ? "bg-white/[0.09] text-foreground ring-1 ring-inset ring-white/[0.08]"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
        <div className="relative ml-auto w-full sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            className={`${inputCls} pl-9`}
            placeholder="Search ref or customer…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title="No orders"
          body="Orders appear here as soon as bookings come in."
        />
      ) : (
        <div className="space-y-2">
          <AnimatePresence initial={false}>
            {filtered.map((o, i) => (
              <ListRow
                key={o.id}
                index={i}
                muted={o.status === "cancelled"}
                onClick={() => setOpenId(o.id)}
              >
                <Avatar name={o.client?.name ?? "?"} />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="truncate text-[14px] font-semibold text-foreground">
                      {o.client?.name ?? "—"}
                    </span>
                    <span className="rounded-md bg-white/[0.05] px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                      {o.reference}
                    </span>
                    <PayPill status={o.paymentStatus as PayStatus} />
                  </div>
                  <p className="mt-1 text-[12px] text-muted-foreground">
                    {prettyDate(o.date)} · {o.serviceTitle}
                    {o.tip > 0 && <span className="text-emerald-300"> · tip {money(o.tip)}</span>}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="tnum text-[15px] font-bold text-foreground">
                    {money(o.grandTotal)}
                  </p>
                  {o.balance > 0 && o.status !== "cancelled" && (
                    <p className="tnum text-[11px] text-amber-300">{money(o.balance)} due</p>
                  )}
                </div>
              </ListRow>
            ))}
          </AnimatePresence>
        </div>
      )}

      <OrderPanel order={open} onClose={() => setOpenId(null)} onSaved={load} />
    </>
  );
}

function OrderPanel({
  order,
  onClose,
  onSaved,
}: {
  order: Order | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [tip, setTip] = useState(0);
  const [discount, setDiscount] = useState(0);
  const [paid, setPaid] = useState(0);
  const [method, setMethod] = useState("");
  const [status, setStatus] = useState<PayStatus>("unpaid");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!order) return;
    setTip(order.tip);
    setDiscount(order.discount);
    setPaid(order.amountPaid);
    setMethod(order.paymentMethod ?? "");
    setStatus(order.paymentStatus as PayStatus);
    setErr(null);
  }, [order]);

  const newTotal = order ? order.subtotal - discount + tip : 0;

  const save = async () => {
    if (!order) return;
    setBusy(true);
    setErr(null);
    try {
      await recordPayment({
        data: {
          bookingId: order.id,
          tip,
          discount,
          amountPaid: paid,
          paymentStatus: status,
          paymentMethod: method.trim() || undefined,
        },
      });
      await onSaved();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <DetailPanel
      open={!!order}
      onClose={onClose}
      eyebrow={order ? `${order.reference} · ${prettyDate(order.date)}` : ""}
      title={order?.client?.name ?? ""}
      footer={
        order && (
          <div className="flex justify-end gap-2">
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" loading={busy} onClick={save}>
              Save payment
            </Button>
          </div>
        )
      }
    >
      {order && (
        <>
          <DetailGroup title="Line items">
            <div className="space-y-1.5 pt-1">
              {order.lines.map((l, i) => (
                <div
                  key={i}
                  className="flex items-start justify-between gap-3 rounded-lg bg-white/[0.03] px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-foreground">{l.label}</p>
                    {l.detail && (
                      <p className="text-[11.5px] text-muted-foreground">{l.detail}</p>
                    )}
                  </div>
                  <span
                    className={`tnum shrink-0 text-[13px] font-semibold ${
                      l.amount < 0 ? "text-emerald-300" : "text-foreground"
                    }`}
                  >
                    {l.amount === 0 ? "—" : money(l.amount)}
                  </span>
                </div>
              ))}
            </div>

            <div className="mt-3 flex items-baseline justify-between border-t border-white/[0.08] pt-3">
              <span className="text-[13px] font-semibold text-muted-foreground">Order total</span>
              <span className="tnum text-2xl font-bold text-primary">{money(newTotal)}</span>
            </div>
          </DetailGroup>

          <DetailGroup title="Payment">
            <div className="grid grid-cols-2 gap-3 pt-1">
              <Field label="Tip ($)" hint="Adds to revenue.">
                <input
                  className={inputCls}
                  type="number"
                  min={0}
                  value={tip}
                  onChange={(e) => setTip(Math.max(0, Number(e.target.value)))}
                />
              </Field>
              <Field label="Discount ($)">
                <input
                  className={inputCls}
                  type="number"
                  min={0}
                  value={discount}
                  onChange={(e) => setDiscount(Math.max(0, Number(e.target.value)))}
                />
              </Field>
              <Field label="Amount received ($)">
                <input
                  className={inputCls}
                  type="number"
                  min={0}
                  value={paid}
                  onChange={(e) => setPaid(Math.max(0, Number(e.target.value)))}
                />
              </Field>
              <Field label="Method">
                <input
                  className={inputCls}
                  value={method}
                  placeholder="Cash, e-transfer…"
                  onChange={(e) => setMethod(e.target.value)}
                />
              </Field>
            </div>

            <div className="mt-3">
              <Field label="Payment status">
                <div className="flex flex-wrap gap-1.5">
                  {(["unpaid", "partial", "paid", "refunded"] as PayStatus[]).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => {
                        setStatus(s);
                        // Marking paid should fill the amount for you.
                        if (s === "paid") setPaid(newTotal);
                      }}
                      className={`rounded-lg px-3 py-2 text-[12px] font-semibold capitalize ring-1 ring-inset transition ${
                        status === s
                          ? payStyles[s]
                          : "bg-white/[0.03] text-muted-foreground ring-white/[0.08] hover:bg-white/[0.07]"
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </Field>
            </div>

            {newTotal - paid > 0 && status !== "refunded" && (
              <p className="tnum mt-3 text-[12px] text-amber-300">
                Balance outstanding: {money(newTotal - paid)}
              </p>
            )}
          </DetailGroup>

          <DetailGroup title="Booking">
            <DetailField label="Service">{order.serviceTitle}</DetailField>
            <DetailField label="Status">
              <StatusPill status={order.status} />
            </DetailField>
            <DetailField label="Customer">
              {order.client?.email}
              <span className="block text-muted-foreground">{order.client?.phone}</span>
            </DetailField>
          </DetailGroup>

          <AnimatePresence>{err && <ErrorNote>{err}</ErrorNote>}</AnimatePresence>
        </>
      )}
    </DetailPanel>
  );
}
