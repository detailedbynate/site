import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Truck } from "lucide-react";

import {
  getAdminSettings,
  removeService,
  saveService,
  saveTravelFee,
} from "@/lib/api/admin.functions";
import { CatalogEditor } from "@/components/admin/CatalogEditor";
import { Button, GlassCard, PageHeader, inputCls } from "@/components/admin/ui";

export const Route = createFileRoute("/admin/services")({
  component: Services,
});

function Services() {
  return (
    <>
      <PageHeader
        title="Services"
        subtitle="Your packages. Edits here change the booking form immediately — price and duration are re-read on every booking."
      />
      <MobileFeeCard />
      <CatalogEditor
        kind="service"
        labels={{
          titleField: "Package name",
          detailField: "Tagline",
          detailHint: "Shown under the name, e.g. \"Interior & Exterior\".",
          addButton: "New package",
          emptyTitle: "No packages",
          emptyBody: "Add at least one package so customers have something to book.",
        }}
        onSave={(item) =>
          saveService({
            data: {
              id: item.id,
              title: item.title,
              subtitle: item.detail,
              priceValue: item.price,
              durationMinutes: item.durationMinutes,
              features: (item.features ?? []).map((f) => f.trim()).filter(Boolean),
              description: item.description ?? "",
              active: item.active,
              sortOrder: item.sortOrder,
              materialCost: item.materialCost ?? 0,
            },
          })
        }
        onDelete={(id) => removeService({ data: { id } })}
      />
    </>
  );
}

/**
 * The mobile fee, next to the prices it's added to. The same value is also
 * editable in Settings — both read and write the one `travelFee` setting.
 */
function MobileFeeCard() {
  const [fee, setFee] = useState<number | null>(null);
  const [saved, setSaved] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    getAdminSettings()
      .then((r) => {
        setFee(r.settings.travelFee);
        setSaved(r.settings.travelFee);
      })
      .catch(() => undefined);
  }, []);

  if (fee === null) return null;

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await saveTravelFee({ data: { travelFee: Math.max(0, Math.round(fee)) } });
      setFee(res.travelFee);
      setSaved(res.travelFee);
      setMsg({ ok: true, text: "Saved. New mobile bookings use this fee." });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Couldn't save." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <GlassCard index={0} className="mb-5 p-5">
      <div className="flex flex-wrap items-end gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2.5">
            <Truck className="h-4 w-4 text-primary" />
            <p className="text-[15px] font-semibold tracking-tight text-foreground">
              Mobile detailing fee
            </p>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Added on top of the package when a customer picks mobile service. Set it to 0 to make
            mobile free.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative w-32">
            <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[13px] text-muted-foreground">
              $
            </span>
            <input
              type="number"
              min={0}
              step={1}
              aria-label="Mobile detailing fee"
              className={`${inputCls} pl-7`}
              value={fee}
              onChange={(e) => setFee(Number(e.target.value))}
            />
          </div>
          <Button variant="primary" loading={busy} disabled={fee === saved} onClick={save}>
            Save
          </Button>
        </div>
      </div>
      {msg && (
        <p className={`mt-2 text-[12px] ${msg.ok ? "text-emerald-300" : "text-destructive"}`}>
          {msg.text}
        </p>
      )}
    </GlassCard>
  );
}
