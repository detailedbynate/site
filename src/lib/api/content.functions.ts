import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// Editable public-site content: homepage testimonials, and profile pictures
// for staff. Same conventions as the other .functions.ts files.

const idSchema = z.string().min(1).max(60);

// ========================= Testimonials =================================

/** Public — the homepage reads this. No auth, only active rows. */
export const getPublicTestimonials = createServerFn({ method: "GET" }).handler(async () => {
  const { listTestimonials } = await import("../db.server");
  const all = await listTestimonials();
  return {
    testimonials: all
      .filter((t) => t.active)
      .map((t) => ({
        id: t.id,
        name: t.name,
        car: t.vehicle,
        rating: t.rating,
        text: t.text,
      })),
  };
});

export const listAdminTestimonials = createServerFn({ method: "GET" }).handler(async () => {
  const { listTestimonials } = await import("../db.server");
  const { requireUser } = await import("../auth.server");
  await requireUser();
  return { testimonials: await listTestimonials() };
});

export const saveTestimonial = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      id: idSchema.optional(),
      name: z.string().min(1).max(80),
      vehicle: z.string().max(80).default(""),
      rating: z.number().int().min(1).max(5).default(5),
      text: z.string().min(1).max(1000),
      active: z.boolean().default(true),
      sortOrder: z.number().int().min(0).max(999).default(0),
    }),
  )
  .handler(async ({ data }) => {
    const { upsertTestimonial, listTestimonials } = await import("../db.server");
    const { requireUser } = await import("../auth.server");
    const { randomUUID } = await import("node:crypto");
    await requireUser();

    const id = data.id ?? randomUUID();
    const existing = (await listTestimonials()).find((t) => t.id === id);
    return {
      testimonial: await upsertTestimonial({
        ...data,
        id,
        createdAt: existing?.createdAt ?? new Date().toISOString(),
      }),
    };
  });

export const removeTestimonial = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: idSchema }))
  .handler(async ({ data }) => {
    const { deleteTestimonial } = await import("../db.server");
    const { requireUser } = await import("../auth.server");
    await requireUser();
    await deleteTestimonial(data.id);
    return { ok: true };
  });

// =========================== Avatars ====================================

const MIME = z.enum(["image/jpeg", "image/png", "image/webp"]);

/**
 * Upload a profile picture for a staff member or admin account.
 *
 * Staff can only change their own; changing someone else's requires owner.
 * The old photo is deleted so avatars don't accumulate on disk forever.
 */
export const setProfilePicture = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      kind: z.enum(["user", "agent"]),
      id: idSchema,
      mime: MIME,
      /** Bare base64, no data: prefix. */
      base64: z.string().min(1).max(8_000_000),
    }),
  )
  .handler(async ({ data }) => {
    const { addPhoto, deletePhoto, setAvatar, findUserById, findAgentById } = await import(
      "../db.server"
    );
    const { savePhotoFile, deletePhotoFile, isAllowedImage } = await import("../uploads.server");
    const { requireUser } = await import("../auth.server");
    const { randomUUID } = await import("node:crypto");

    const me = await requireUser();
    if (data.kind === "user" && data.id !== me.id && me.role !== "owner") {
      throw new Error("You can only change your own profile picture.");
    }
    if (!isAllowedImage(data.mime)) throw new Error("Only JPEG, PNG and WebP images are allowed.");

    const previous =
      data.kind === "user"
        ? (await findUserById(data.id))?.avatarPhotoId
        : (await findAgentById(data.id))?.avatarPhotoId;

    const photoId = randomUUID();
    const size = await savePhotoFile(photoId, data.mime, data.base64);
    await addPhoto({ id: photoId, kind: "other", mime: data.mime, size });
    await setAvatar(data.kind, data.id, photoId);

    // Clean up the one it replaced — best effort, never fatal.
    if (previous) {
      const removed = await deletePhoto(previous).catch(() => undefined);
      if (removed) await deletePhotoFile(removed.id, removed.mime).catch(() => undefined);
    }

    return { photoId };
  });

export const clearProfilePicture = createServerFn({ method: "POST" })
  .inputValidator(z.object({ kind: z.enum(["user", "agent"]), id: idSchema }))
  .handler(async ({ data }) => {
    const { setAvatar, deletePhoto, findUserById, findAgentById } = await import("../db.server");
    const { deletePhotoFile } = await import("../uploads.server");
    const { requireUser } = await import("../auth.server");

    const me = await requireUser();
    if (data.kind === "user" && data.id !== me.id && me.role !== "owner") {
      throw new Error("You can only change your own profile picture.");
    }

    const current =
      data.kind === "user"
        ? (await findUserById(data.id))?.avatarPhotoId
        : (await findAgentById(data.id))?.avatarPhotoId;

    await setAvatar(data.kind, data.id, null);
    if (current) {
      const removed = await deletePhoto(current).catch(() => undefined);
      if (removed) await deletePhotoFile(removed.id, removed.mime).catch(() => undefined);
    }
    return { ok: true };
  });

/** Data URLs for a set of avatar photo ids, for rendering in the admin. */
export const getAvatars = createServerFn({ method: "POST" })
  .inputValidator(z.object({ photoIds: z.array(idSchema).max(60) }))
  .handler(async ({ data }) => {
    const { findPhoto } = await import("../db.server");
    const { readPhotoDataUrl } = await import("../uploads.server");
    const { requireUser } = await import("../auth.server");
    await requireUser();

    const out: Record<string, string> = {};
    for (const id of data.photoIds) {
      const photo = await findPhoto(id);
      if (!photo) continue;
      const url = await readPhotoDataUrl(id, photo.mime);
      if (url) out[id] = url;
    }
    return { avatars: out };
  });

// ============================= FAQs =====================================

/** Public — the homepage reads this. Active entries only. */
export const getPublicFaqs = createServerFn({ method: "GET" }).handler(async () => {
  const { listFaqs } = await import("../db.server");
  const all = await listFaqs();
  return {
    faqs: all.filter((f) => f.active).map((f) => ({ id: f.id, q: f.question, a: f.answer })),
  };
});

export const listAdminFaqs = createServerFn({ method: "GET" }).handler(async () => {
  const { listFaqs } = await import("../db.server");
  const { requireUser } = await import("../auth.server");
  await requireUser();
  return { faqs: await listFaqs() };
});

export const saveFaq = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      id: idSchema.optional(),
      question: z.string().min(1).max(200),
      answer: z.string().min(1).max(2000),
      active: z.boolean().default(true),
      sortOrder: z.number().int().min(0).max(999).default(0),
    }),
  )
  .handler(async ({ data }) => {
    const { upsertFaq, listFaqs } = await import("../db.server");
    const { requireUser } = await import("../auth.server");
    const { randomUUID } = await import("node:crypto");
    await requireUser();

    const id = data.id ?? randomUUID();
    const existing = (await listFaqs()).find((f) => f.id === id);
    return {
      faq: await upsertFaq({
        ...data,
        id,
        createdAt: existing?.createdAt ?? new Date().toISOString(),
      }),
    };
  });

export const removeFaq = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: idSchema }))
  .handler(async ({ data }) => {
    const { deleteFaq } = await import("../db.server");
    const { requireUser } = await import("../auth.server");
    await requireUser();
    await deleteFaq(data.id);
    return { ok: true };
  });

// ========================= Hero background ==============================

/**
 * Replace the homepage hero background.
 *
 * Stored as a normal photo row and served as a data URL, the same way the
 * gallery works. The previous hero is deleted so old backgrounds don't
 * accumulate on disk.
 */
export const setHeroImage = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      mime: z.enum(["image/jpeg", "image/png", "image/webp"]),
      base64: z.string().min(1).max(8_000_000),
    }),
  )
  .handler(async ({ data }) => {
    const { addPhoto, deletePhoto, getSettings, updateSettings } = await import("../db.server");
    const { savePhotoFile, deletePhotoFile } = await import("../uploads.server");
    const { requireUser } = await import("../auth.server");
    const { randomUUID } = await import("node:crypto");
    await requireUser();

    const settings = await getSettings();
    const previous = settings.heroPhotoId;

    const photoId = randomUUID();
    const size = await savePhotoFile(photoId, data.mime, data.base64);
    await addPhoto({ id: photoId, kind: "other", mime: data.mime, size });
    await updateSettings({ heroPhotoId: photoId });

    if (previous) {
      const removed = await deletePhoto(previous).catch(() => undefined);
      if (removed) await deletePhotoFile(removed.id, removed.mime).catch(() => undefined);
    }
    return { photoId };
  });

export const clearHeroImage = createServerFn({ method: "POST" }).handler(async () => {
  const { getSettings, updateSettings, deletePhoto } = await import("../db.server");
  const { deletePhotoFile } = await import("../uploads.server");
  const { requireUser } = await import("../auth.server");
  await requireUser();

  const { heroPhotoId } = await getSettings();
  await updateSettings({ heroPhotoId: "" });
  if (heroPhotoId) {
    const removed = await deletePhoto(heroPhotoId).catch(() => undefined);
    if (removed) await deletePhotoFile(removed.id, removed.mime).catch(() => undefined);
  }
  return { ok: true };
});

/**
 * Everything the homepage hero needs: the background, the headline, and the
 * counters. One call so the loader isn't making four round trips for one
 * section. Public — no auth.
 */
export const getHeroImage = createServerFn({ method: "GET" }).handler(async () => {
  const { getSettings, findPhoto } = await import("../db.server");
  const { readPhotoDataUrl } = await import("../uploads.server");

  const s = await getSettings();
  let url: string | null = null;
  if (s.heroPhotoId) {
    const photo = await findPhoto(s.heroPhotoId);
    if (photo) url = await readPhotoDataUrl(photo.id, photo.mime);
  }

  return {
    url,
    headline: s.heroHeadline,
    headlineAccent: s.heroHeadlineAccent,
    subtext: s.heroSubtext,
    statClients: s.statClients,
    statVehicles: s.statVehicles,
  };
});
