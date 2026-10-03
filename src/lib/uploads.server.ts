import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

// Photo storage. Images live as real files under data/uploads/ rather than
// as base64 inside store.json — a handful of car photos would bloat the JSON
// past the point where reading it on every request is sane.
//
// The client downscales before upload (see PhotoUploader), so these are
// typically 150-400 KB each.

const UPLOAD_DIR = path.join(process.cwd(), "data", "uploads");

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/webm": "webm",
};

export function isAllowedImage(mime: string): boolean {
  return mime in EXT && mime.startsWith("image/");
}

function filenameFor(id: string, mime: string): string {
  return path.join(UPLOAD_DIR, `${id}.${EXT[mime] ?? "bin"}`);
}

/** Accepts a bare base64 payload (no data: prefix) and writes it to disk. */
export async function savePhotoFile(
  id: string,
  mime: string,
  base64: string,
): Promise<number> {
  if (!isAllowedImage(mime)) throw new Error("Only JPEG, PNG and WebP images are allowed.");

  const buffer = Buffer.from(base64, "base64");
  if (buffer.byteLength === 0) throw new Error("That file appears to be empty.");
  if (buffer.byteLength > MAX_UPLOAD_BYTES) {
    throw new Error("That image is too large — keep it under 4 MB.");
  }

  await mkdir(UPLOAD_DIR, { recursive: true });
  await writeFile(filenameFor(id, mime), buffer);
  return buffer.byteLength;
}

/** Returns a data: URL for rendering in the admin. */
export async function readPhotoDataUrl(id: string, mime: string): Promise<string | null> {
  try {
    const buffer = await readFile(filenameFor(id, mime));
    return `data:${mime};base64,${buffer.toString("base64")}`;
  } catch {
    return null;
  }
}

export async function deletePhotoFile(id: string, mime: string): Promise<void> {
  await unlink(filenameFor(id, mime)).catch(() => undefined);
}

/** Writes an uploaded video as-is. Size is checked by the caller. */
export async function saveVideoFile(id: string, mime: string, bytes: Uint8Array): Promise<number> {
  if (mime !== "video/mp4" && mime !== "video/webm") throw new Error("Only MP4 and WebM videos are allowed.");
  if (bytes.byteLength === 0) throw new Error("That file appears to be empty.");
  await mkdir(UPLOAD_DIR, { recursive: true });
  await writeFile(filenameFor(id, mime), bytes);
  return bytes.byteLength;
}

/** Absolute path of a stored file, for streaming. */
export function uploadPath(id: string, mime: string): string {
  return filenameFor(id, mime);
}

/** Raw bytes for serving over HTTP. Null when the file is missing. */
export async function readPhotoBytes(id: string, mime: string): Promise<Buffer | null> {
  try {
    return await readFile(filenameFor(id, mime));
  } catch {
    return null;
  }
}
