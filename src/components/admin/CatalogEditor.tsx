import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Package, Pencil, Plus, Trash2, X } from "lucide-react";

import { listCatalog } from "@/lib/api/admin.functions";
import {
  Portal,
  Button,
  EmptyState,
  ErrorNote,
  Field,
  GlassCard,
  Spinner,
  SuccessNote,
  ToggleChip,
  hours,
  inputCls,
  money,
} from "./ui";

// One editor drives both /admin/services and /admin/addons — they're the
// same shape (title, blurb, price, duration, active) with different labels
// and a different save/delete pair.

export type CatalogItem = {
  id: string;
  title: string;
  detail: string;
  price: number;
  durationMinutes: number;
  active: boolean;
  sortOrder: number;
};

type Props = {
  kind: "service" | "addon";
  labels: {
    titleField: string;
    detailField: string;
    detailHint: string;
    addButton: string;
    emptyTitle: string;
    emptyBody: string;
  };
  onSave: (item: CatalogItem) => Promise<unknown>;
  onDelete: (id: string) => Promise<unknown>;
};

const blank = (sortOrder: number): CatalogItem => ({
  id: "",
  title: "",
  detail: "",
  price: 0,
  durationMinutes: 60,
  active: true,
  sortOrder,
});

/** URL/id-safe slug generated from the title for brand-new items. */
function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

export function CatalogEditor({ kind, labels, onSave, onDelete }: Props) {
  const [items, setItems] = useState<CatalogItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [draft, setDraft] = useState<CatalogItem | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const res = await listCatalog();
      const source = kind === "service" ? res.services : res.addOns;
      setItems(
        source.map((s) =>
          "title" in s
            ? {
                id: s.id,
                title: s.title,
                detail: s.subtitle,
                price: s.priceValue,
                durationMinutes: s.durationMinutes,
                active: s.active,
                sortOrder: s.sortOrder,
              }
            : {
                id: s.id,
                title: s.name,
                detail: s.detail,
                price: s.price,
                durationMinutes: s.durationMinutes,
                active: s.active,
                sortOrder: s.sortOrder,
              },
        ),
      );
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load.");
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      const id = draft.id || slugify(draft.title);
      if (!id) throw new Error("Give it a name first.");
      if (isNew && items?.some((i) => i.id === id)) {
        throw new Error("Something with that name already exists.");
      }
      await onSave({ ...draft, id });
      setDraft(null);
      setSaved("Saved — the booking form is updated.");
      setTimeout(() => setSaved(null), 3500);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (item: CatalogItem) => {
    setError(null);
    try {
      await onSave({ ...item, active: !item.active });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't update.");
    }
  };

  const remove = async (item: CatalogItem) => {
    if (
      !confirm(
        `Delete "${item.title}"? Existing bookings keep their saved price — this only removes it from the booking form.`,
      )
    )
      return;
    setError(null);
    try {
      await onDelete(item.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't delete.");
    }
  };

  if (!items && !error) return <Spinner label="Loading…" />;

  return (
    <>
      <div className="mb-5 flex justify-end">
        <Button
          variant="primary"
          onClick={() => {
            setDraft(blank(items?.length ?? 0));
            setIsNew(true);
          }}
        >
          <Plus className="h-4 w-4" /> {labels.addButton}
        </Button>
      </div>

      <AnimatePresence>
        {error && <ErrorNote>{error}</ErrorNote>}
        {saved && <SuccessNote>{saved}</SuccessNote>}
      </AnimatePresence>

      {items && items.length === 0 ? (
        <div className="mt-5">
          <EmptyState icon={Package} title={labels.emptyTitle} body={labels.emptyBody} />
        </div>
      ) : (
        <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <AnimatePresence initial={false}>
            {items?.map((item, i) => (
              <motion.div
                key={item.id}
                layout
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0, transition: { delay: Math.min(i * 0.05, 0.3) } }}
                exit={{ opacity: 0, scale: 0.96 }}
                whileHover={{ y: -4 }}
                className={`liquid-glass flex flex-col rounded-2xl p-5 transition-opacity ${item.active ? "" : "opacity-60"}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 truncate text-[15px] font-bold tracking-tight text-foreground">
                    {item.title}
                  </p>
                  <ToggleChip on={item.active} onChange={() => toggleActive(item)} />
                </div>

                {/* Sentence case, normal tracking — the old uppercase+wide
                    treatment made these read as labels, not descriptions. */}
                <p className="mt-1.5 line-clamp-2 text-[12.5px] leading-relaxed text-muted-foreground">
                  {item.detail || "No description"}
                </p>

                <div className="mt-4 flex items-baseline gap-2.5">
                  <span className="tnum text-[22px] font-bold leading-none text-primary">
                    {kind === "addon" ? "+" : ""}
                    {money(item.price)}
                  </span>
                  <span className="tnum text-[12px] text-muted-foreground">
                    {hours(item.durationMinutes)}
                  </span>
                </div>

                <div className="mt-4 flex gap-2 border-t border-white/[0.06] pt-3">
                  <Button
                    size="sm"
                    onClick={() => {
                      setDraft(item);
                      setIsNew(false);
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" /> Edit
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(item)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      <Portal><AnimatePresence>
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
              className="max-h-[88vh] w-full max-w-md overflow-y-auto overscroll-contain rounded-2xl border border-white/[0.08] bg-[var(--card)] p-6"
            >
              <div className="flex items-start justify-between">
                <h2 className="text-lg font-bold tracking-tight text-foreground">
                  {isNew ? labels.addButton : `Edit ${draft.title}`}
                </h2>
                <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <div className="mt-5 space-y-4">
                <Field label={labels.titleField}>
                  <input
                    className={inputCls}
                    value={draft.title}
                    maxLength={60}
                    onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                  />
                </Field>
                <Field label={labels.detailField} hint={labels.detailHint}>
                  <input
                    className={inputCls}
                    value={draft.detail}
                    maxLength={120}
                    onChange={(e) => setDraft({ ...draft, detail: e.target.value })}
                  />
                </Field>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Price ($)">
                    <input
                      className={inputCls}
                      type="number"
                      min={0}
                      value={draft.price}
                      onChange={(e) => setDraft({ ...draft, price: Number(e.target.value) })}
                    />
                  </Field>
                  <Field label="Minutes" hint="Blocks this much calendar time.">
                    <input
                      className={inputCls}
                      type="number"
                      min={kind === "service" ? 15 : 0}
                      step={15}
                      value={draft.durationMinutes}
                      onChange={(e) =>
                        setDraft({ ...draft, durationMinutes: Number(e.target.value) })
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
                  Offer this on the booking form
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
      </AnimatePresence></Portal>
    </>
  );
}
