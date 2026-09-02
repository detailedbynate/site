import type { Booking } from "./db.server";

// --------------------------------------------------------------------------
// One invoice, built from one booking.
//
// Pure and shared on purpose: the Payments page, the invoice email and the
// balance a customer is asked to pay all come through here, so they cannot
// quote three different numbers for the same job. Money is the last place a
// second implementation should exist.
// --------------------------------------------------------------------------

export interface InvoiceLine {
  label: string;
  detail?: string;
  amount: number;
}

export interface Invoice {
  /** Human reference — the booking's, so a customer quoting it is understood. */
  reference: string;
  /** Invoice number: the reference is already unique, so it doubles as one. */
  number: string;
  issuedOn: string;
  serviceDate: string;
  lines: InvoiceLine[];
  subtotal: number;
  discount: number;
  tip: number;
  /** What the job costs in total, after discount and tip. */
  grandTotal: number;
  /** Deposit already taken, if any. */
  depositPaid: number;
  /** Recorded payments, deposit included. */
  amountPaid: number;
  balance: number;
  paid: boolean;
}

/** Round to cents — percentages and splits do not land on whole dollars. */
function money(n: number): number {
  return Math.round(n * 100) / 100;
}

export function buildInvoice(
  booking: Pick<
    Booking,
    | "reference"
    | "date"
    | "serviceTitle"
    | "addOnTitles"
    | "location"
    | "totalPrice"
    | "discount"
    | "tip"
    | "amountPaid"
    | "depositAmount"
    | "depositPaidAt"
  >,
  travelFee: number,
  issuedOn = new Date().toISOString().slice(0, 10),
): Invoice {
  // Reconstruct the breakdown from what was stored on the booking, so an
  // invoice reissued a year later still shows the price actually charged
  // rather than today's catalog.
  const travel = booking.location === "mobile" ? travelFee : 0;
  const base = money((booking.totalPrice ?? 0) - travel);

  const lines: InvoiceLine[] = [
    { label: booking.serviceTitle, detail: "Package", amount: base },
  ];
  if (booking.addOnTitles?.length) {
    // Add-on prices are already inside the package total above, so this line
    // records WHAT was done without double-charging for it.
    lines.push({ label: "Add-ons", detail: booking.addOnTitles.join(", "), amount: 0 });
  }
  if (travel) lines.push({ label: "Mobile travel", amount: travel });
  if (booking.discount) lines.push({ label: "Discount", amount: -booking.discount });
  if (booking.tip) lines.push({ label: "Tip", detail: "Added after service", amount: booking.tip });

  const grandTotal = money(
    (booking.totalPrice ?? 0) - (booking.discount ?? 0) + (booking.tip ?? 0),
  );

  // A paid deposit counts toward the bill. It is money that has already
  // moved, so an invoice ignoring it would ask for it twice.
  const depositPaid = booking.depositPaidAt ? (booking.depositAmount ?? 0) : 0;
  const amountPaid = money(Math.max(booking.amountPaid ?? 0, depositPaid));
  const balance = money(Math.max(0, grandTotal - amountPaid));

  return {
    reference: booking.reference,
    number: booking.reference,
    issuedOn,
    serviceDate: booking.date,
    lines,
    subtotal: booking.totalPrice ?? 0,
    discount: booking.discount ?? 0,
    tip: booking.tip ?? 0,
    grandTotal,
    depositPaid,
    amountPaid,
    balance,
    paid: balance <= 0,
  };
}

const fmt = (n: number) => `$${n.toFixed(2)}`;

/** The invoice as plain text, for the non-HTML half of the email. */
export function invoiceText(inv: Invoice): string {
  const rows = inv.lines.map((l) =>
    l.amount === 0 && l.detail
      ? `${l.label}: ${l.detail}`
      : `${l.label}${l.detail ? ` (${l.detail})` : ""}  ${fmt(l.amount)}`,
  );
  return [
    `Invoice ${inv.number}`,
    `Service date: ${inv.serviceDate}`,
    "",
    ...rows,
    "",
    `Total: ${fmt(inv.grandTotal)}`,
    inv.amountPaid > 0 ? `Paid: ${fmt(inv.amountPaid)}` : "",
    inv.paid ? "Balance: paid in full — thank you." : `Balance due: ${fmt(inv.balance)}`,
  ]
    .filter(Boolean)
    .join("\n");
}
