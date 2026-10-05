import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Globe, Image as ImageIcon, Images, Megaphone, Plus, Search, Trash2, Type, Upload } from "lucide-react";

import {
  getAdminSettings,
  listAdminGallery,
  removeGalleryPair,
  saveGalleryPair,
  savePromo,
  saveSiteSettings,
  uploadPhoto,
} from "@/lib/api/admin.functions";
import { clearHeroImage, getHeroImage, setHeroImage } from "@/lib/api/content.functions";
import { BrandingUpload } from "@/components/admin/BrandingUpload";
import {
  Button,
  ErrorNote,
  Field,
  GlassCard,
  PageHeader,
  Spinner,
  SuccessNote,
  Toggle,
  inputCls,
} from "@/components/admin/ui";

export const Route = createFileRoute("/admin/seo")({
  component: Seo,
});

type Settings = Awaited<ReturnType<typeof getAdminSettings>>["settings"];
type Pair = Awaited<ReturnType<typeof listAdminGallery>>["pairs"][number];

/** iPhone photos (.heic / .heif). Only Safari can draw these natively. */
function isHeic(file: File): boolean {
  return /image\/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name);
}

/**
 * Turn an iPhone HEIC photo into a JPEG the browser can draw. The converter
 * is about 1 MB, so it's only downloaded when someone actually picks one.
 */
async function toDrawable(file: File): Promise<Blob> {
  if (!isHeic(file)) return file;
  const { default: heic2any } = await import("heic2any");
  const out = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.9 });
  return Array.isArray(out) ? out[0]! : out;
}

/** Same downscale as the booking photo uploader — keeps requests small. */
async function downscale(file: File, maxEdge = 1600): Promise<string> {
  const bitmap = await createImageBitmap(await toDrawable(file));
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
          heroHeadline: s.heroHeadline,
          heroHeadlineAccent: s.heroHeadlineAccent,
          heroSubtext: s.heroSubtext,
          statClients: s.statClients,
          statVehicles: s.statVehicles,
          statClientsLabel: s.statClientsLabel,
          statVehiclesLabel: s.statVehiclesLabel,
          statRatingLabel: s.statRatingLabel,
          heroBadge: s.heroBadge,
          heroPill: s.heroPill,
          reviewTotal: s.reviewTotal,
          googleReviewsUrl: s.googleReviewsUrl,
          facebookUrl: s.facebookUrl,
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
          <div className="mt-6 rounded-xl border border-[var(--line-2)] bg-[var(--fill-1)] p-4">
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
              <BrandingUpload
                slot="ogImage"
                label="Upload a share image"
                onUploaded={(url) => set("ogImageUrl", url)}
              />
            </Field>
            <Field
              label="Logo / favicon"
              hint="The browser-tab icon, and the icon of the admin app on your phone. A square PNG, 512×512, works everywhere."
            >
              <input
                className={inputCls}
                value={s.faviconUrl}
                placeholder="https://detailedbynate.com/favicon.png"
                onChange={(e) => set("faviconUrl", e.target.value)}
              />
              <BrandingUpload
                slot="favicon"
                label="Upload a logo"
                onUploaded={(url) => set("faviconUrl", url)}
              />
              {/* A link copied out of Facebook or Google Photos carries an
                  expiry stamp and will stop working. Uploading avoids it. */}
              {/^https?:\/\//i.test(s.faviconUrl) && (
                <p className="mt-1.5 text-[11.5px] text-amber-300">
                  This points at another site. Links from Facebook, Google Photos and similar
                  expire — upload the file instead and it will be served from your own domain.
                </p>
              )}
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

          <div className="mt-6 rounded-xl border border-[var(--line-2)] bg-[var(--fill-1)] p-4">
            <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Social preview
            </p>
            <div className="overflow-hidden rounded-lg border border-[var(--line-2)]">
              {s.ogImageUrl ? (
                <img
                  src={s.ogImageUrl}
                  alt=""
                  className="aspect-[1200/630] w-full bg-[var(--fill-1)] object-cover"
                  onError={(e) => (e.currentTarget.style.display = "none")}
                />
              ) : (
                <div className="flex aspect-[1200/630] w-full items-center justify-center bg-[var(--fill-1)] text-[11.5px] text-muted-foreground">
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

      {/* Hero wording, next to the hero image it sits on top of. */}
      <GlassCard index={2} className="mt-5 p-6">
        <div className="flex items-center gap-2.5">
          <Type className="h-4 w-4 text-primary" />
          <p className="text-[15px] font-semibold tracking-tight text-foreground">
            Homepage headline
          </p>
        </div>
        <p className="mt-1 text-[12.5px] text-muted-foreground">
          The big text customers land on. The second line keeps the accent colour.
        </p>

        <div className="mt-5">
          <Field
            label="Badge above the headline"
            hint="The small pill at the very top, e.g. a seasonal message. Leave blank to hide it."
          >
            <input
              className={inputCls}
              value={s.heroBadge}
              maxLength={80}
              onChange={(e) => set("heroBadge", e.target.value)}
            />
          </Field>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Headline, first line">
            <input
              className={inputCls}
              value={s.heroHeadline}
              maxLength={80}
              onChange={(e) => set("heroHeadline", e.target.value)}
            />
          </Field>
          <Field label="Headline, second line">
            <input
              className={inputCls}
              value={s.heroHeadlineAccent}
              maxLength={80}
              onChange={(e) => set("heroHeadlineAccent", e.target.value)}
            />
          </Field>
        </div>

        <div className="mt-4">
          <Field label="Description underneath">
            <textarea
              className={`${inputCls} min-h-[80px] resize-y`}
              value={s.heroSubtext}
              maxLength={400}
              onChange={(e) => set("heroSubtext", e.target.value)}
            />
          </Field>
        </div>

        <p className="mt-6 text-[13px] font-semibold text-foreground">Pills under the buttons</p>
        <p className="mt-0.5 text-[12px] text-muted-foreground">
          Leave any label blank to hide that pill.
        </p>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <Field label="First counter — number" hint="Animates up from zero, with a + after it.">
            <input
              className={inputCls}
              type="number"
              min={0}
              value={s.statClients}
              onChange={(e) => set("statClients", Number(e.target.value))}
            />
          </Field>
          <Field label="First counter — label">
            <input
              className={inputCls}
              value={s.statClientsLabel}
              maxLength={40}
              placeholder="clients served"
              onChange={(e) => set("statClientsLabel", e.target.value)}
            />
          </Field>
          <Field label="Second counter — number">
            <input
              className={inputCls}
              type="number"
              min={0}
              value={s.statVehicles}
              onChange={(e) => set("statVehicles", Number(e.target.value))}
            />
          </Field>
          <Field label="Second counter — label">
            <input
              className={inputCls}
              value={s.statVehiclesLabel}
              maxLength={40}
              placeholder="vehicles detailed"
              onChange={(e) => set("statVehiclesLabel", e.target.value)}
            />
          </Field>
          <Field label="Rating pill — label" hint="Always shows 5.0 and five stars.">
            <input
              className={inputCls}
              value={s.statRatingLabel}
              maxLength={40}
              placeholder="star rating"
              onChange={(e) => set("statRatingLabel", e.target.value)}
            />
          </Field>
          <Field label="Last pill" hint="Plain text, e.g. what you offer.">
            <input
              className={inputCls}
              value={s.heroPill}
              maxLength={80}
              onChange={(e) => set("heroPill", e.target.value)}
            />
          </Field>
          <Field
            label="Five-star reviews (total)"
            hint={`Shown as "${s.reviewTotal} five-star reviews on Google and Facebook" in the reviews section.`}
          >
            <input
              className={inputCls}
              type="number"
              min={0}
              value={s.reviewTotal}
              onChange={(e) => set("reviewTotal", Number(e.target.value))}
            />
          </Field>
          <Field label="Google reviews link" hint="Your Google Business Profile reviews page.">
            <input
              className={inputCls}
              value={s.googleReviewsUrl}
              placeholder="https://g.page/r/..."
              onChange={(e) => set("googleReviewsUrl", e.target.value)}
            />
          </Field>
          <Field label="Facebook page link">
            <input
              className={inputCls}
              value={s.facebookUrl}
              placeholder="https://www.facebook.com/..."
              onChange={(e) => set("facebookUrl", e.target.value)}
            />
          </Field>
        </div>

        <div className="mt-5 rounded-xl border border-[var(--line-2)] bg-[var(--fill-1)] p-4">
          <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Preview
          </p>
          {s.heroBadge.trim() && (
            <span className="mb-2.5 inline-block rounded-full px-2.5 py-0.5 text-[10.5px] text-muted-foreground ring-1 ring-inset ring-[var(--line-2)]">
              {s.heroBadge}
            </span>
          )}
          <p className="text-[22px] font-bold leading-tight tracking-tight text-foreground">
            {s.heroHeadline}
            <br />
            <span className="text-primary">{s.heroHeadlineAccent}</span>
          </p>
          <p className="mt-2 text-[12.5px] leading-relaxed text-muted-foreground">{s.heroSubtext}</p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {[
              s.statClientsLabel.trim() && `${s.statClients}+ ${s.statClientsLabel}`,
              s.statRatingLabel.trim() && `5.0 ★★★★★ ${s.statRatingLabel}`,
              s.statVehiclesLabel.trim() && `${s.statVehicles}+ ${s.statVehiclesLabel}`,
              s.heroPill.trim(),
            ]
              .filter(Boolean)
              .map((t, i) => (
                <span
                  key={i}
                  className="rounded-full bg-[var(--fill-2)] px-2.5 py-1 text-[10.5px] text-muted-foreground ring-1 ring-inset ring-[var(--line-1)]"
                >
                  {t}
                </span>
              ))}
          </div>
        </div>
      </GlassCard>

      <PromoCard onOk={flash} onError={setError} />

      <HeroImageCard onOk={flash} onError={setError} />

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
  const [detail, setDetail] = useState("");
  const [description, setDescription] = useState("");
  const [packageLabel, setPackageLabel] = useState("");
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
          detail: detail.trim(),
          description: description.trim(),
          packageLabel: packageLabel.trim(),
          beforePhotoId: before.id,
          afterPhotoId: after.id,
          sortOrder: pairs?.length ?? 0,
          active: true,
        },
      });
      setLabel("");
      setDetail("");
      setDescription("");
      setPackageLabel("");
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
        The only before/after work shown on the homepage and Results page — there are no stock
        samples behind it any more, so whatever you add here is what visitors see.
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
          <Field label="Subtitle" hint="Optional">
            <input
              className={inputCls}
              value={detail}
              maxLength={80}
              placeholder="Black sedan hood"
              onChange={(e) => setDetail(e.target.value)}
            />
          </Field>
          <Field label="Package used" hint="Optional">
            <input
              className={inputCls}
              value={packageLabel}
              maxLength={40}
              placeholder="Diamond"
              onChange={(e) => setPackageLabel(e.target.value)}
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

      <div className="mt-4">
        <Field label="Description" hint="Optional. The paragraph under this pair on the Results page.">
          <textarea
            className={`${inputCls} min-h-[70px] resize-y`}
            value={description}
            maxLength={600}
            placeholder="Swirl-marked factory black brought back to a wet, mirror-deep gloss."
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
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
                className="overflow-hidden rounded-xl border border-[var(--line-2)] bg-[var(--fill-1)]"
              >
                <div className="grid grid-cols-2">
                  {[p.beforeUrl, p.afterUrl].map((u, i) => (
                    <div key={i} className="relative aspect-[4/3]">
                      {u ? (
                        <img src={u} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full items-center justify-center bg-[var(--fill-2)] text-[10px] text-muted-foreground">
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
        className="relative aspect-[4/3] w-full overflow-hidden rounded-xl border border-dashed border-[var(--line-3)] bg-[var(--fill-1)] transition hover:border-primary/40"
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
        accept="image/*,.heic,.heif"
        className="hidden"
        onChange={(e) => onFile(e.target.files?.[0])}
      />
    </div>
  );
}

// ========================= Hero background ==============================

/**
 * Swap the big photo behind the homepage headline.
 *
 * Downscaled to 1920px before upload — a phone photo is several megabytes and
 * the hero is embedded in the page as a data URL, so the raw file would make
 * the homepage enormous.
 */
function HeroImageCard({
  onOk,
  onError,
}: {
  onOk: (m: string) => void;
  onError: (m: string) => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [videoBusy, setVideoBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const h = await getHeroImage();
      setUrl(h.url);
      setVideoUrl(h.videoUrl);
    } catch {
      setUrl(null);
      setVideoUrl(null);
    }
  }, []);

  // Videos go to their own endpoint as a raw file — too big for base64.
  const sendVideo = async (file: File | null) => {
    setVideoBusy(true);
    try {
      const res = await fetch("/admin/media/hero-video", {
        method: file ? "POST" : "DELETE",
        headers: file ? { "content-type": file.type } : undefined,
        body: file ?? undefined,
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Upload failed.");
      onOk(file ? "Hero video uploaded. It now plays instead of the photo." : "Back to the photo.");
      await load();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setVideoBusy(false);
    }
  };

  useEffect(() => {
    void load();
  }, [load]);

  const pick = async (file: File) => {
    setBusy(true);
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 1920 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Couldn't process that image.");
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close?.();

      const base64 = canvas.toDataURL("image/jpeg", 0.82).split(",")[1] ?? "";
      await setHeroImage({ data: { mime: "image/jpeg", base64 } });
      onOk("Hero image updated. Reload the homepage to see it.");
      await load();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <GlassCard index={3} className="mt-5 p-6">
      <div className="flex items-center gap-2.5">
        <ImageIcon className="h-4 w-4 text-primary" />
        <p className="text-[15px] font-semibold tracking-tight text-foreground">
          Homepage background
        </p>
      </div>
      <p className="mt-1 text-[12.5px] text-muted-foreground">
        The photo or video behind the headline on your front page. A wide, dark shot works best —
        text sits on top of it. If you add a video, it plays instead of the photo.
      </p>

      <div className="mt-5 overflow-hidden rounded-xl border border-[var(--line-2)] bg-[var(--fill-1)]">
        {videoUrl ? (
          <video
            src={videoUrl}
            muted
            loop
            autoPlay
            playsInline
            className="h-44 w-full object-cover"
          />
        ) : url ? (
          <img src={url} alt="Current homepage background" className="h-44 w-full object-cover" />
        ) : (
          <div className="flex h-44 items-center justify-center text-[12.5px] text-muted-foreground">
            Using the bundled photo
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="primary" loading={busy} onClick={() => input.current?.click()}>
          <Upload className="h-3.5 w-3.5" /> {url ? "Replace image" : "Upload image"}
        </Button>
        {url && (
          <Button
            onClick={async () => {
              if (!confirm("Go back to the bundled photo?")) return;
              setBusy(true);
              try {
                await clearHeroImage();
                onOk("Reverted to the bundled photo.");
                await load();
              } finally {
                setBusy(false);
              }
            }}
          >
            Use the default
          </Button>
        )}
        <Button loading={videoBusy} onClick={() => videoInput.current?.click()}>
          <Upload className="h-3.5 w-3.5" /> {videoUrl ? "Replace video" : "Use a video"}
        </Button>
        {videoUrl && (
          <Button
            onClick={() => {
              if (confirm("Remove the video and show the photo?")) void sendVideo(null);
            }}
          >
            Remove video
          </Button>
        )}
      </div>
      <p className="mt-2 text-[12px] text-muted-foreground">
        Video: MP4 or WebM, under 60 MB. It plays muted on a loop, so a short clip works best.
      </p>
      <input
        ref={videoInput}
        type="file"
        accept="video/mp4,video/webm"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void sendVideo(f);
          e.target.value = "";
        }}
      />

      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void pick(f);
          e.target.value = "";
        }}
      />
    </GlassCard>
  );
}

type PromoDraft = {
  promoEnabled: boolean;
  promoPercent: number;
  promoSeasonStart: string;
  promoSeasonEnd: string;
  promoSeasonLabel: string;
  promoBarText: string;
  promoPopupText: string;
};

/** Next-season reservations: the banner, the popup and the discount. */
function PromoCard({ onOk, onError }: { onOk: (m: string) => void; onError: (m: string) => void }) {
  const [p, setP] = useState<PromoDraft | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getAdminSettings()
      .then(({ settings: s }) =>
        setP({
          promoEnabled: s.promoEnabled,
          promoPercent: s.promoPercent,
          promoSeasonStart: s.promoSeasonStart,
          promoSeasonEnd: s.promoSeasonEnd,
          promoSeasonLabel: s.promoSeasonLabel,
          promoBarText: s.promoBarText,
          promoPopupText: s.promoPopupText,
        }),
      )
      .catch(() => undefined);
  }, []);

  if (!p) return null;
  const set = <K extends keyof PromoDraft>(k: K, v: PromoDraft[K]) => setP({ ...p, [k]: v });

  const save = async () => {
    setBusy(true);
    try {
      await savePromo({ data: p });
      onOk("Season reservations saved. Reload the site to see it.");
    } catch (e) {
      onError(e instanceof Error ? e.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <GlassCard index={3} className="mt-5 p-6">
      <div className="flex items-center gap-2.5">
        <Megaphone className="h-4 w-4 text-primary" />
        <p className="text-[15px] font-semibold tracking-tight text-foreground">Season reservations</p>
      </div>
      <p className="mt-1 text-[12.5px] text-muted-foreground">
        Customers can book dates in an upcoming season now, and get a discount automatically. While
        it's on, a banner runs across the top of the site and a one-time popup shows on the homepage.
        Regular bookings keep working as normal.
      </p>

      <div className="mt-5">
        <Toggle
          checked={p.promoEnabled}
          onChange={(v) => set("promoEnabled", v)}
          label="Promotion is live"
          hint="Turn off to hide the banner and popup and stop taking next-season bookings."
        />
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <Field label="Discount (%)">
          <input
            className={inputCls}
            type="number"
            min={0}
            max={90}
            value={p.promoPercent}
            onChange={(e) => set("promoPercent", Number(e.target.value))}
          />
        </Field>
        <Field label="Season name" hint='Shown on the site, e.g. "2027 season".'>
          <input
            className={inputCls}
            value={p.promoSeasonLabel}
            maxLength={40}
            onChange={(e) => set("promoSeasonLabel", e.target.value)}
          />
        </Field>
        <Field label="Season opens" hint="First day customers can reserve.">
          <input
            className={inputCls}
            type="date"
            value={p.promoSeasonStart}
            onChange={(e) => set("promoSeasonStart", e.target.value)}
          />
        </Field>
        <Field label="Season ends" hint="Last day customers can reserve.">
          <input
            className={inputCls}
            type="date"
            value={p.promoSeasonEnd}
            onChange={(e) => set("promoSeasonEnd", e.target.value)}
          />
        </Field>
      </div>

      <div className="mt-4 space-y-4">
        <Field label="Top banner" hint="{percent} and {season} fill in automatically.">
          <input
            className={inputCls}
            value={p.promoBarText}
            maxLength={160}
            onChange={(e) => set("promoBarText", e.target.value)}
          />
        </Field>
        <Field label="Popup message" hint="{percent} and {season} fill in automatically.">
          <textarea
            className={`${inputCls} min-h-[80px] resize-y`}
            value={p.promoPopupText}
            maxLength={400}
            onChange={(e) => set("promoPopupText", e.target.value)}
          />
        </Field>
      </div>

      <Button variant="primary" className="mt-5" loading={busy} onClick={save}>
        Save season reservations
      </Button>
    </GlassCard>
  );
}
