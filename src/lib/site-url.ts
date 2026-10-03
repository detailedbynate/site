// The site's public origin, for canonical tags, og:url, absolute image URLs,
// the sitemap and schema. Settings → Site URL wins; without it the live
// domain is used rather than whatever host the request came in on (behind
// Railway's proxy that is plain http, which crawlers then index).

export const DEFAULT_ORIGIN = "https://detailedbynate.com";

/** "https://example.com" — no trailing slash, https unless it's localhost. */
export function siteOrigin(siteUrl?: string | null): string {
  let url = (siteUrl ?? "").trim().replace(/\/+$/, "");
  if (!url) return DEFAULT_ORIGIN;
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  if (/^http:\/\//i.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)(:|$)/i.test(url)) {
    url = url.replace(/^http:/i, "https:");
  }
  return url;
}

/** Make a site-relative path ("/img/…") absolute; leaves full URLs alone. */
export function absoluteUrl(origin: string, pathOrUrl: string): string {
  if (!pathOrUrl) return "";
  return /^https?:\/\//i.test(pathOrUrl) ? pathOrUrl : `${origin}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;
}

/** "(226) 234-9659" for a North American number; anything else as typed. */
export function formatPhone(phone?: string | null): string {
  const raw = (phone ?? "").trim();
  const digits = raw.replace(/\D/g, "");
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (ten.length !== 10) return raw;
  return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
}

/** "+1-226-234-9659" for schema; null when the number isn't 10 digits. */
export function schemaPhone(phone?: string | null): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (ten.length !== 10) return null;
  return `+1-${ten.slice(0, 3)}-${ten.slice(3, 6)}-${ten.slice(6)}`;
}
