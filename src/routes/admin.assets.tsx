import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  AlertTriangle,
  Boxes,
  Minus,
  Package,
  Plus,
  ShoppingCart,
  Trash2,
  Wrench,
} from "lucide-react";

import {
  adjustStock,
  listAdminAssets,
  removeAsset,
  restockAsset,
  saveAsset,
} from "@/lib/api/operations.functions";
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
  ToggleChip,
  inputCls,
  money,
} from "@/components/admin/ui";

export const Route = createFileRoute("/admin/assets")({
  component: Assets,
});

type Data = Awaited<ReturnType<typeof listAdminAssets>>;
type Asset = Data["assets"][number];

const uid = () =>
  globalThis.crypto?.randomUUID?.() ?? `a-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const blank = (kind: "consumable" | "equipment"): Asset => ({
  id: uid(),
  name: "",
  kind,
  category: "",
  unit: kind === "equipment" ? "unit" : "bottle",
  unitCost: 0,
  quantity: kind === "equipment" ? 1 : 0,
  reorderLevel: 0,
  supplier: undefined,
  notes: undefined,
  active: true,
  createdAt: new Date().toISOString(),
  stockValue: 0,
  spentToDate: 0,
  low: false,
});

function Assets() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [draft, setDraft] = useState<Asset | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [buying, setBuying] = useState<Asset | null>(null);
  const [buy, setBuy] = useState({ quantity: "1", unitCost: "0", vendor: "", date: new Date().toISOString().slice(0, 10) });
  const [tab, setTab] = useState<"consumable" | "equipment">("consumable");

  const load = useCallback(async () => {
    try {
      setData(await listAdminAssets());
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

  const save = async () => {
    if (!draft) return;
    if (!draft.name.trim()) return setError("Give the item a name.");
    setSaving(true);
    setError(null);
    try {
      await saveAsset({
        data: {
          id: draft.id,
          name: draft.name.trim(),
          kind: draft.kind,
          category: draft.category.trim(),
          unit: draft.unit.trim() || "each",
          unitCost: Number(draft.unitCost) || 0,
          quantity: Number(draft.quantity) || 0,
          reorderLevel: Number(draft.reorderLevel) || 0,
          supplier: draft.supplier?.trim() || undefined,
          notes: draft.notes?.trim() || undefined,
          active: draft.active,
        },
      });
      setDraft(null);
      flash(isNew ? "Item added." : "Item updated.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save it.");
    } finally {
      setSaving(false);
    }
  };

  const del = async (a: Asset) => {
    if (!confirm(`Delete ${a.name}? Past expenses for it are kept.`)) return;
    try {
      await removeAsset({ data: { id: a.id } });
      flash("Item deleted.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete it.");
    }
  };

  const nudge = async (a: Asset, delta: number) => {
    try {
      await adjustStock({ data: { id: a.id, delta } });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not adjust stock.");
    }
  };

  const doBuy = async () => {
    if (!buying) return;
    const quantity = Number(buy.quantity);
    const unitCost = Number(buy.unitCost);
    if (!Number.isFinite(quantity) || quantity <= 0) return setError("Enter a quantity above zero.");
    setSaving(true);
    setError(null);
    try {
      const res = await restockAsset({
        data: { id: buying.id, quantity, unitCost, vendor: buy.vendor.trim() || undefined, date: buy.date },
      });
      setBuying(null);
      flash(`Logged ${money(res.amount)} and added ${quantity} to stock.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record the purchase.");
    } finally {
      setSaving(false);
    }
  };

  if (error && !data) return <ErrorNote>{error}</ErrorNote>;
  if (!data) return <Spinner label="Loading inventory…" />;

  const shown = data.assets.filter((a) => a.kind === tab);

  return (
    <>
      <PageHeader
        title="Assets"
        subtitle="Equipment you own and consumables you buy. Recording a purchase here also writes it to the expense ledger, so Finance stays accurate without double entry."
        actions={
          <Button
            variant="primary"
            onClick={() => {
              setDraft(blank(tab));
              setIsNew(true);
            }}
          >
            <Plus className="h-3.5 w-3.5" /> Add {tab === "equipment" ? "equipment" : "supply"}
          </Button>
        }
      />

      <AnimatePresence>{ok && <SuccessNote>{ok}</SuccessNote>}</AnimatePresence>
      {error && (
        <div className="mb-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile index={0} label="Stock value" value={money(data.totals.stockValue)} hint="consumables on hand" icon={Boxes} accent />
        <StatTile index={1} label="Equipment" value={money(data.totals.equipmentValue)} hint={`${data.totals.equipmentCount} item${data.totals.equipmentCount === 1 ? "" : "s"}`} icon={Wrench} />
        <StatTile index={2} label="Supplies" value={data.totals.consumableCount} hint="tracked products" icon={Package} />
        <StatTile index={3} label="Low stock" value={data.totals.lowCount} hint={data.totals.lowCount ? "reorder soon" : "all good"} icon={AlertTriangle} />
      </div>

      <div className="mt-6">
        <TabBar
          layoutId="assets-kind"
          value={tab}
          onChange={setTab}
          tabs={[
            {
              value: "consumable",
              label: "Supplies",
              count: data.assets.filter((a) => a.kind === "consumable").length,
            },
            {
              value: "equipment",
              label: "Equipment",
              count: data.assets.filter((a) => a.kind === "equipment").length,
            },
          ]}
        />
      </div>

      {shown.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            icon={tab === "equipment" ? Wrench : Package}
            title={tab === "equipment" ? "No equipment yet" : "No supplies yet"}
            body={
              tab === "equipment"
                ? "Add your polisher, extractor, pressure washer — anything durable you paid for."
                : "Add the products you buy: soap, sealant, pads, towels. Track what they cost and what's left."
            }
            action={
              <Button
                variant="primary"
                onClick={() => {
                  setDraft(blank(tab));
                  setIsNew(true);
                }}
              >
                <Plus className="h-3.5 w-3.5" /> Add {tab === "equipment" ? "equipment" : "supply"}
              </Button>
            }
          />
        </div>
      ) : (
        <div className="mt-4 space-y-1.5">
          <AnimatePresence initial={false}>
            {shown.map((a, i) => (
              <motion.div
                key={a.id}
                layout
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0, transition: { delay: Math.min(i * 0.03, 0.25) } }}
                exit={{ opacity: 0, scale: 0.99 }}
                className={`group rounded-xl border bg-[var(--fill-1)] px-4 py-3.5 transition-colors ${
                  a.low ? "border-amber-400/30" : "border-[var(--line-1)]"
                } ${a.active ? "" : "opacity-55"}`}
              >
                <div className="flex flex-wrap items-center gap-3">
                  <span
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                      a.kind === "equipment" ? "bg-violet-400/12" : "bg-primary/12"
                    }`}
                  >
                    {a.kind === "equipment" ? (
                      <Wrench className="h-4 w-4 text-violet-300" />
                    ) : (
                      <Package className="h-4 w-4 text-primary" />
                    )}
                  </span>

                  <button
                    type="button"
                    onClick={() => {
                      setDraft(a);
                      setIsNew(false);
                    }}
                    className="min-w-0 flex-1 text-left"
                  >
                    <p className="truncate text-[13.5px] font-semibold text-foreground">{a.name}</p>
                    <p className="truncate text-[11.5px] text-muted-foreground">
                      {[a.category, a.supplier].filter(Boolean).join(" · ") || "No category"}
                      {a.spentToDate > 0 && ` · ${money(a.spentToDate)} spent to date`}
                    </p>
                  </button>

                  {a.low && (
                    <span className="rounded-md bg-amber-400/12 px-2 py-1 text-[10.5px] font-semibold text-amber-300 ring-1 ring-inset ring-amber-400/25">
                      Low
                    </span>
                  )}

                  {a.kind === "consumable" && (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => nudge(a, -1)}
                        aria-label={`Use one ${a.name}`}
                        className="rounded-md p-1.5 text-muted-foreground transition hover:bg-[var(--fill-3)] hover:text-foreground"
                      >
                        <Minus className="h-3.5 w-3.5" />
                      </button>
                      <span className="tnum w-16 text-center text-[13px] font-bold text-foreground">
                        {a.quantity}
                        <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                          {a.unit}
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={() => nudge(a, 1)}
                        aria-label={`Add one ${a.name}`}
                        className="rounded-md p-1.5 text-muted-foreground transition hover:bg-[var(--fill-3)] hover:text-foreground"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}

                  <span className="tnum w-20 text-right text-[13px] font-bold text-foreground">
                    {money(a.stockValue)}
                  </span>

                  <Button
                    size="sm"
                    onClick={() => {
                      setBuying(a);
                      setBuy({
                        quantity: "1",
                        unitCost: String(a.unitCost || 0),
                        vendor: a.supplier ?? "",
                        date: new Date().toISOString().slice(0, 10),
                      });
                    }}
                  >
                    <ShoppingCart className="h-3.5 w-3.5" /> Buy
                  </Button>

                  <button
                    type="button"
                    onClick={() => del(a)}
                    aria-label={`Delete ${a.name}`}
                    className="rounded-md p-1.5 text-muted-foreground opacity-0 transition hover:bg-destructive/15 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* ---- Add / edit ---- */}
      <EditorModal
        open={!!draft}
        onClose={() => setDraft(null)}
        title={isNew ? `Add ${draft?.kind === "equipment" ? "equipment" : "a supply"}` : `Edit ${draft?.name}`}
        footer={
          <>
            <Button onClick={() => setDraft(null)}>Cancel</Button>
            <Button variant="primary" loading={saving} onClick={save}>
              Save
            </Button>
          </>
        }
      >
        {draft && (
          <>
            <Field label="Name">
              <input
                className={inputCls}
                value={draft.name}
                maxLength={80}
                placeholder={draft.kind === "equipment" ? "Rupes LHR15 polisher" : "Ceramic sealant"}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </Field>

            <FieldRow>
              <Field label="Type">
                <select
                  className={inputCls}
                  value={draft.kind}
                  onChange={(e) => setDraft({ ...draft, kind: e.target.value as Asset["kind"] })}
                >
                  <option value="consumable">Consumable — gets used up</option>
                  <option value="equipment">Equipment — durable</option>
                </select>
              </Field>
              <Field label="Category" hint="Optional">
                <input
                  className={inputCls}
                  value={draft.category}
                  maxLength={60}
                  placeholder="Chemicals"
                  onChange={(e) => setDraft({ ...draft, category: e.target.value })}
                />
              </Field>
            </FieldRow>

            <FieldRow>
              <Field label="Quantity on hand">
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  className={inputCls}
                  value={draft.quantity}
                  onChange={(e) => setDraft({ ...draft, quantity: Number(e.target.value) })}
                />
              </Field>
              <Field label="Unit" hint="bottle, pad, litre…">
                <input
                  className={inputCls}
                  value={draft.unit}
                  maxLength={20}
                  onChange={(e) => setDraft({ ...draft, unit: e.target.value })}
                />
              </Field>
            </FieldRow>

            <FieldRow>
              <Field label="Cost per unit">
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  className={inputCls}
                  value={draft.unitCost}
                  onChange={(e) => setDraft({ ...draft, unitCost: Number(e.target.value) })}
                />
              </Field>
              {draft.kind === "consumable" && (
                <Field label="Warn me at" hint="0 turns the warning off">
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    className={inputCls}
                    value={draft.reorderLevel}
                    onChange={(e) => setDraft({ ...draft, reorderLevel: Number(e.target.value) })}
                  />
                </Field>
              )}
            </FieldRow>

            <Field label="Supplier" hint="Optional">
              <input
                className={inputCls}
                value={draft.supplier ?? ""}
                maxLength={80}
                onChange={(e) => setDraft({ ...draft, supplier: e.target.value })}
              />
            </Field>

            <Field label="Notes" hint="Optional">
              <textarea
                className={`${inputCls} min-h-[70px] resize-y`}
                value={draft.notes ?? ""}
                maxLength={1000}
                onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              />
            </Field>

            <div className="flex items-center justify-between rounded-lg border border-[var(--line-2)] bg-[var(--fill-1)] px-3.5 py-3">
              <span className="text-[12.5px] text-foreground">
                In use
                <span className="block text-[11px] text-muted-foreground">
                  Retired items stay in reports but drop off this list.
                </span>
              </span>
              <ToggleChip
                on={draft.active}
                labels={["Active", "Retired"]}
                onChange={(next) => setDraft({ ...draft, active: next })}
              />
            </div>
          </>
        )}
      </EditorModal>

      {/* ---- Buy more ---- */}
      <EditorModal
        open={!!buying}
        onClose={() => setBuying(null)}
        title={`Buy more ${buying?.name ?? ""}`}
        footer={
          <>
            <Button onClick={() => setBuying(null)}>Cancel</Button>
            <Button variant="primary" loading={saving} onClick={doBuy}>
              Record purchase
            </Button>
          </>
        }
      >
        {buying && (
          <>
            <p className="rounded-lg border border-[var(--line-2)] bg-[var(--fill-1)] px-3.5 py-3 text-[12.5px] text-muted-foreground">
              This adds stock <em className="not-italic text-foreground">and</em> logs the cost as{" "}
              <span className="font-semibold text-foreground">
                {buying.kind === "equipment" ? "an equipment purchase" : "cost of goods"}
              </span>{" "}
              on the Finance page.
            </p>

            <FieldRow>
              <Field label="Quantity">
                <input
                  type="number"
                  min={0.01}
                  step="0.01"
                  className={inputCls}
                  value={buy.quantity}
                  onChange={(e) => setBuy({ ...buy, quantity: e.target.value })}
                />
              </Field>
              <Field label="Cost per unit">
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  className={inputCls}
                  value={buy.unitCost}
                  onChange={(e) => setBuy({ ...buy, unitCost: e.target.value })}
                />
              </Field>
            </FieldRow>

            <FieldRow>
              <Field label="Date">
                <input
                  type="date"
                  className={inputCls}
                  value={buy.date}
                  onChange={(e) => setBuy({ ...buy, date: e.target.value })}
                />
              </Field>
              <Field label="Supplier" hint="Optional">
                <input
                  className={inputCls}
                  value={buy.vendor}
                  maxLength={80}
                  onChange={(e) => setBuy({ ...buy, vendor: e.target.value })}
                />
              </Field>
            </FieldRow>

            <p className="text-[13px] text-muted-foreground">
              Total:{" "}
              <span className="tnum font-bold text-foreground">
                {money(Math.round((Number(buy.quantity) || 0) * (Number(buy.unitCost) || 0) * 100) / 100)}
              </span>
            </p>
          </>
        )}
      </EditorModal>
    </>
  );
}
