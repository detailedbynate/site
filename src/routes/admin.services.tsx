import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ImageIcon, Sparkles, Truck, Upload } from "lucide-react";

import {
  getAdminSettings,
  removeService,
  saveService,
  saveCeramicCopy,
  saveCeramicMode,
  saveTravelFee,
} from "@/lib/api/admin.functions";
import { CatalogEditor } from "@/components/admin/CatalogEditor";
import { getCatalog } from "@/lib/api/booking.functions";
import {
  clearServiceImage,
  getServiceImages,
  setServiceImage,
} from "@/lib/api/content.functions";
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
      <CeramicModeCard />
      <PackagePhotosCard />
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

/** Packages that have a photo on the homepage, in display order. */
const PHOTO_PACKAGES = ["diamond", "gold", "silver"];

/**
 * The photo on each package card on the homepage. Blank = the bundled
 * placeholder. Images are shrunk in the browser before upload.
 */
function PackagePhotosCard() {
  const [images, setImages] = useState<Record<string, string> | null>(null);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = async () => {
    const [imgs, cat] = await Promise.all([getServiceImages(), getCatalog().catch(() => null)]);
    setImages(imgs.images);
    if (cat) setTitles(Object.fromEntries(cat.services.map((s) => [s.id, s.title])));
  };

  useEffect(() => {
    load().catch(() => setImages({}));
  }, []);

  if (!images) return null;

  const upload = async (serviceId: string, file: File) => {
    setBusy(serviceId);
    setMsg(null);
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Couldn't process that image.");
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close?.();
      const base64 = canvas.toDataURL("image/jpeg", 0.85).split(",")[1] ?? "";
      await setServiceImage({ data: { serviceId, mime: "image/jpeg", base64 } });
      await load();
      setMsg({ ok: true, text: "Photo updated. It shows on the homepage now." });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Upload failed." });
    } finally {
      setBusy(null);
    }
  };

  const reset = async (serviceId: string) => {
    if (!confirm("Go back to the default photo for this package?")) return;
    setBusy(serviceId);
    try {
      await clearServiceImage({ data: { serviceId } });
      await load();
    } finally {
      setBusy(null);
    }
  };

  return (
    <GlassCard index={2} className="mb-5 p-6">
      <div className="flex items-center gap-2.5">
        <ImageIcon className="h-4 w-4 text-primary" />
        <p className="text-[15px] font-semibold tracking-tight text-foreground">Package photos</p>
      </div>
      <p className="mt-1 text-[12.5px] text-muted-foreground">
        The picture on each package on your homepage.
      </p>
      {msg && (
        <p className={`mt-3 text-[12.5px] ${msg.ok ? "text-emerald-400" : "text-red-400"}`}>
          {msg.text}
        </p>
      )}
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        {PHOTO_PACKAGES.map((id) => (
          <PackagePhoto
            key={id}
            title={titles[id] ?? id[0]!.toUpperCase() + id.slice(1)}
            url={images[id] ?? null}
            busy={busy === id}
            onPick={(f) => void upload(id, f)}
            onReset={() => void reset(id)}
          />
        ))}
      </div>
    </GlassCard>
  );
}

function PackagePhoto({
  title,
  url,
  busy,
  onPick,
  onReset,
}: {
  title: string;
  url: string | null;
  busy: boolean;
  onPick: (f: File) => void;
  onReset: () => void;
}) {
  const [input, setInput] = useState<HTMLInputElement | null>(null);
  return (
    <div>
      <p className="text-[13px] font-semibold text-foreground">{title}</p>
      <div className="mt-2 overflow-hidden rounded-xl border border-[var(--line-2)] bg-[var(--fill-1)]">
        {url ? (
          <img src={url} alt={`${title} photo`} className="h-32 w-full object-cover" />
        ) : (
          <div className="flex h-32 items-center justify-center text-[12px] text-muted-foreground">
            Using the default photo
          </div>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button size="sm" variant="primary" loading={busy} onClick={() => input?.click()}>
          <Upload className="h-3.5 w-3.5" /> {url ? "Replace" : "Upload"}
        </Button>
        {url && (
          <Button size="sm" onClick={onReset}>
            Use default
          </Button>
        )}
      </div>
      <input
        ref={setInput}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPick(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}

type CeramicMode = "hidden" | "soon" | "open";

const CERAMIC_OPTIONS: { id: CeramicMode; label: string; hint: string }[] = [
  { id: "hidden", label: "Hidden", hint: "Not shown anywhere on the site." },
  { id: "soon", label: "Coming soon", hint: "Shown on the homepage without prices. Can't be booked." },
  { id: "open", label: "Open for reservations", hint: "Prices shown, and customers can book it." },
];

/** Whether ceramic coating is hidden, teased as coming soon, or bookable. */
function CeramicModeCard() {
  const [mode, setMode] = useState<CeramicMode | null>(null);
  const [busy, setBusy] = useState<CeramicMode | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getAdminSettings()
      .then((r) => setMode(r.settings.ceramicMode ?? "soon"))
      .catch(() => undefined);
  }, []);

  if (!mode) return null;

  const pick = async (next: CeramicMode) => {
    if (next === mode) return;
    setBusy(next);
    setError(null);
    try {
      setMode((await saveCeramicMode({ data: { ceramicMode: next } })).ceramicMode);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <GlassCard index={1} className="mb-5 p-6">
      <div className="flex items-center gap-2.5">
        <Sparkles className="h-4 w-4 text-primary" />
        <p className="text-[15px] font-semibold tracking-tight text-foreground">
          Ceramic coating on the site
        </p>
      </div>
      <p className="mt-1 text-[12.5px] text-muted-foreground">
        Prices and wording for each coating are edited in the package list below.
      </p>
      <div
        className="mt-4 grid gap-2 sm:grid-cols-3"
        role="radiogroup"
        aria-label="Ceramic coating on the site"
      >
        {CERAMIC_OPTIONS.map((o) => {
          const active = mode === o.id;
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={busy !== null}
              onClick={() => void pick(o.id)}
              className={`rounded-xl border p-4 text-left transition-colors ${
                active
                  ? "border-primary bg-primary/10"
                  : "border-[var(--line-2)] bg-[var(--fill-1)] hover:border-primary/40"
              }`}
            >
              <p className="text-[13.5px] font-semibold text-foreground">
                {o.label}
                {busy === o.id && " …"}
              </p>
              <p className="mt-1 text-[12px] leading-snug text-muted-foreground">{o.hint}</p>
            </button>
          );
        })}
      </div>
      {error && <p className="mt-3 text-[12.5px] text-red-400">{error}</p>}
      <CeramicCopyEditor />
    </GlassCard>
  );
}

/** The ceramic section's intro, three highlights and closing note. */
function CeramicCopyEditor() {
  const [intro, setIntro] = useState<string | null>(null);
  const [points, setPoints] = useState<string[]>(["", "", ""]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    getAdminSettings()
      .then(({ settings: s }) => {
        setIntro(s.ceramicIntro ?? "");
        setPoints([0, 1, 2].map((i) => s.ceramicPoints?.[i] ?? ""));
        setNote(s.ceramicNote ?? "");
      })
      .catch(() => undefined);
  }, []);

  if (intro === null) return null;

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await saveCeramicCopy({ data: { ceramicIntro: intro, ceramicPoints: points, ceramicNote: note } });
      setMsg({ ok: true, text: "Saved. The homepage shows it now." });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Couldn't save." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-6 border-t border-[var(--line-2)] pt-5">
      <p className="text-[13.5px] font-semibold text-foreground">Section wording</p>
      <p className="mt-1 text-[12px] text-muted-foreground">
        Each coating's own name, price and description are edited in the package list below.
      </p>
      <label className="mt-4 block text-[12px] font-medium text-muted-foreground">
        Intro
        <textarea
          className={`${inputCls} mt-1.5 min-h-[88px]`}
          value={intro}
          maxLength={600}
          onChange={(e) => setIntro(e.target.value)}
        />
      </label>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {points.map((p, i) => (
          <label key={i} className="block text-[12px] font-medium text-muted-foreground">
            Highlight {i + 1}
            <input
              className={`${inputCls} mt-1.5`}
              value={p}
              maxLength={80}
              placeholder="Leave blank to hide"
              onChange={(e) => setPoints(points.map((x, j) => (j === i ? e.target.value : x)))}
            />
          </label>
        ))}
      </div>
      <label className="mt-3 block text-[12px] font-medium text-muted-foreground">
        Note under the coatings
        <textarea
          className={`${inputCls} mt-1.5 min-h-[72px]`}
          value={note}
          maxLength={600}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button variant="primary" loading={busy} onClick={save}>
          Save wording
        </Button>
        {msg && (
          <p className={`text-[12.5px] ${msg.ok ? "text-emerald-400" : "text-red-400"}`}>{msg.text}</p>
        )}
      </div>
    </div>
  );
}
