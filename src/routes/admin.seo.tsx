import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Globe, Image as ImageIcon, Images, Plus, Search, Trash2, Upload } from "lucide-react";

import {
  getAdminSettings,
  listAdminGallery,
  removeGalleryPair,
  saveGalleryPair,
  saveSiteSettings,
  uploadPhoto,
} from "@/lib/api/admin.functions";
import {
  Button,
  ErrorNote,
  Field,
  GlassCard,
  PageHeader,
  Spinner,
  SuccessNote,
  inputCls,
} from "@/components/admin/ui";

export const Route = createFileRoute("/admin/seo")({
  component: Seo,
});

type Settings = Awaited<ReturnType<typeof getAdminSettings>>["settings"];
type Pair = Awaited<ReturnType<typeof listAdminGallery>>["pairs"][number];

/** Same downscale as the booking photo uploader — keeps requests small. */
async function downscale(file: File, maxEdge = 1600): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not process that image.");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return canvas.toDataURL("image/jpeg", 0.82).split(",")[1] ?? "";
}

function Seo() {
  const [s, setS] = useState<Settings | null>(null);
  const [pairs, setPairs] = useState<Pair[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const [set, gal] = await Promise.all([getAdminSettings(), listAdminGallery()]);
      setS(set.settings);
      setPairs(gal.pairs);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load.");
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const flash = (m: string) => {
    setOk(m);
    setTimeout(() => setOk(null), 3500);
  };

  const save = async () => {
    if (!s) return;
    setBusy(true);
    setError(null);
    try {
      const res = await saveSiteSettings({
        data: {
          siteUrl: s.siteUrl,
          siteTitle: s.siteTitle,
          siteTagline: s.siteTagline,
          siteDescription: s.siteDescription,
          siteKeywords: s.siteKeywords,
          ogImageUrl: s.ogImageUrl,
          faviconUrl: s.faviconUrl,
          twitterHandle: s.twitterHandle,
        },
      });
      setS(res.settings);
      flash("Saved. Reload the public site to see the new tags.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  };

  if (!s && !error) return <Spinner label="Loading…" />;
  if (!s) return <ErrorNote>{error}</ErrorNote>;

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS({ ...s, [k]: v });
  const titleLen = s.siteTitle.length;
  const descLen = s.siteDescription.length;

  return (
    <>
      <PageHeader
        title="SEO & branding"
        subtitle="What Google and social previews show for your site."
        actions={
          <Button variant="primary" loading={busy} onClick={save}>
            Save changes
          </Button>
        }
      />

      <AnimatePresence>
        {error && <ErrorNote>{error}</ErrorNote>}
        {ok && <SuccessNote>{ok}</SuccessNote>}
      </AnimatePresence>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <GlassCard index={0} className="p-6">
          <div className="flex items-center gap-2.5">
            <Search className="h-4 w-4 text-primary" />
            <p className="text-[15px] font-semibold tracking-tight text-foreground">
              Search listing
            </p>
          </div>

          <div className="mt-5 space-y-4">
            <Field
              label="Site title"
              hint={`${titleLen}/60 — Google usually cuts off past 60 characters.`}
            >
              <input
                className={inputCls}
                value={s.siteTitle}
                maxLength={120}
                onChange={(e) => set("siteTitle", e.target.value)}
              />
            </Field>
            <Field
              label="Meta description"
              hint={`${descLen}/160 — aim for 120–160.`}
            >
              <textarea
                className={`${inputCls} min-h-[80px] resize-y`}
                value={s.siteDescription}
                maxLength={320}
                onChange={(e) => set("siteDescription", e.target.value)}
              />
            </Field>
            <Field label="Tagline" hint="Used on the site, not in search results.">
              <input
                className={inputCls}
                value={s.siteTagline}
                maxLength={160}
                onChange={(e) => set("siteTagline", e.target.value)}
              />
            </Field>
            <Field label="Keywords" hint="Comma separated. Minor SEO value these days.">
              <input
                className={inputCls}
                value={s.siteKeywords}
                maxLength={300}
                onChange={(e) => set("siteKeywords", e.target.value)}
              />
            </Field>
          </div>

          {/* Live Google-style preview */}
          <div className="mt-6 rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
            <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Google preview
            </p>
            <p className="truncate text-[12px] text-emerald-300/80">
              {s.siteUrl || "yourdomain.com"}
            </p>
            <p className="mt-0.5 truncate text-[16px] text-[#8ab4f8]">
              {s.siteTitle || "Your site title"}
            </p>
            <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-relaxed text-muted-foreground">
              {s.siteDescription || "Your meta description shows here."}
            </p>
          </div>
        </GlassCard>

        <GlassCard index={1} className="p-6">
          <div className="flex items-center gap-2.5">
            <Globe className="h-4 w-4 text-primary" />
            <p className="text-[15px] font-semibold tracking-tight text-foreground">
              Domain & social image
            </p>
          </div>

          <div className="mt-5 space-y-4">
            <Field
              label="Site URL"
              hint="Your live domain. Also used for the Google OAuth redirect and the canonical tag."
            >
              <input
                className={inputCls}
                value={s.siteUrl}
                placeholder="https://detailedbynate.com"
                onChange={(e) => set("siteUrl", e.target.value)}
              />
            </Field>
            <Field
              label="Social share image URL"
              hint="Shown when the link is posted. 1200×630 works best. Must be a public URL — crawlers can't read uploads."
            >
              <input
                className={inputCls}
                value={s.ogImageUrl}
                placeholder="https://detailedbynate.com/share.jpg"
                onChange={(e) => set("ogImageUrl", e.target.value)}
              />
            </Field>
            <Field label="Favicon URL" hint="The little icon in the browser tab.">
              <input
                className={inputCls}
                value={s.faviconUrl}
                placeholder="https://detailedbynate.com/favicon.png"
                onChange={(e) => set("faviconUrl", e.target.value)}
              />
            </Field>
            <Field label="Twitter / X handle">
              <input
                className={inputCls}
                value={s.twitterHandle}
                placeholder="@detailedbynate"
                onChange={(e) => set("twitterHandle", e.target.value)}
              />
            </Field>
          </div>

          <div className="mt-6 rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
            <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Social preview
            </p>
            <div className="overflow-hidden rounded-lg border border-white/[0.08]">
              {s.ogImageUrl ? (
                <img
                  src={s.ogImageUrl}
                  alt=""
                  className="aspect-[1200/630] w-full bg-white/[0.03] object-cover"
                  onError={(e) => (e.currentTarget.style.display = "none")}
                />
              ) : (
                <div className="flex aspect-[1200/630] w-full items-center justify-center bg-white/[0.03] text-[11.5px] text-muted-foreground">
                  <ImageIcon className="mr-1.5 h-3.5 w-3.5" /> No share image set
                </div>
              )}
              <div className="px-3 py-2">
                <p className="truncate text-[11px] uppercase text-muted-foreground">
                  {s.siteUrl.replace(/^https?:\/\//, "") || "yourdomain.com"}
                </p>
                <p className="truncate text-[13px] font-semibold text-foreground">{s.siteTitle}</p>
                <p className="line-clamp-1 text-[11.5px] text-muted-foreground">
                  {s.siteDescription}
                </p>
              </div>
            </div>
          </div>
        </GlassCard>
      </div>

      <GalleryCard pairs={pairs} reload={load} onError={setError} onOk={flash} />
    </>
  );
}

function GalleryCard({
  pairs,
  reload,
  onError,
  onOk,
}: {
  pairs: Pair[] | null;
  reload: () => Promise<void>;
  onError: (m: string) => void;
  onOk: (m: string) => void;
}) {
  const [label, setLabel] = useState("");
  const [before, setBefore] = useState<{ id: string; url: string } | null>(null);
  const [after, setAfter] = useState<{ id: string; url: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const pick = async (which: "before" | "after", file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const base64 = await downscale(file);
      const res = await uploadPhoto({
        data: { kind: which, mime: "image/jpeg", base64 },
      });
      const url = `data:image/jpeg;base64,${base64}`;
      if (which === "before") setBefore({ id: res.photo.id, url });
      else setAfter({ id: res.photo.id, url });
    } catch (e) {
      onError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    if (!before || !after || !label.trim()) return;
    setBusy(true);
    try {
      await saveGalleryPair({
        data: {
          label: label.trim(),
          beforePhotoId: before.id,
          afterPhotoId: after.id,
          sortOrder: pairs?.length ?? 0,
          active: true,
        },
      });
      setLabel("");
      setBefore(null);
      setAfter(null);
      onOk("Added to the gallery.");
      await reload();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <GlassCard index={2} className="mt-5 p-6">
      <div className="flex items-center gap-2.5">
        <Images className="h-4 w-4 text-primary" />
        <p className="text-[15px] font-semibold tracking-tight text-foreground">
          Before / after gallery
        </p>
      </div>
      <p className="mt-1 text-[12.5px] text-muted-foreground">
        Shown on the public site. Upload a matching pair and give it a short label.
      </p>

      <div className="mt-5 grid gap-4 sm:grid-cols-[1fr_1fr_auto]">
        <DropSlot label="Before" value={before?.url} onFile={(f) => pick("before", f)} />
        <DropSlot label="After" value={after?.url} onFile={(f) => pick("after", f)} />
        <div className="flex flex-col justify-end gap-2">
          <Field label="Label">
            <input
              className={inputCls}
              value={label}
              maxLength={80}
              placeholder="Paint correction"
              onChange={(e) => setLabel(e.target.value)}
            />
          </Field>
          <Button
            variant="primary"
            loading={busy}
            disabled={!before || !after || !label.trim()}
            onClick={add}
          >
            <Plus className="h-3.5 w-3.5" /> Add pair
          </Button>
        </div>
      </div>

      {pairs && pairs.length > 0 && (
        <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <AnimatePresence initial={false}>
            {pairs.map((p) => (
              <motion.div
                key={p.id}
                layout
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                className="overflow-hidden rounded-xl border border-white/[0.07] bg-white/[0.02]"
              >
                <div className="grid grid-cols-2">
                  {[p.beforeUrl, p.afterUrl].map((u, i) => (
                    <div key={i} className="relative aspect-[4/3]">
                      {u ? (
                        <img src={u} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full items-center justify-center bg-white/[0.04] text-[10px] text-muted-foreground">
                          missing
                        </div>
                      )}
                      <span className="absolute left-1.5 top-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[9.5px] font-semibold uppercase text-white">
                        {i === 0 ? "Before" : "After"}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-2 px-3 py-2">
                  <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-foreground">
                    {p.label}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      if (!confirm(`Remove "${p.label}" from the gallery?`)) return;
                      await removeGalleryPair({ data: { id: p.id } });
                      await reload();
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </GlassCard>
  );
}

function DropSlot({
  label,
  value,
  onFile,
}: {
  label: string;
  value?: string;
  onFile: (f: File | undefined) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div>
      <p className="mb-1.5 text-[12px] font-medium text-muted-foreground">{label}</p>
      <button
        type="button"
        onClick={() => ref.current?.click()}
        className="relative aspect-[4/3] w-full overflow-hidden rounded-xl border border-dashed border-white/[0.14] bg-white/[0.02] transition hover:border-primary/40"
      >
        {value ? (
          <img src={value} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="flex h-full flex-col items-center justify-center gap-1.5 text-[12px] text-muted-foreground">
            <Upload className="h-4 w-4 text-primary" />
            Choose image
          </span>
        )}
      </button>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => onFile(e.target.files?.[0])}
      />
    </div>
  );
}
