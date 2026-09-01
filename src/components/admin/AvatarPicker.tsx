import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { Camera, Loader2, Trash2 } from "lucide-react";

import { clearProfilePicture, getAvatars, setProfilePicture } from "@/lib/api/content.functions";

/**
 * Profile picture control. Falls back to initials when there's no photo,
 * which is what every account looks like until one is added.
 *
 * Images are downscaled in the browser before upload — a phone photo is
 * several megabytes, and an avatar is displayed at 40px.
 */
async function downscale(
  file: File,
  max = 320,
): Promise<{ base64: string; mime: "image/jpeg" }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Couldn't process that image.");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();

  // Always re-encoded as JPEG, whatever went in — one format to store, and
  // it strips any EXIF the original carried.
  const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  return { base64: dataUrl.split(",")[1] ?? "", mime: "image/jpeg" as const };
}

export function AvatarPicker({
  kind,
  id,
  name,
  photoId,
  size = 64,
  color,
  onChange,
}: {
  kind: "user" | "agent";
  id: string;
  name: string;
  photoId?: string;
  size?: number;
  /** Background for the initials fallback (agents have their own colour). */
  color?: string;
  onChange: () => Promise<void> | void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    if (!photoId) {
      setUrl(null);
      return;
    }
    getAvatars({ data: { photoIds: [photoId] } })
      .then((r) => !cancelled && setUrl(r.avatars[photoId] ?? null))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [photoId]);

  const initials =
    name
      .split(" ")
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase() || "?";

  const upload = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const { base64, mime } = await downscale(file);
      await setProfilePicture({ data: { kind, id, mime, base64 } });
      await onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-3">
      <motion.button
        type="button"
        whileHover={{ scale: 1.04 }}
        whileTap={{ scale: 0.97 }}
        onClick={() => input.current?.click()}
        aria-label={url ? "Change profile picture" : "Add a profile picture"}
        className="group relative shrink-0 overflow-hidden rounded-full ring-1 ring-inset ring-[var(--line-2)]"
        style={{
          width: size,
          height: size,
          ...(url ? {} : color ? { backgroundColor: color } : { backgroundImage: "var(--gradient-brand)" }),
        }}
      >
        {url ? (
          <img src={url} alt="" className="h-full w-full object-cover" />
        ) : (
          <span
            className="flex h-full w-full items-center justify-center font-bold text-primary-foreground"
            style={{ fontSize: size / 2.6 }}
          >
            {initials}
          </span>
        )}
        <span className="absolute inset-0 flex items-center justify-center bg-black/55 opacity-0 transition-opacity group-hover:opacity-100">
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin text-white" />
          ) : (
            <Camera className="h-4 w-4 text-white" />
          )}
        </span>
      </motion.button>

      <div className="min-w-0">
        <button
          type="button"
          onClick={() => input.current?.click()}
          className="block text-[12.5px] font-semibold text-primary hover:underline"
        >
          {url ? "Change photo" : "Add a photo"}
        </button>
        {url && (
          <button
            type="button"
            onClick={async () => {
              setBusy(true);
              try {
                await clearProfilePicture({ data: { kind, id } });
                await onChange();
              } finally {
                setBusy(false);
              }
            }}
            className="mt-0.5 flex items-center gap-1 text-[11.5px] text-muted-foreground transition hover:text-destructive"
          >
            <Trash2 className="h-3 w-3" /> Remove
          </button>
        )}
        {!url && (
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Falls back to initials. JPEG, PNG or WebP.
          </p>
        )}
        {error && <p className="mt-1 text-[11px] font-semibold text-destructive">{error}</p>}
      </div>

      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void upload(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}
