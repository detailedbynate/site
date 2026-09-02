// --------------------------------------------------------------------------
// Progressive-web-app support for the ADMIN ONLY.
//
// Everything here is served under /admin/ so the customer-facing site is
// never installable and never falls under a service worker. That is the whole
// design constraint: the shop owner gets an app on their home screen, and a
// customer visiting the site gets an ordinary web page, unchanged.
//
// Served from the fetch wrapper rather than as static files because the icon
// and the app name come from Settings, which the owner edits — a file baked
// at build time could not know the business name or the logo they chose.
// --------------------------------------------------------------------------

/** Admin surfaces are dark; these match --background and --primary there. */
const BACKGROUND = "#101318";
const THEME = "#101318";
const ACCENT = "#4ba6ec";

/**
 * Fallback icon: the business initial on the brand gradient.
 *
 * Drawn rather than bundled so there is always a real icon — an install with
 * a blank square looks broken, and the owner should not have to upload
 * anything before the feature works. A logo set in SEO & branding takes
 * precedence over this.
 */
function iconSvg(initial: string): string {
  const safe = (initial || "D").slice(0, 1).toUpperCase().replace(/[<&>]/g, "");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${ACCENT}"/>
      <stop offset="100%" stop-color="#7c5cff"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="112" fill="${BACKGROUND}"/>
  <rect x="36" y="36" width="440" height="440" rx="88" fill="url(#g)"/>
  <text x="256" y="256" font-family="system-ui,-apple-system,Segoe UI,Roboto,sans-serif"
        font-size="248" font-weight="700" fill="#0b0f16"
        text-anchor="middle" dominant-baseline="central">${safe}</text>
</svg>`;
}

/**
 * The service worker.
 *
 * Deliberately network-only with no caching of pages or API responses. The
 * admin is behind a login and shows live business data: a cached HTML page
 * could be served to the wrong person after a logout, and a cached API
 * response could show yesterday's bookings as though they were today's.
 *
 * It exists because an installable PWA needs a registered worker with a fetch
 * handler — not because anything here should work offline. The only thing it
 * adds is an honest message when the phone has no connection, instead of the
 * browser's error page inside a standalone window with no address bar to
 * retry from.
 */
function serviceWorker(): string {
  return `// Admin-only service worker. Scope: /admin/
// Network-only by design — see src/lib/pwa.server.ts for why.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const request = event.request;
  // Only ever touch same-origin admin navigations. Everything else — API
  // calls, assets, anything on the public site — goes straight to the
  // network untouched.
  if (request.method !== "GET" || request.mode !== "navigate") return;

  event.respondWith(
    fetch(request).catch(
      () =>
        new Response(
          '<!doctype html><meta charset="utf-8">' +
            '<meta name="viewport" content="width=device-width,initial-scale=1">' +
            '<title>Offline</title>' +
            '<body style="margin:0;display:grid;place-items:center;min-height:100vh;' +
            'background:${BACKGROUND};color:#e6eaf2;font-family:system-ui,sans-serif;text-align:center">' +
            '<div style="padding:24px"><h1 style="font-size:20px;margin:0 0 8px">No connection</h1>' +
            '<p style="margin:0 0 20px;color:#94a3b8;font-size:14px">' +
            'The admin needs to be online. Check your signal and try again.</p>' +
            '<button onclick="location.reload()" style="border:0;border-radius:999px;padding:12px 24px;' +
            'background:${ACCENT};color:#08101c;font-size:14px;font-weight:700">Retry</button></div></body>',
          { headers: { "content-type": "text/html; charset=utf-8" }, status: 503 },
        ),
    ),
  );
});
`;
}

/**
 * Handle the PWA endpoints, or return null so the request falls through to
 * the app as normal.
 */
export async function pwaResponse(url: URL): Promise<Response | null> {
  if (!url.pathname.startsWith("/admin/")) return null;

  const isManifest = url.pathname === "/admin/manifest.webmanifest";
  const isWorker = url.pathname === "/admin/sw.js";
  const isIcon = url.pathname === "/admin/icon";
  if (!isManifest && !isWorker && !isIcon) return null;

  if (isWorker) {
    return new Response(serviceWorker(), {
      headers: {
        "content-type": "text/javascript; charset=utf-8",
        // Never cache the worker itself, or a fix to it can't reach a phone
        // that already installed the app.
        "cache-control": "no-cache",
      },
    });
  }

  const { getSettings } = await import("./db.server");
  const settings = await getSettings().catch(() => null);
  const name = settings?.businessName?.trim() || "Shop admin";

  const logo = settings?.faviconUrl?.trim();
  const hasLogo = Boolean(logo && /^https?:\/\//i.test(logo));

  /*
    One stable icon URL.

    Redirecting to the configured logo rather than naming it directly in the
    manifest means the app icon, the apple-touch-icon and anything added
    later all point at /admin/icon and resolve to the same picture. Without
    that the root route's apple-touch-icon (the logo) and the admin's (the
    fallback) disagreed, and iOS picks one of them — which could have left
    the installed app showing a blank square.
  */
  if (isIcon) {
    if (hasLogo) {
      return new Response(null, {
        status: 302,
        headers: { location: logo!, "cache-control": "public, max-age=300" },
      });
    }
    return new Response(iconSvg(name), {
      headers: {
        "content-type": "image/svg+xml; charset=utf-8",
        "cache-control": "public, max-age=3600",
      },
    });
  }

  const iconSrc = "/admin/icon";
  const iconType = hasLogo ? undefined : "image/svg+xml";

  const manifest = {
    name: `${name} — Admin`,
    short_name: name.length > 12 ? "Admin" : name,
    description: `Bookings, customers and payments for ${name}.`,
    // Both scoped to /admin: launching the installed app lands on the
    // dashboard, and following a link to the public site leaves the app
    // rather than trapping a customer page inside it.
    start_url: "/admin",
    scope: "/admin",
    display: "standalone",
    orientation: "any",
    background_color: BACKGROUND,
    theme_color: THEME,
    icons: [
      {
        src: iconSrc,
        // "any" lets the browser scale one source to every slot it needs,
        // which is what makes a single uploaded logo enough.
        sizes: "192x192 512x512 any",
        ...(iconType ? { type: iconType } : {}),
        purpose: "any",
      },
      {
        src: iconSrc,
        sizes: "any",
        ...(iconType ? { type: iconType } : {}),
        // Android crops icons to its own shape; the drawn icon has padding
        // for exactly this.
        purpose: "maskable",
      },
    ],
  };

  return new Response(JSON.stringify(manifest, null, 2), {
    headers: {
      "content-type": "application/manifest+json; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
}
