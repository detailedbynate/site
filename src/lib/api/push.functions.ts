import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// --------------------------------------------------------------------------
// Phone notifications (Web Push) for the admin. Every function is behind
// requireUser(); the server-only pieces are imported inside the handlers, per
// the convention in booking.functions.ts, so node:crypto never reaches the
// browser bundle.
// --------------------------------------------------------------------------

const EVENTS = ["booking_created", "booking_cancelled", "booking_rescheduled", "own_changes"] as const;

/** What the Settings card needs: the public key, this device's state, the toggles. */
export const getPushStatus = createServerFn({ method: "POST" })
  .inputValidator(z.object({ endpoint: z.string().max(1000).optional() }))
  .handler(async ({ data }) => {
    const { requireUser } = await import("../auth.server");
    await requireUser();
    const { vapidKeys } = await import("../push.server");
    const { listPushSubscriptions, getSettings } = await import("../db.server");
    const [keys, subs, settings] = await Promise.all([vapidKeys(), listPushSubscriptions(), getSettings()]);
    return {
      publicKey: keys.publicKey,
      thisDevice: Boolean(data.endpoint && subs.some((s) => s.endpoint === data.endpoint)),
      devices: subs.map((s) => ({
        label: s.label,
        createdAt: s.createdAt,
        lastOkAt: s.lastOkAt ?? null,
        lastError: s.lastError ?? null,
        lastErrorAt: s.lastErrorAt ?? null,
        isThis: s.endpoint === data.endpoint,
      })),
      events: settings.pushEvents ?? [],
    };
  });

export const subscribePush = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      endpoint: z.string().url().max(1000),
      keys: z.object({ p256dh: z.string().min(40).max(200), auth: z.string().min(10).max(100) }),
      label: z.string().max(80).default(""),
    }),
  )
  .handler(async ({ data }) => {
    const { requireUser } = await import("../auth.server");
    const user = await requireUser();
    const { isAllowedEndpoint } = await import("../push.server");
    if (!isAllowedEndpoint(data.endpoint)) {
      throw new Error("That browser's push service isn't supported.");
    }
    const { savePushSubscription } = await import("../db.server");
    await savePushSubscription({
      endpoint: data.endpoint,
      p256dh: data.keys.p256dh,
      auth: data.keys.auth,
      userId: user.id,
      label: data.label,
    });
    return { ok: true };
  });

export const unsubscribePush = createServerFn({ method: "POST" })
  .inputValidator(z.object({ endpoint: z.string().max(1000) }))
  .handler(async ({ data }) => {
    const { requireUser } = await import("../auth.server");
    await requireUser();
    const { deletePushSubscription } = await import("../db.server");
    await deletePushSubscription(data.endpoint);
    return { ok: true };
  });

/** Send a test to this device, so the owner sees it work end to end. */
export const sendTestPush = createServerFn({ method: "POST" })
  .inputValidator(z.object({ endpoint: z.string().max(1000) }))
  .handler(async ({ data }) => {
    const { requireUser } = await import("../auth.server");
    await requireUser();
    const { listPushSubscriptions } = await import("../db.server");
    const sub = (await listPushSubscriptions()).find((s) => s.endpoint === data.endpoint);
    if (!sub) throw new Error("This device isn't registered. Turn notifications on first.");
    const { sendToOne } = await import("../push.server");
    const result = await sendToOne(sub, {
      title: "Notifications are on",
      body: "You'll get a buzz here for new bookings, cancellations and reschedules.",
      url: "/admin/calendar",
      tag: "test",
    });
    if (result.result === "gone") {
      throw new Error(`This device's subscription has expired (${result.detail}). Turn notifications on again.`);
    }
    if (result.result === "failed") {
      // Say exactly what the push service answered — that is what turns
      // "it doesn't work" into something fixable.
      const host = new URL(sub.endpoint).hostname;
      throw new Error(`${host} refused the message: ${result.detail}`);
    }
    return { ok: true, detail: result.detail };
  });

export const savePushEvents = createServerFn({ method: "POST" })
  .inputValidator(z.object({ events: z.array(z.enum(EVENTS)).max(EVENTS.length) }))
  .handler(async ({ data }) => {
    const { requireUser } = await import("../auth.server");
    await requireUser();
    const { updateSettings } = await import("../db.server");
    await updateSettings({ pushEvents: data.events });
    return { ok: true };
  });
