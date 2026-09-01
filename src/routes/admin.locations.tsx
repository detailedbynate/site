import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Building2, Map, MapPin, Navigation, Plus, Settings2, Trash2, Truck } from "lucide-react";

import { listAdminLocations, removeLocation, saveLocation } from "@/lib/api/operations.functions";
import { EditorModal, FieldRow } from "@/components/admin/EditorModal";
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

export const Route = createFileRoute("/admin/locations")({
  component: Locations,
});

type Data = Awaited<ReturnType<typeof listAdminLocations>>;
type Loc = Data["locations"][number];

const uid = () =>
  globalThis.crypto?.randomUUID?.() ?? `l-${Date.now()}-${Math.random().toString(16).slice(2)}`;

function blank(kind: "shop" | "zone", sortOrder: number, fallbackFee: number): Loc {
  return {
    id: uid(),
    name: "",
    kind,
    address: "",
    city: "",
    postalCode: "",
    travelFee: kind === "zone" ? fallbackFee : 0,
    radiusKm: 0,
    notes: undefined,
    active: true,
    sortOrder,
    createdAt: new Date().toISOString(),
    jobs: 0,
    revenue: 0,
  };
}

function Locations() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [draft, setDraft] = useState<Loc | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await listAdminLocations());
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
    if (!draft.name.trim()) return setError("Give it a name.");
    setSaving(true);
    setError(null);
    try {
      await saveLocation({
        data: {
          id: draft.id,
          name: draft.name.trim(),
          kind: draft.kind,
          address: draft.address.trim(),
          city: draft.city.trim(),
          postalCode: draft.postalCode.trim(),
          travelFee: Number(draft.travelFee) || 0,
          radiusKm: Number(draft.radiusKm) || 0,
          notes: draft.notes?.trim() || undefined,
          active: draft.active,
          sortOrder: draft.sortOrder,
        },
      });
      setDraft(null);
      flash(isNew ? "Location added." : "Saved.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  };

  const del = async (l: Loc) => {
    if (!confirm(`Delete ${l.name}? Jobs stay, but lose their location tag.`)) return;
    try {
      await removeLocation({ data: { id: l.id } });
      flash("Deleted.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete it.");
    }
  };

  if (error && !data) return <ErrorNote>{error}</ErrorNote>;
  if (!data) return <Spinner label="Loading locations…" />;

  const shops = data.locations.filter((l) => l.kind === "shop");
  const zones = data.locations.filter((l) => l.kind === "zone");

  return (
    <>
      <PageHeader
        title="Locations"
        subtitle="Your shop or bays, and the mobile areas you cover. Zones can carry their own travel fee so a longer drive is priced for."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => {
                setDraft(blank("shop", data.locations.length, data.defaultTravelFee));
                setIsNew(true);
              }}
            >
              <Building2 className="h-3.5 w-3.5" /> Add shop
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setDraft(blank("zone", data.locations.length, data.defaultTravelFee));
                setIsNew(true);
              }}
            >
              <Plus className="h-3.5 w-3.5" /> Add zone
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

      <div className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile index={0} label="Shops" value={shops.length} hint="fixed premises" icon={Building2} />
        <StatTile index={1} label="Service zones" value={zones.length} hint="mobile areas" icon={Map} accent />
        <StatTile
          index={2}
          label="Default travel fee"
          value={money(data.defaultTravelFee)}
          hint="used when no zone applies"
          icon={Truck}
        />
        <StatTile index={3} label="Untagged jobs" value={data.unassigned} hint="no location set" icon={MapPin} />
      </div>

      {data.locations.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            icon={MapPin}
            title="No locations yet"
            body="Add a shop if you work from a unit, and a zone for each area you'll drive to. Zones let you charge more for the far ones."
            action={
              <Button
                variant="primary"
                onClick={() => {
                  setDraft(blank("zone", 0, data.defaultTravelFee));
                  setIsNew(true);
                }}
              >
                <Plus className="h-3.5 w-3.5" /> Add a zone
              </Button>
            }
          />
        </div>
      ) : (
        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <AnimatePresence initial={false}>
            {data.locations.map((l, i) => (
              <motion.div
                key={l.id}
                layout
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0, transition: { delay: Math.min(i * 0.05, 0.3) } }}
                exit={{ opacity: 0, scale: 0.98 }}
                className={`liquid-glass group relative rounded-2xl p-5 ${l.active ? "" : "opacity-55"}`}
              >
                <div className="flex items-start gap-3">
                  <span
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                      l.kind === "shop" ? "bg-violet-400/12" : "bg-primary/12"
                    }`}
                  >
                    {l.kind === "shop" ? (
                      <Building2 className="h-4 w-4 text-violet-300" />
                    ) : (
                      <Navigation className="h-4 w-4 text-primary" />
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setDraft(l);
                      setIsNew(false);
                    }}
                    className="min-w-0 flex-1 text-left"
                  >
                    <p className="truncate text-[14px] font-bold text-foreground">{l.name}</p>
                    <p className="truncate text-[11.5px] text-muted-foreground">
                      {l.kind === "shop"
                        ? [l.address, l.city].filter(Boolean).join(", ") || "No address"
                        : l.radiusKm > 0
                          ? `${l.radiusKm} km radius`
                          : l.city || "Service zone"}
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => del(l)}
                    aria-label={`Delete ${l.name}`}
                    className="rounded-md p-1.5 text-muted-foreground opacity-0 transition hover:bg-destructive/15 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>

                <div className="mt-4 grid grid-cols-3 gap-2 border-t border-[var(--line-2)] pt-4">
                  <Cell label="Travel" value={l.kind === "zone" ? money(l.travelFee) : "—"} />
                  <Cell label="Jobs" value={String(l.jobs)} />
                  <Cell label="Revenue" value={money(l.revenue)} />
                </div>

                {l.notes && (
                  <p className="mt-3 line-clamp-2 text-[11.5px] text-muted-foreground">{l.notes}</p>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      <GlassCard index={4} className="mt-5 flex flex-wrap items-center justify-between gap-4 p-5">
        <div>
          <p className="text-[13.5px] font-semibold text-foreground">
            What customers see today
          </p>
          <p className="mt-0.5 max-w-2xl text-[12px] text-muted-foreground">
            The booking form still offers the simple mobile-or-shop choice and charges the single
            default travel fee of {money(data.defaultTravelFee)}. Zones here are for your own
            planning and reporting — pointing the public form at them is a separate change, so say
            the word if you want that. Your advertised area is "{data.serviceArea}".
          </p>
        </div>
        <Link to="/admin/settings">
          <Button>
            <Settings2 className="h-3.5 w-3.5" /> Edit travel fee
          </Button>
        </Link>
      </GlassCard>

      <EditorModal
        open={!!draft}
        onClose={() => setDraft(null)}
        title={isNew ? `Add ${draft?.kind === "shop" ? "a shop" : "a zone"}` : `Edit ${draft?.name}`}
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
            <FieldRow>
              <Field label="Name">
                <input
                  className={inputCls}
                  value={draft.name}
                  maxLength={80}
                  placeholder={draft.kind === "shop" ? "Main bay" : "West end"}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </Field>
              <Field label="Type">
                <select
                  className={inputCls}
                  value={draft.kind}
                  onChange={(e) => setDraft({ ...draft, kind: e.target.value as Loc["kind"] })}
                >
                  <option value="zone">Service zone — you drive there</option>
                  <option value="shop">Shop / bay — they come to you</option>
                </select>
              </Field>
            </FieldRow>

            {draft.kind === "shop" ? (
              <>
                <Field label="Address">
                  <input
                    className={inputCls}
                    value={draft.address}
                    maxLength={200}
                    onChange={(e) => setDraft({ ...draft, address: e.target.value })}
                  />
                </Field>
                <FieldRow>
                  <Field label="City">
                    <input
                      className={inputCls}
                      value={draft.city}
                      maxLength={80}
                      onChange={(e) => setDraft({ ...draft, city: e.target.value })}
                    />
                  </Field>
                  <Field label="Postal code">
                    <input
                      className={inputCls}
                      value={draft.postalCode}
                      maxLength={20}
                      onChange={(e) => setDraft({ ...draft, postalCode: e.target.value })}
                    />
                  </Field>
                </FieldRow>
              </>
            ) : (
              <>
                <FieldRow>
                  <Field label="Area / city" hint="Where this zone covers">
                    <input
                      className={inputCls}
                      value={draft.city}
                      maxLength={80}
                      onChange={(e) => setDraft({ ...draft, city: e.target.value })}
                    />
                  </Field>
                  <Field label="Radius (km)" hint="0 if not relevant">
                    <input
                      type="number"
                      min={0}
                      step="0.5"
                      className={inputCls}
                      value={draft.radiusKm}
                      onChange={(e) => setDraft({ ...draft, radiusKm: Number(e.target.value) })}
                    />
                  </Field>
                </FieldRow>
                <Field
                  label="Travel fee for this zone"
                  hint={`The site-wide default is ${money(data.defaultTravelFee)}`}
                >
                  <input
                    type="number"
                    min={0}
                    step="1"
                    className={inputCls}
                    value={draft.travelFee}
                    onChange={(e) => setDraft({ ...draft, travelFee: Number(e.target.value) })}
                  />
                </Field>
              </>
            )}

            <Field label="Notes" hint="Optional">
              <textarea
                className={`${inputCls} min-h-[70px] resize-y`}
                value={draft.notes ?? ""}
                maxLength={1000}
                placeholder="Parking is tight — park on the street"
                onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              />
            </Field>

            <div className="flex items-center justify-between rounded-lg border border-[var(--line-2)] bg-[var(--fill-1)] px-3.5 py-3">
              <span className="text-[12.5px] text-foreground">
                In service
                <span className="block text-[11px] text-muted-foreground">
                  Turn off for an area you've stopped covering.
                </span>
              </span>
              <ToggleChip
                on={draft.active}
                labels={["Active", "Paused"]}
                onChange={(next) => setDraft({ ...draft, active: next })}
              />
            </div>
          </>
        )}
      </EditorModal>
    </>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10.5px] uppercase tracking-[0.1em] text-muted-foreground">{label}</p>
      <p className="tnum mt-0.5 text-[15px] font-bold text-foreground">{value}</p>
    </div>
  );
}
