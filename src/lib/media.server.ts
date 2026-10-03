import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";

// The homepage hero video. Handled in server.ts, before the router, because
// a video is far too large to send through a server function as base64:
//
//   POST   /admin/media/hero-video   raw file body, signed-in admins only
//   DELETE /admin/media/hero-video   back to the photo
//   GET    /media/<id>               streamed, with Range support (Safari
//                                    won't play a video without it)

/** Big enough for a short phone clip; long videos belong on YouTube. */
const MAX_VIDEO_BYTES = 60 * 1024 * 1024;

async function signedIn(request: Request): Promise<boolean> {
  const { SESSION_COOKIE } = await import("./auth.server");
  const cookie = request.headers.get("cookie") ?? "";
  const token = cookie
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
  if (!token) return false;
  const { findSession, findUserById } = await import("./db.server");
  const session = await findSession(decodeURIComponent(token));
  return Boolean(session && (await findUserById(session.userId)));
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export async function heroVideoResponse(request: Request, url: URL): Promise<Response | null> {
  if (url.pathname === "/admin/media/hero-video") {
    if (request.method !== "POST" && request.method !== "DELETE") return null;
    if (!(await signedIn(request))) return json({ error: "Please sign in again." }, 401);

    const { addPhoto, deletePhoto, getSettings, updateSettings } = await import("./db.server");
    const { saveVideoFile, deletePhotoFile } = await import("./uploads.server");
    const previous = (await getSettings()).heroVideoId;

    let videoId = "";
    if (request.method === "POST") {
      const mime = (request.headers.get("content-type") ?? "").split(";")[0]!.trim();
      if (mime !== "video/mp4" && mime !== "video/webm") {
        return json({ error: "Upload an MP4 or WebM video." }, 400);
      }
      const declared = Number(request.headers.get("content-length") ?? 0);
      if (declared > MAX_VIDEO_BYTES) return json({ error: "Keep the video under 60 MB." }, 413);
      const bytes = new Uint8Array(await request.arrayBuffer());
      if (bytes.byteLength > MAX_VIDEO_BYTES) return json({ error: "Keep the video under 60 MB." }, 413);

      const { randomUUID } = await import("node:crypto");
      videoId = randomUUID();
      try {
        const size = await saveVideoFile(videoId, mime, bytes);
        await addPhoto({ id: videoId, kind: "other", mime, size });
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : "Upload failed." }, 400);
      }
    }

    await updateSettings({ heroVideoId: videoId });
    if (previous) {
      const removed = await deletePhoto(previous).catch(() => undefined);
      if (removed) await deletePhotoFile(removed.id, removed.mime).catch(() => undefined);
    }
    return json({ videoUrl: videoId ? `/media/${videoId}` : null });
  }

  const match = /^\/media\/([0-9a-f-]{36})$/i.exec(url.pathname);
  if (!match || (request.method !== "GET" && request.method !== "HEAD")) return null;
  const id = match[1]!;

  // Only the current hero video is public, never other uploads by id.
  const { getSettings, findPhoto } = await import("./db.server");
  if ((await getSettings()).heroVideoId !== id) return null;
  const photo = await findPhoto(id);
  if (!photo) return null;

  const { uploadPath } = await import("./uploads.server");
  const file = uploadPath(id, photo.mime);
  const size = (await stat(file).catch(() => null))?.size;
  if (!size) return null;

  const headers: Record<string, string> = {
    "content-type": photo.mime,
    "accept-ranges": "bytes",
    "cache-control": "public, max-age=31536000, immutable",
  };

  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("range") ?? "");
  let start = 0;
  let end = size - 1;
  let status = 200;
  if (range) {
    if (range[1]) {
      start = Number(range[1]);
      if (range[2]) end = Math.min(Number(range[2]), size - 1);
    } else if (range[2]) {
      start = Math.max(0, size - Number(range[2]));
    }
    if (start > end || start >= size) {
      return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
    }
    status = 206;
    headers["content-range"] = `bytes ${start}-${end}/${size}`;
  }
  headers["content-length"] = String(end - start + 1);

  if (request.method === "HEAD") return new Response(null, { status, headers });
  const stream = Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream;
  return new Response(stream, { status, headers });
}
