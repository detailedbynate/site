import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!body.includes('"unhandled":true') || !body.includes('"message":"HTTPError"')) {
    return response;
  }

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

/*
  robots.txt and sitemap.xml.

  Served here rather than as routes because this version of TanStack Start has
  no server-route API, and as static files they could not know the site's own
  URL — which lives in Settings and differs between the Railway subdomain and
  a real domain. Handled before the router so they never touch React.

  The admin, the booking-management links and the legal pages are all kept out
  of the sitemap: private, per-customer, or not worth ranking.
*/
async function staticSeoResponse(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/robots.txt" && url.pathname !== "/sitemap.xml") return null;

  const { getSettings } = await import("./lib/db.server");
  const settings = await getSettings().catch(() => null);
  // Fall back to the requesting origin so this still works before a Site URL
  // is configured, and behind Railway's proxy.
  const origin = (settings?.siteUrl || url.origin).replace(/\/+$/, "");

  if (url.pathname === "/robots.txt") {
    const body = [
      "User-agent: *",
      "Allow: /",
      "Disallow: /admin",
      "Disallow: /login",
      // Each of these is one customer's private booking link.
      "Disallow: /manage/",
      "",
      `Sitemap: ${origin}/sitemap.xml`,
      "",
    ].join("\n");
    return new Response(body, {
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" },
    });
  }

  const today = new Date().toISOString().slice(0, 10);
  const pages: [path: string, priority: string][] = [
    ["/", "1.0"],
    ["/book", "0.9"],
    ["/results", "0.7"],
  ];
  const rows = pages.map(
    ([path, priority]) =>
      `  <url><loc>${origin}${path}</loc><lastmod>${today}</lastmod><priority>${priority}</priority></url>`,
  );
  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...rows,
    "</urlset>",
    "",
  ].join("\n");
  return new Response(body, {
    headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" },
  });
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const seo = await staticSeoResponse(request).catch(() => null);
      if (seo) return seo;

      // Admin-only PWA endpoints: manifest, service worker, fallback icon.
      // Scoped under /admin/ so the customer site is never installable and
      // never falls under a worker.
      const { pwaResponse } = await import("./lib/pwa.server");
      const pwa = await pwaResponse(new URL(request.url)).catch(() => null);
      if (pwa) return pwa;

      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
