import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ImagePlus, Loader2, Trash2, X } from "lucide-react";

import { deletePhotoById, getPhotos, uploadPhoto } from "@/lib/api/admin.functions";
import { Button, ErrorNote } from "./ui";

type Photo = Awaited<ReturnType<typeof getPhotos>>["photos"][number];

/**
 * Downscale in the browser before upload. A modern phone photo is 4-8 MB;
 * shrinking to 1600px / JPEG 0.82 gets that to ~250 KB with no visible loss
 * at the sizes these are ever viewed, and keeps the request small.
 */
type UploadMime = "image/jpeg" | "image/png" | "image/webp";

async function downscale(
  file: File,
  maxEdge = 1600,
): Promise<{ base64: string; mime: UploadMime }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not process that image.");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();

  const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
  return { base64: dataUrl.split(",")[1] ?? "", mime: "image/jpeg" as const };
}

export function PhotoUploader({ bookingId }: { bookingId: string }) {
  const [photos, setPhotos] = useState<Photo[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<"before" | "after" | "other">("before");
  const [lightbox, setLightbox] = useState<Photo | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    try {
      const res = await getPhotos({ data: { bookingId } });
      setPhotos(res.photos);
    } catch {
      setPhotos([]);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingId]);

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    setError(null);
    try {
      for (const file of Array.from(files).slice(0, 10)) {
        if (!file.type.startsWith("image/")) continue;
        const { base64, mime } = await downscale(file);
        await uploadPhoto({ data: { bookingId, kind, mime, base64 } });
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const remove = async (id: string) => {
    setError(null);
    try {
      await deletePhotoById({ data: { id } });
      setLightbox(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't delete.");
    }
  };

  const groups: { key: Photo["kind"]; label: string }[] = [
    { key: "before", label: "Before" },
    { key: "after", label: "After" },
    { key: "other", label: "Other" },
  ];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex gap-0.5 rounded-lg bg-white/[0.04] p-1 ring-1 ring-inset ring-white/[0.06]">
          {groups.map((g) => (
            <button
              key={g.key}
              type="button"
              onClick={() => setKind(g.key)}
              className={`rounded-md px-2.5 py-1 text-[11.5px] font-semibold transition-colors ${
                kind === g.key
                  ? "bg-white/[0.09] text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {g.label}
            </button>
          ))}
        </div>

        <Button size="sm" loading={busy} onClick={() => inputRef.current?.click()}>
          <ImagePlus className="h-3.5 w-3.5" /> Add {kind}
        </Button>

        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => onFiles(e.target.files)}
        />
      </div>

      <AnimatePresence>{error && <ErrorNote>{error}</ErrorNote>}</AnimatePresence>

      {photos === null ? (
        <div className="flex items-center gap-2 py-3 text-[12.5px] text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading photos…
        </div>
      ) : photos.length === 0 ? (
        <p className="py-2 text-[12.5px] text-muted-foreground">
          No photos yet. Before/after shots are great for reviews and disputes.
        </p>
      ) : (
        <div className="space-y-3">
          {groups.map((g) => {
            const list = photos.filter((p) => p.kind === g.key);
            if (!list.length) return null;
            return (
              <div key={g.key}>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  {g.label} ({list.length})
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {list.map((p) => (
                    <motion.button
                      key={p.id}
                      type="button"
                      layout
                      initial={{ opacity: 0, scale: 0.94 }}
                      animate={{ opacity: 1, scale: 1 }}
                      whileHover={{ y: -2 }}
                      onClick={() => setLightbox(p)}
                      className="group relative aspect-square overflow-hidden rounded-lg ring-1 ring-inset ring-white/[0.08]"
                    >
                      {p.dataUrl ? (
                        <img
                          src={p.dataUrl}
                          alt={p.caption ?? `${g.label} photo`}
                          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center bg-white/[0.04] text-[10px] text-muted-foreground">
                          missing
                        </div>
                      )}
                    </motion.button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <AnimatePresence>
        {lightbox && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setLightbox(null)}
            className="fixed inset-0 z-[70] flex items-center justify-center bg-black/85 p-6 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.94 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.96 }}
              onClick={(e) => e.stopPropagation()}
              className="relative max-h-full max-w-3xl"
            >
              {lightbox.dataUrl && (
                <img
                  src={lightbox.dataUrl}
                  alt={lightbox.caption ?? "Vehicle photo"}
                  className="max-h-[80vh] rounded-xl object-contain"
                />
              )}
              <div className="mt-3 flex items-center justify-between gap-3">
                <span className="text-[12px] capitalize text-white/70">
                  {lightbox.kind} · {Math.round(lightbox.size / 1024)} KB
                </span>
                <div className="flex gap-2">
                  <Button size="sm" variant="danger" onClick={() => remove(lightbox.id)}>
                    <Trash2 className="h-3.5 w-3.5" /> Delete
                  </Button>
                  <Button size="sm" onClick={() => setLightbox(null)}>
                    <X className="h-3.5 w-3.5" /> Close
                  </Button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
