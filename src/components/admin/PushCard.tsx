import { useCallback, useEffect, useState } from "react";
import { AnimatePresence } from "motion/react";
import { Bell, BellOff, Plus, Share, Smartphone } from "lucide-react";

import {
  getPushStatus,
  savePushEvents,
  sendTestPush,
  subscribePush,
  unsubscribePush,
} from "@/lib/api/push.functions";
import { Button, ErrorNote, GlassCard, SuccessNote, Toggle } from "./ui";

/*
  Phone notifications (Web Push).

  On an iPhone this only works for a web app ADDED TO THE HOME SCREEN and
  opened from there (iOS 16.4+) — Safari in a normal tab has no Push API at
  all. So the card's first job is to recognise that case and walk the owner
  through it in three steps, rather than showing a button that can't work.
*/

type Status = Awaited<ReturnType<typeof getPushStatus>>;
type Support = "ok" | "ios-not-installed" | "unsupported";

const EVENTS: { id: string; label: string; hint: string }[] = [
  { id: "booking_created", label: "New bookings", hint: "Who, which package, when and the price." },
  { id: "booking_cancelled", label: "Cancellations", hint: "When a customer cancels from their link." },
  { id: "booking_rescheduled", label: "Reschedules", hint: "With the new day and time." },
  {
    id: "own_changes",
    label: "My own changes too",
    hint: "Also buzz for bookings and cancellations you make yourself in the admin.",
  },
];

function detectSupport(): Support {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const hasPush = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  if (ios && !standalone) return "ios-not-installed";
  return hasPush ? "ok" : "unsupported";
}

function deviceLabel(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) return "iPad";
  if (/Android/.test(ua)) return "Android phone";
  if (/Mac/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows PC";
  return "This device";
}

/** The VAPID public key as the bytes pushManager.subscribe wants. */
function keyBytes(b64url: string): Uint8Array {
  const pad = "=".repeat((4 - (b64url.length % 4)) % 4);
  const raw = atob((b64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/**
 * The admin's worker registration, once its worker is ACTIVE.
 *
 * Deliberately not `navigator.serviceWorker.ready`. That promise matches the
 * registration against the URL the page was first OPENED at, and the Home
 * Screen app opens at /admin — outside the worker's /admin/ scope. Reaching
 * Settings by tapping a link doesn't change that, so `ready` never resolved:
 * "Turn on" asked for permission, then hung forever without subscribing.
 * That was why notifications never arrived. Waiting on the registration's
 * own worker works wherever the page was opened.
 */
async function registration(): Promise<ServiceWorkerRegistration> {
  const reg =
    (await navigator.serviceWorker.getRegistration("/admin/")) ??
    (await navigator.serviceWorker.register("/admin/sw.js", { scope: "/admin/" }));
  if (reg.active) return reg;
  const worker = reg.installing ?? reg.waiting;
  if (!worker) throw new Error("The app's background worker isn't available. Close the app fully and reopen it.");
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("The app's background worker didn't start. Close the app fully and reopen it.")),
      15000,
    );
    worker.addEventListener("statechange", () => {
      if (worker.state === "activated") {
        clearTimeout(timer);
        resolve();
      }
    });
  });
  return reg;
}

export function PushCard() {
  const [support, setSupport] = useState<Support | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const load = useCallback(async () => {
    const sup = detectSupport();
    setSupport(sup);
    let ep: string | undefined;
    if (sup === "ok") {
      setPermission(Notification.permission);
      const reg = await navigator.serviceWorker.getRegistration("/admin/").catch(() => undefined);
      // Make the phone fetch the newest worker now. An app installed before
      // notifications existed can still be running a worker with no push
      // handler — it then receives pushes and silently shows nothing.
      void reg?.update().catch(() => undefined);
      ep = (await reg?.pushManager.getSubscription().catch(() => null))?.endpoint;
    }
    setEndpoint(ep ?? null);
    setStatus(await getPushStatus({ data: { endpoint: ep } }));
  }, []);

  useEffect(() => {
    load().catch((e) => setError(e instanceof Error ? e.message : "Couldn't load notifications."));
  }, [load]);

  const flash = (m: string) => {
    setOk(m);
    setTimeout(() => setOk(null), 4000);
  };

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  };

  const turnOn = () =>
    run("on", async () => {
      // Must be called straight from the tap — browsers refuse the prompt otherwise.
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result !== "granted") throw new Error("Notifications weren't allowed on this device.");
      const reg = await registration();
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: keyBytes(status!.publicKey) as BufferSource,
        }));
      const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
      await subscribePush({ data: { endpoint: json.endpoint, keys: json.keys, label: deviceLabel() } });
      await load();
      flash("Notifications are on for this device. Send a test to see one.");
    });

  const turnOff = () =>
    run("off", async () => {
      const reg = await navigator.serviceWorker.getRegistration("/admin/");
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await unsubscribePush({ data: { endpoint: sub.endpoint } });
        await sub.unsubscribe().catch(() => undefined);
      }
      await load();
      flash("Notifications are off for this device.");
    });

  const test = () =>
    run("test", async () => {
      await sendTestPush({ data: { endpoint: endpoint! } });
      await load();
      flash(
        "Apple/Google accepted it — it should appear within a few seconds. If it doesn't, check Focus / Do Not Disturb and Settings → Notifications for this app.",
      );
    });

  /*
    Splits "nothing arrives" in half. This shows a notification straight from
    the phone — no server, no Apple. If even this doesn't appear, the cause is
    on the phone (Focus, or Settings → Notifications for the app); if it does
    and "Send a test" doesn't, the cause is delivery, which the device list
    below reports.
  */
  const localTest = () =>
    run("local", async () => {
      const reg = await registration();
      await reg.showNotification("Test from this phone", {
        body: "If you can see this, your phone allows notifications from the admin.",
        tag: "local-test",
        icon: "/admin/icon",
      });
      flash("Shown on this phone. If you didn't see it, check Focus and Settings → Notifications for the app.");
    });

  /** Throw away this device's subscription and make a fresh one. */
  const repair = () =>
    run("repair", async () => {
      const reg = await registration();
      await reg.update().catch(() => undefined);
      const old = await reg.pushManager.getSubscription();
      if (old) {
        await unsubscribePush({ data: { endpoint: old.endpoint } }).catch(() => undefined);
        await old.unsubscribe().catch(() => undefined);
      }
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyBytes(status!.publicKey) as BufferSource,
      });
      const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
      await subscribePush({ data: { endpoint: json.endpoint, keys: json.keys, label: deviceLabel() } });
      await load();
      flash("Re-registered. Now tap Send a test.");
    });

  const toggleEvent = (id: string, on: boolean) =>
    run(`ev-${id}`, async () => {
      const events = on ? [...new Set([...(status?.events ?? []), id])] : (status?.events ?? []).filter((e) => e !== id);
      setStatus((s) => (s ? { ...s, events } : s));
      await savePushEvents({
        data: {
          events: events as ("booking_created" | "booking_cancelled" | "booking_rescheduled" | "own_changes")[],
        },
      });
    });

  const on = Boolean(status?.thisDevice && permission === "granted");

  return (
    <GlassCard index={1} className="p-6">
      <div className="flex items-center gap-2.5">
        <Bell className="h-4 w-4 text-primary" />
        <p className="text-[15px] font-semibold tracking-tight text-foreground">Phone notifications</p>
        {on && (
          <span className="ml-auto rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-500">
            On
          </span>
        )}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        A buzz on your lock screen the moment a customer books, cancels or moves a job online.
        Bookings you make yourself in the admin don't notify unless you turn on "My own changes too".
      </p>

      <AnimatePresence>
        {error && <ErrorNote>{error}</ErrorNote>}
        {ok && <SuccessNote>{ok}</SuccessNote>}
      </AnimatePresence>

      {support === "ios-not-installed" && (
        <div className="mt-5 rounded-2xl border border-[var(--line-2)] bg-[var(--fill-1)] p-4">
          <p className="text-[13px] font-semibold text-foreground">On iPhone, add the admin to your Home Screen first</p>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Apple only allows notifications from web apps opened from the Home Screen (iOS 16.4 or later).
          </p>
          <ol className="mt-3 space-y-2.5 text-[13px] text-foreground">
            <li className="flex items-center gap-2.5">
              <Step n={1} />
              Tap <Share className="inline h-4 w-4 text-primary" /> <strong className="font-semibold">Share</strong> in
              Safari
            </li>
            <li className="flex items-center gap-2.5">
              <Step n={2} />
              Choose <Plus className="inline h-4 w-4 text-primary" />{" "}
              <strong className="font-semibold">Add to Home Screen</strong>
            </li>
            <li className="flex items-center gap-2.5">
              <Step n={3} />
              Open <Smartphone className="inline h-4 w-4 text-primary" /> the new icon, come back here, tap Turn on
            </li>
          </ol>
        </div>
      )}

      {support === "unsupported" && (
        <p className="mt-5 rounded-2xl border border-[var(--line-2)] bg-[var(--fill-1)] p-4 text-[12.5px] text-muted-foreground">
          This browser can't receive notifications. Use Chrome, Edge, Firefox or Safari 16+, or the admin app on
          your phone.
        </p>
      )}

      {support === "ok" && status && (
        <div className="mt-5 space-y-5">
          {permission === "denied" ? (
            <p className="rounded-2xl border border-amber-400/30 bg-amber-400/[0.07] p-4 text-[12.5px] leading-relaxed text-foreground">
              Notifications are blocked for this app. On iPhone: <strong>Settings → Notifications</strong>, find the
              admin app and allow them. In a browser: the site settings next to the address bar.
            </p>
          ) : on ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" loading={busy === "test"} onClick={test}>
                <Bell className="h-3.5 w-3.5" /> Send a test
              </Button>
              <Button loading={busy === "local"} onClick={localTest}>
                Test this phone only
              </Button>
              <Button loading={busy === "repair"} onClick={repair}>
                Re-register this device
              </Button>
              <Button loading={busy === "off"} onClick={turnOff}>
                <BellOff className="h-3.5 w-3.5" /> Turn off on this device
              </Button>
            </div>
          ) : (
            <Button variant="primary" loading={busy === "on"} onClick={turnOn}>
              <Bell className="h-3.5 w-3.5" /> Turn on for this device
            </Button>
          )}

          <div className="space-y-3.5 border-t border-[var(--line-1)] pt-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Notify me about</p>
            {EVENTS.map((e) => (
              <Toggle
                key={e.id}
                checked={status.events.includes(e.id)}
                onChange={(v) => toggleEvent(e.id, v)}
                label={e.label}
                hint={e.hint}
              />
            ))}
          </div>

          {/* Every registered device and how its last delivery went — so a
              failure says what happened instead of looking like silence. */}
          {status.devices.length > 0 && (
            <div className="space-y-2 border-t border-[var(--line-1)] pt-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Devices ({status.devices.length})
              </p>
              {status.devices.map((d, i) => (
                <div key={i} className="rounded-xl border border-[var(--line-2)] bg-[var(--fill-1)] px-3 py-2.5">
                  <p className="flex items-center gap-2 text-[12.5px] font-semibold text-foreground">
                    <span
                      className={`h-2 w-2 rounded-full ${d.lastError ? "bg-amber-400" : d.lastOkAt ? "bg-emerald-500" : "bg-[var(--fill-3)]"}`}
                    />
                    {d.label || "Device"}
                    {d.isThis && <span className="font-normal text-muted-foreground">· this device</span>}
                  </p>
                  <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                    {d.lastError
                      ? `Last attempt failed ${new Date(d.lastErrorAt!).toLocaleString()}: ${d.lastError}`
                      : d.lastOkAt
                        ? `Last delivered ${new Date(d.lastOkAt).toLocaleString()}`
                        : `Added ${new Date(d.createdAt).toLocaleDateString()} · nothing sent yet`}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </GlassCard>
  );
}

function Step({ n }: { n: number }) {
  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[11.5px] font-bold text-primary">
      {n}
    </span>
  );
}
