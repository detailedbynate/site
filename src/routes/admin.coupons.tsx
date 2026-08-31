import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Pencil, Plus, Tag, Trash2, X } from "lucide-react";

import { listAdminCoupons, removeCoupon, saveCoupon } from "@/lib/api/admin.functions";
import {
  Button,
  EmptyState,
  ErrorNote,
  Field,
  PageHeader,
  Spinner,
  StatusPill,
  Td,
  Th,
  TableWrap,
  inputCls,
} from "@/components/admin/ui";

export const Route = createFileRoute("/admin/coupons")({
  component: Coupons,
});

type Row = Awaited<ReturnType<typeof listAdminCoupons>>["coupons"][number];
type Draft = {
  id?: string;
  code: string;
  type: "percent" | "fixed";
  value: number;
  active: boolean;
  maxUses?: number;
  expiresAt?: string;
};

const blank: Draft = { code: "", type: "percent", value: 10, active: true };

function Coupons() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const res = await listAdminCoupons();
      setRows(res.coupons);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load coupons.");
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      await saveCoupon({
        data: {
          id: draft.id,
          code: draft.code.trim(),
          type: draft.type,
          value: draft.value,
          active: draft.active,
          maxUses: draft.maxUses || undefined,
          expiresAt: draft.expiresAt || undefined,
        },
      });
      setDraft(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  };

  if (!rows && !error) return <Spinner label="Loading coupons…" />;

  return (
    <>
      <PageHeader
        title="Coupons"
        subtitle="Discount codes you can hand out. Create them here — the redemption field on the booking form is still to come."
        actions={
          <Button variant="primary" onClick={() => setDraft({ ...blank })}>
            <Plus className="h-4 w-4" /> New coupon
          </Button>
        }
      />

      <AnimatePresence>{error && <ErrorNote>{error}</ErrorNote>}</AnimatePresence>

      {!rows?.length ? (
        <div className="mt-5">
          <EmptyState
            icon={Tag}
            title="No coupons yet"
            body="Create a code like SPRING20 and share it with customers."
            action={
              <Button variant="primary" onClick={() => setDraft({ ...blank })}>
                <Plus className="h-4 w-4" /> New coupon
              </Button>
            }
          />
        </div>
      ) : (
        <TableWrap>
          <table className="w-full min-w-[640px] border-collapse">
            <thead className="border-b border-border">
              <tr>
                <Th>Code</Th>
                <Th>Discount</Th>
                <Th className="text-right">Used</Th>
                <Th>Expires</Th>
                <Th>Status</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              <AnimatePresence initial={false}>
                {rows.map((c, i) => (
                  <motion.tr
                    key={c.id}
                    layout
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0, transition: { delay: Math.min(i * 0.04, 0.3) } }}
                    exit={{ opacity: 0 }}
                    className="border-b border-border/60 hover:bg-secondary/30"
                  >
                    <Td className="font-mono font-semibold text-foreground">{c.code}</Td>
                    <Td>{c.type === "percent" ? `${c.value}% off` : `$${c.value} off`}</Td>
                    <Td className="text-right text-muted-foreground">
                      {c.timesUsed}
                      {c.maxUses ? ` / ${c.maxUses}` : ""}
                    </Td>
                    <Td className="text-xs text-muted-foreground">
                      {c.expiresAt ? new Date(c.expiresAt).toLocaleDateString() : "Never"}
                    </Td>
                    <Td>
                      <StatusPill status={c.active ? "active" : "inactive"} />
                    </Td>
                    <Td className="text-right">
                      <div className="flex justify-end gap-1.5">
                        <Button
                          size="sm"
                          onClick={() =>
                            setDraft({
                              id: c.id,
                              code: c.code,
                              type: c.type,
                              value: c.value,
                              active: c.active,
                              maxUses: c.maxUses,
                              expiresAt: c.expiresAt?.slice(0, 10),
                            })
                          }
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={async () => {
                            if (!confirm(`Delete ${c.code}?`)) return;
                            await removeCoupon({ data: { id: c.id } });
                            await load();
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </Td>
                  </motion.tr>
                ))}
              </AnimatePresence>
            </tbody>
          </table>
        </TableWrap>
      )}

      <AnimatePresence>
        {draft && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setDraft(null)}
            className="admin-theme fixed inset-0 z-[60] flex items-center justify-center p-4"
            style={{ backgroundColor: "rgb(0 0 0 / 0.6)", backdropFilter: "blur(3px)" }}
          >
            <motion.div
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.97, y: 10 }}
              transition={{ type: "spring", stiffness: 240, damping: 26 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md rounded-2xl border border-white/[0.08] bg-[var(--card)] p-6"
            >
              <div className="flex items-start justify-between">
                <h2 className="text-lg font-bold tracking-tight text-foreground">
                  {draft.id ? "Edit coupon" : "New coupon"}
                </h2>
                <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <div className="mt-5 space-y-4">
                <Field label="Code" hint="Letters, numbers, - and _ only.">
                  <input
                    className={`${inputCls} font-mono uppercase`}
                    value={draft.code}
                    maxLength={24}
                    onChange={(e) => setDraft({ ...draft, code: e.target.value.toUpperCase() })}
                    placeholder="SPRING20"
                  />
                </Field>

                <div className="grid grid-cols-2 gap-4">
                  <Field label="Type">
                    <select
                      className={inputCls}
                      value={draft.type}
                      onChange={(e) =>
                        setDraft({ ...draft, type: e.target.value as "percent" | "fixed" })
                      }
                    >
                      <option value="percent">Percent off</option>
                      <option value="fixed">Fixed $ off</option>
                    </select>
                  </Field>
                  <Field label={draft.type === "percent" ? "Percent (%)" : "Amount ($)"}>
                    <input
                      className={inputCls}
                      type="number"
                      min={1}
                      max={draft.type === "percent" ? 100 : 10000}
                      value={draft.value}
                      onChange={(e) => setDraft({ ...draft, value: Number(e.target.value) })}
                    />
                  </Field>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <Field label="Max uses" hint="Blank = unlimited.">
                    <input
                      className={inputCls}
                      type="number"
                      min={1}
                      value={draft.maxUses ?? ""}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          maxUses: e.target.value ? Number(e.target.value) : undefined,
                        })
                      }
                    />
                  </Field>
                  <Field label="Expires" hint="Blank = never.">
                    <input
                      className={inputCls}
                      type="date"
                      value={draft.expiresAt ?? ""}
                      onChange={(e) =>
                        setDraft({ ...draft, expiresAt: e.target.value || undefined })
                      }
                    />
                  </Field>
                </div>

                <label className="flex items-center gap-2.5 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={draft.active}
                    onChange={(e) => setDraft({ ...draft, active: e.target.checked })}
                    className="h-4 w-4 rounded border-border accent-[var(--primary)]"
                  />
                  Active
                </label>
              </div>

              <div className="mt-6 flex justify-end gap-2">
                <Button onClick={() => setDraft(null)}>Cancel</Button>
                <Button variant="primary" loading={busy} onClick={save}>
                  Save
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
