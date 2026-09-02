import { useRef, useState } from "react";
import { ImageUp, Loader2 } from "lucide-react";

import { uploadBrandingImage } from "@/lib/api/admin.functions";

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
      // Read as base64 — the same path the other uploads in this admin use,
      // so there is one upload mechanism rather than two.
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("Couldn't read that file."));
        reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
        reader.readAsDataURL(file);
      });

      const res = await uploadBrandingImage({ data: { slot, mime: file.type, base64 } });
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
