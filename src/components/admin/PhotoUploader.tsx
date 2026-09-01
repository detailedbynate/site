import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Camera, Check, ImagePlus, Loader2, Trash2, X } from "lucide-react";

import { deletePhotoById, getPhotos, uploadPhoto } from "@/lib/api/admin.functions";
import {
  Portal, Button, ErrorNote } from "./ui";

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

/**
 * One-tap camera capture for a job, phones only.
 *
 * Sits at the top of an open appointment so the two shots that matter are
 * reachable without scrolling a long panel. `capture="environment"` makes a
 * phone open the rear camera straight away rather than a file picker — the
 * whole point is that you can photograph a car mid-job in one tap.
 *
 * Hidden from `lg` up; on a desktop the normal uploader below is better.
 */
export function QuickPhotoCapture({
  bookingId,
  onUploaded,
}: {
  bookingId: string;
  onUploaded?: () => void;
}) {
  const [busy, setBusy] = useState<"before" | "after" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<"before" | "after" | null>(null);
  const beforeRef = useRef<HTMLInputElement>(null);
  const afterRef = useRef<HTMLInputElement>(null);

  const send = async (kind: "before" | "after", files: FileList | null) => {
    if (!files?.length) return;
    setBusy(kind);
    setError(null);
    try {
      for (const file of Array.from(files).slice(0, 10)) {
        if (!file.type.startsWith("image/")) continue;
        const { base64, mime } = await downscale(file);
        await uploadPhoto({ data: { bookingId, kind, mime, base64 } });
      }
      setDone(kind);
      setTimeout(() => setDone(null), 2000);
      onUploaded?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(null);
    }
  };

  const tile = (kind: "before" | "after", ref: React.RefObject<HTMLInputElement | null>) => (
    <button
      type="button"
      onClick={() => ref.current?.click()}
      disabled={busy !== null}
      className="flex flex-1 flex-col items-center gap-1.5 rounded-xl border border-[var(--line-2)] bg-[var(--fill-2)] px-3 py-4 text-foreground transition active:scale-[0.98] disabled:opacity-50"
    >
      {busy === kind ? (
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      ) : done === kind ? (
        <Check className="h-6 w-6 text-emerald-400" />
      ) : (
        <Camera className="h-6 w-6 text-primary" />
      )}
      <span className="text-[12.5px] font-bold capitalize">
        {done === kind ? "Saved" : kind}
      </span>
    </button>
  );

  return (
    <div className="mb-5 lg:hidden">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        Quick photo
      </p>
      <div className="flex gap-2">
        {tile("before", beforeRef)}
        {tile("after", afterRef)}
      </div>
      {error && <p className="mt-2 text-[11.5px] font-semibold text-destructive">{error}</p>}

      <input
        ref={beforeRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          void send("before", e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={afterRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          void send("after", e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}

export function PhotoUploader({
  bookingId,
  refreshKey = 0,
}: {
  bookingId: string;
  /** Bump to re-read photos after a quick capture. */
  refreshKey?: number;
}) {
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
  }, [bookingId, refreshKey]);

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
        <div className="flex gap-0.5 rounded-lg bg-[var(--fill-2)] p-1 ring-1 ring-inset ring-[var(--line-1)]">
          {groups.map((g) => (
            <button
              key={g.key}
              type="button"
              onClick={() => setKind(g.key)}
              className={`rounded-md px-2.5 py-1 text-[11.5px] font-semibold transition-colors ${
                kind === g.key
                  ? "bg-[var(--fill-3)] text-foreground"
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
                      className="group relative aspect-square overflow-hidden rounded-lg ring-1 ring-inset ring-[var(--line-2)]"
                    >
                      {p.dataUrl ? (
                        <img
                          src={p.dataUrl}
                          alt={p.caption ?? `${g.label} photo`}
                          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center bg-[var(--fill-2)] text-[10px] text-muted-foreground">
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

      <Portal><AnimatePresence>
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
      </AnimatePresence></Portal>
    </div>
  );
}
