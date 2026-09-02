import { useRef, useState } from "react";
import { ImageUp, Loader2 } from "lucide-react";

import { uploadBrandingImage } from "@/lib/api/admin.functions";

/** Target size per slot. A logo must be square; a share image is 1.91:1. */
const TARGET = {
  favicon: { w: 512, h: 512 },
  emailLogo: { w: 512, h: 512 },
  ogImage: { w: 1200, h: 630 },
} as const;

/**
 * Resize the chosen file to the right shape before uploading.
 *
 * Phone cameras and logo exports run to several megabytes and arbitrary
 * dimensions; an app icon needs to be square and small. The image is fitted
 * INSIDE the target rather than stretched to fill it, so a wide wordmark
 * keeps its proportions instead of being squashed into a square — it just
 * gets transparent space above and below.
 *
 * Done in the browser so a large original never crosses the network, and so
 * the server keeps one small file rather than the 8MP version.
 */
async function normalise(
  file: File,
  slot: keyof typeof TARGET,
): Promise<{ base64: string; mime: string }> {
  const { w, h } = TARGET[slot];
  const bitmap = await createImageBitmap(file);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Couldn't process that image.");

  // Contain: scale to fit, centre what is left over.
  const scale = Math.min(w / bitmap.width, h / bitmap.height);
  const dw = Math.round(bitmap.width * scale);
  const dh = Math.round(bitmap.height * scale);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, Math.round((w - dw) / 2), Math.round((h - dh) / 2), dw, dh);
  bitmap.close?.();

  // PNG throughout: it keeps transparency, which a logo usually depends on,
  // and at icon sizes the file is small either way.
  const dataUrl = canvas.toDataURL("image/png");
  return { base64: dataUrl.split(",")[1] ?? "", mime: "image/png" };
}

/**
 * Upload a branding image and get back a URL on this domain.
 *
 * Sits beside the URL field rather than replacing it: pasting a link still
 * works, and an existing one keeps working. But uploading is the option that
 * doesn't rot — a link copied out of Facebook or Google Photos carries an
 * expiry stamp, and when it lapses the favicon, the installed app icon and
 * the logo on every email break together.
 */
export function BrandingUpload({
  slot,
  onUploaded,
  label = "Upload",
}: {
  slot: "favicon" | "ogImage" | "emailLogo";
  onUploaded: (url: string) => void;
  label?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const { base64, mime } = await normalise(file, slot);
      const res = await uploadBrandingImage({ data: { slot, mime, base64 } });
      onUploaded(res.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <div className="mt-2">
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void pick(file);
        }}
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => input.current?.click()}
        className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--fill-2)] px-3 py-1.5 text-[11.5px] font-semibold text-foreground ring-1 ring-inset ring-[var(--line-2)] transition hover:bg-[var(--fill-3)] disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImageUp className="h-3.5 w-3.5" />}
        {busy ? "Uploading…" : label}
      </button>
      {error && <p className="mt-1.5 text-[11.5px] text-destructive">{error}</p>}
    </div>
  );
}
