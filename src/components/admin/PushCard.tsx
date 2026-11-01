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

async function registration(): Promise<ServiceWorkerRegistration> {
  // The admin layout registers the worker on load; this just makes sure.
  return (
    (await navigator.serviceWorker.getRegistration("/admin/")) ??
    (await navigator.serviceWorker.register("/admin/sw.js", { scope: "/admin/" }))
  );
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
      await navigator.serviceWorker.ready;
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
      flash("Sent — it should appear in a few seconds.");
    });

  const toggleEvent = (id: string, on: boolean) =>
    run(`ev-${id}`, async () => {
      const events = on ? [...new Set([...(status?.events ?? []), id])] : (status?.events ?? []).filter((e) => e !== id);
      setStatus((s) => (s ? { ...s, events } : s));
      await savePushEvents({ data: { events: events as ("booking_created" | "booking_cancelled" | "booking_rescheduled")[] } });
    });

  const on = Boolean(status?.thisDevice && permission === "granted");
  const others = (status?.devices.length ?? 0) - (status?.thisDevice ? 1 : 0);

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
        A buzz on your lock screen the moment a customer books, cancels or moves a job.
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

          {others > 0 && (
            <p className="text-[11.5px] text-muted-foreground">
              Also on for {others} other device{others === 1 ? "" : "s"}.
            </p>
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
