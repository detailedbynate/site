import { getSettings, type Booking } from "./db.server";
import { renderTemplate } from "./email.server";

// --------------------------------------------------------------------------
// HTML email rendering.
//
// Every email goes out as BOTH plain text and HTML: the text part is the
// template exactly as the owner wrote it, and the HTML part is that same text
// escaped, paragraphed and wrapped in the shop's branding. One source of
// wording, two renderings — editing a template changes both, and there is no
// second copy to keep in step.
//
// Deliberately old-fashioned markup: tables, inline styles, no flexbox, no
// external stylesheet. Mail clients are a decade behind browsers and Outlook
// in particular ignores anything else.
// --------------------------------------------------------------------------

/*
  Block-level placeholders.

  Most variables are inline text and can sit mid-sentence. These three become
  whole elements - a table or a button - which cannot legally live inside the
  <p> that wraps a paragraph. So they are swapped for sentinels, the text is
  paragraphed around them, and the real markup is spliced back in afterwards.
  That is what lets a template put the buttons where it wants them instead of
  having them tacked on after the sign-off.
*/
const BLOCK_VARS = ["details", "manageLink", "depositLink"] as const;
const token = (name: string) => `\u0001${name}\u0001`;
const TOKEN_SPLIT = new RegExp(`(\u0001(?:${BLOCK_VARS.join("|")})\u0001)`);

const BRAND = "#0ea5a4";

export function escapeHtml(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Turn already-escaped plain text into paragraphs, making bare URLs
 * clickable. Templates are written as plain text, so this is what stops the
 * HTML version collapsing into one run-on line.
 */
function paragraphs(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const linked = block.replace(
        /(https?:\/\/[^\s<]+)/g,
        `<a href="$1" style="color:${BRAND};text-decoration:underline;word-break:break-all">$1</a>`,
      );
      return `<p style="margin:0 0 16px;line-height:1.6;color:#374151;font-size:15px">${linked.replace(/\n/g, "<br>")}</p>`;
    })
    .join("");
}

/** One label/value row of the details card. Empty values drop out entirely. */
function row(label: string, value: string): string {
  if (!value) return "";
  return `<tr><td style="padding:9px 0;color:#6b7280;font-size:13px;vertical-align:top">${escapeHtml(label)}</td><td style="padding:9px 0 9px 20px;color:#111827;font-size:14px;font-weight:600;text-align:right">${escapeHtml(value)}</td></tr>`;
}

/**
 * The booking summary card — the same information shown on the confirmation
 * screen after booking, so the email is a real record of it rather than a
 * pointer back to a page the customer has already closed.
 */
function detailsCard(booking: Booking, vars: Record<string, string>): string {
  const owing = booking.depositPaidAt ? "" : vars.deposit;
  const rows = [
    row("Service", vars.service),
    row("Add-ons", vars.addOns === "none" ? "" : vars.addOns),
    row("When", `${vars.date} at ${vars.time}`),
    row("Where", vars.location),
    row("Vehicle", vars.vehicle === "your vehicle" ? "" : vars.vehicle),
    row("Reference", vars.reference),
    row("Notes", vars.notes === "None" ? "" : vars.notes),
    `<tr><td colspan="2" style="border-top:1px solid #e5e7eb;font-size:0;line-height:0">&nbsp;</td></tr>`,
    row("Total", vars.total),
    owing ? row("Deposit to pay", owing) : "",
    booking.depositPaidAt ? row("Deposit paid", `$${booking.depositAmount ?? 0}`) : "",
    booking.depositPaidAt ? row("Balance on the day", vars.balance) : "",
  ].join("");

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;margin:0 0 20px"><tr><td style="padding:14px 20px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table></td></tr></table>`;
}

/** A prominent button — used for the deposit and the manage link. */
function button(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 16px"><tr><td style="border-radius:999px;background:${BRAND}"><a href="${escapeHtml(href)}" style="display:inline-block;padding:12px 26px;color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;border-radius:999px">${escapeHtml(label)}</a></td></tr></table>`;
}

/**
 * Wrap rendered body HTML in the shop's branding.
 *
 * The logo must be an absolute https URL: mail clients do not resolve
 * relative paths and Gmail strips data: URIs. A logo that works in a preview
 * and vanishes in the inbox is worse than none, so anything else falls back
 * to the business name set in bold type.
 */
function shell(opts: {
  bodyHtml: string;
  businessName: string;
  logoUrl: string;
  footer: string;
}): string {
  /*
    Mail clients block remote images by default for a sender they don't know
    yet, so the header has to survive the logo never loading. The alt text is
    styled to read as the wordmark in that case, rather than as a broken
    image, and the explicit height stops the layout jumping when the reader
    does choose to load it.

    (Whether images are blocked at all is a DNS question — SPF, DKIM and
    DMARC on the sending domain — not something markup can fix.)
  */
  const header = /^https:\/\//i.test(opts.logoUrl)
    ? `<img src="${escapeHtml(opts.logoUrl)}" alt="${escapeHtml(opts.businessName)}" height="44" style="height:44px;max-width:220px;display:block;border:0;font-size:19px;font-weight:800;color:#111827;letter-spacing:-0.02em;text-decoration:none">`
    : `<span style="font-size:19px;font-weight:800;color:#111827;letter-spacing:-0.02em">${escapeHtml(opts.businessName)}</span>`;

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(opts.businessName)}</title></head><body style="margin:0;padding:0;background:#f3f4f6"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6"><tr><td align="center" style="padding:28px 12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"><tr><td style="padding:26px 28px 20px;border-bottom:1px solid #f0f1f3">${header}</td></tr><tr><td style="padding:26px 28px 10px">${opts.bodyHtml}</td></tr><tr><td style="padding:18px 28px 26px;border-top:1px solid #f0f1f3;color:#9ca3af;font-size:12px;line-height:1.6">${opts.footer}</td></tr></table></td></tr></table></body></html>`;
}

/** The details card as plain text, for the non-HTML half of the email. */
export function plainDetails(vars: Record<string, string>): string {
  return [
    `Service: ${vars.service}`,
    vars.addOns && vars.addOns !== "none" ? `Add-ons: ${vars.addOns}` : "",
    `When: ${vars.date} at ${vars.time}`,
    `Where: ${vars.location}`,
    vars.vehicle && vars.vehicle !== "your vehicle" ? `Vehicle: ${vars.vehicle}` : "",
    `Reference: ${vars.reference}`,
    vars.notes && vars.notes !== "None" ? `Notes: ${vars.notes}` : "",
    `Total: ${vars.total}`,
    vars.deposit ? `Deposit to pay: ${vars.deposit}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Render one email as text + HTML.
 *
 * `booking` is optional so template previews (which have no real booking)
 * still render; without it the {{details}} card is simply left out.
 */
export async function renderEmail(
  template: string,
  vars: Record<string, string>,
  booking?: Booking,
): Promise<{ text: string; html: string }> {
  const settings = await getSettings();

  const depositUrl = booking?.depositUrl && !booking.depositPaidAt ? booking.depositUrl : "";

  let text = renderTemplate(template, {
    ...vars,
    details: plainDetails(vars),
    depositLink: depositUrl,
  });

  // The HTML version gets buttons for these; the text version needs the bare
  // URLs, or anyone reading in plain text loses the link entirely.
  if (depositUrl && !template.includes("{{depositLink}}")) {
    text += `

Pay your ${vars.deposit} deposit:
${depositUrl}`;
  }
  if (vars.manageLink && !template.includes("{{manageLink}}")) {
    text += `

Change or cancel this booking:
${vars.manageLink}`;
  }

  // A template placing {{depositLink}} for a booking with no deposit leaves a
  // hole where the line was. Collapse the run rather than mailing blank space.
  text = text.replace(/\n{3,}/g, "\n\n").trim();

  // Escape the TEMPLATE first, then substitute escaped values — the {{...}}
  // placeholders survive escaping, so nothing a customer typed into a notes
  // field can inject markup into the email.
  const escapedVars: Record<string, string> = {};
  for (const [k, v] of Object.entries(vars)) escapedVars[k] = escapeHtml(v);
  const withToken = renderTemplate(escapeHtml(template), {
    ...escapedVars,
    details: token("details"),
    manageLink: token("manageLink"),
    depositLink: token("depositLink"),
  });

  const blocks: Record<string, string> = {
    [token("details")]: booking ? detailsCard(booking, vars) : "",
    [token("manageLink")]: vars.manageLink
      ? button(vars.manageLink, "Change or cancel this booking")
      : "",
    [token("depositLink")]: depositUrl
      ? button(depositUrl, `Pay the ${vars.deposit} deposit`)
      : "",
  };

  let bodyHtml = withToken
    .split(TOKEN_SPLIT)
    .map((part) => (part in blocks ? blocks[part] : paragraphs(part)))
    .join("");

  // A template that never mentions the links still gets them, appended. The
  // booking is not much use to the customer without them.
  if (depositUrl && !template.includes("{{depositLink}}")) {
    bodyHtml += blocks[token("depositLink")];
  }
  if (vars.manageLink && !template.includes("{{manageLink}}")) {
    bodyHtml += blocks[token("manageLink")];
  }

  const footer = [
    escapeHtml(settings.businessName),
    settings.contactPhone ? escapeHtml(settings.contactPhone) : "",
    settings.contactEmail ? escapeHtml(settings.contactEmail) : "",
  ]
    .filter(Boolean)
    .join(" &nbsp;·&nbsp; ");

  return {
    text,
    html: shell({
      bodyHtml,
      businessName: settings.businessName || "Your booking",
      logoUrl: settings.emailLogoUrl,
      footer,
    }),
  };
}
