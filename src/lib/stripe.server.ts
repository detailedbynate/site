import { getSettings } from "./db.server";

// Stripe over its plain REST API, via fetch — no SDK dependency, same
// reasoning as email.server.ts using Resend's HTTP API instead of nodemailer.
//
// Scope is deliberately small and honest: this creates a hosted Payment Link
// for an outstanding balance and verifies the key works. It does NOT hold
// card details, run a checkout on-page, or handle inbound Stripe webhooks —
// those need a public HTTPS endpoint and a lot more care around idempotency.

const API = "https://api.stripe.com/v1";

export function isStripeConfigured(settings: { stripeSecretKey?: string }): boolean {
  return !!settings.stripeSecretKey?.trim();
}

/** Stripe wants application/x-www-form-urlencoded, including for nested keys. */
function form(params: Record<string, string | number | undefined>): string {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") body.set(k, String(v));
  }
  return body.toString();
}

async function stripe(
  path: string,
  secretKey: string,
  init?: { method?: string; body?: string },
): Promise<any> {
  const res = await fetch(`${API}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      authorization: `Bearer ${secretKey}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: init?.body,
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Stripe's own message is far more useful than a status code.
    throw new Error(json?.error?.message ?? `Stripe returned ${res.status}.`);
  }
  return json;
}

/**
 * Verify the secret key by asking Stripe who it belongs to. Returns the
 * account name so the UI can show *which* account is connected rather than
 * just claiming success.
 */
export async function verifyStripeKey(secretKey: string): Promise<{
  accountName: string;
  livemode: boolean;
  country: string;
}> {
  const key = secretKey.trim();
  if (!key) throw new Error("Enter your Stripe secret key first.");
  if (!key.startsWith("sk_") && !key.startsWith("rk_")) {
    throw new Error(
      "That doesn't look like a secret key. It should start with sk_ (or rk_ for a restricted key).",
    );
  }

  const account = await stripe("/account", key);
  return {
    accountName:
      account.business_profile?.name ||
      account.settings?.dashboard?.display_name ||
      account.email ||
      "Stripe account",
    livemode: !!account.charges_enabled && key.startsWith("sk_live"),
    country: account.country ?? "",
  };
}

/**
 * Create a hosted Payment Link for one booking's balance.
 *
 * Amounts are in the currency's smallest unit, so dollars are multiplied by
 * 100 and rounded — passing a float here is a classic way to be off by a cent.
 */
export async function createPaymentLink(input: {
  amount: number;
  description: string;
  reference: string;
}): Promise<{ url: string; id: string }> {
  const settings = await getSettings();
  const key = settings.stripeSecretKey.trim();
  if (!key) throw new Error("Connect Stripe first, under Integrations.");
  if (input.amount <= 0) throw new Error("There's nothing outstanding to charge.");

  const currency = (settings.stripeCurrency || "cad").toLowerCase();

  // A Payment Link needs a Price, which needs a Product. Created inline so
  // the shop doesn't have to pre-build a catalog inside Stripe.
  const price = await stripe("/prices", key, {
    method: "POST",
    body: form({
      currency,
      unit_amount: Math.round(input.amount * 100),
      "product_data[name]": input.description,
    }),
  });

  const link = await stripe("/payment_links", key, {
    method: "POST",
    body: form({
      "line_items[0][price]": price.id,
      "line_items[0][quantity]": 1,
      "metadata[reference]": input.reference,
    }),
  });

  return { url: link.url, id: link.id };
}
