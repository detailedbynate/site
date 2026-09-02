// --------------------------------------------------------------------------
// Deposit and cancellation rules.
//
// Deliberately pure and shared: the customer is told what cancelling will
// cost before they confirm, and the server decides what to actually charge.
// If those were two implementations they would eventually disagree, and the
// disagreement would be about money.
//
// No imports, no clock of its own — `now` is always passed in — so every
// branch can be tested directly.
// --------------------------------------------------------------------------

export interface DepositPolicy {
  depositEnabled: boolean;
  depositType: "percent" | "fixed";
  depositValue: number;
}

export interface CancellationPolicy {
  selfServiceEnabled: boolean;
  cancelFreeHours: number;
  cancelFeeType: "percent" | "fixed";
  cancelFeeValue: number;
  cancelLockHours: number;
  rescheduleMinHours: number;
}

/** Round to whole cents. Percentages of odd totals are not whole dollars. */
function money(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * What to take up front for a booking, given its total.
 *
 * Never more than the total: a fixed deposit larger than a cheap job would
 * otherwise charge the customer more than the work costs.
 */
export function depositFor(policy: DepositPolicy, total: number): number {
  if (!policy.depositEnabled) return 0;
  if (total <= 0) return 0;
  const raw =
    policy.depositType === "percent"
      ? (total * policy.depositValue) / 100
      : policy.depositValue;
  return money(Math.max(0, Math.min(total, raw)));
}

export type CancelOutcome =
  /** Cancel now, nothing to pay. */
  | { kind: "free"; hoursUntil: number }
  /** Cancel, but a fee is owed first. */
  | { kind: "fee"; hoursUntil: number; fee: number }
  /** Too close to the appointment to cancel online at all. */
  | { kind: "locked"; hoursUntil: number; lockHours: number }
  /** Self-service is switched off, or the booking isn't cancellable. */
  | { kind: "unavailable"; reason: string };

export interface BookingForPolicy {
  status: string;
  /** The booking's start, as a real instant. */
  startISO: string;
  total: number;
  /** Deposit already taken, if any — it counts toward the fee. */
  depositPaid: number;
}

/** Whole hours between now and the booking, negative once it has started. */
export function hoursUntil(booking: BookingForPolicy, now: Date): number {
  return (new Date(booking.startISO).getTime() - now.getTime()) / 3_600_000;
}

/**
 * What happens if this customer cancels right now.
 *
 * Order matters. The lock window is checked before the fee window, so a shop
 * that sets "no online cancelling inside 4 hours" and "fee inside 24 hours"
 * gets exactly that: free until 24h out, a fee from 24h to 4h, and a phone
 * call inside 4h.
 */
export function evaluateCancellation(
  policy: CancellationPolicy,
  booking: BookingForPolicy,
  now: Date,
): CancelOutcome {
  if (!policy.selfServiceEnabled) {
    return { kind: "unavailable", reason: "Online changes aren't available — please get in touch." };
  }
  if (booking.status === "cancelled") {
    return { kind: "unavailable", reason: "This booking is already cancelled." };
  }
  if (booking.status === "completed") {
    return { kind: "unavailable", reason: "This job is already done." };
  }

  const h = hoursUntil(booking, now);
  if (h <= 0) {
    return { kind: "unavailable", reason: "This booking has already started." };
  }

  if (policy.cancelLockHours > 0 && h < policy.cancelLockHours) {
    return { kind: "locked", hoursUntil: h, lockHours: policy.cancelLockHours };
  }

  // Outside the fee window, or no fee configured.
  if (h >= policy.cancelFreeHours || policy.cancelFeeValue <= 0) {
    return { kind: "free", hoursUntil: h };
  }

  const raw =
    policy.cancelFeeType === "percent"
      ? (booking.total * policy.cancelFeeValue) / 100
      : policy.cancelFeeValue;
  // A deposit already taken counts toward the fee rather than stacking on
  // top of it — the customer has paid that money once already.
  const fee = money(Math.max(0, Math.min(booking.total, raw) - booking.depositPaid));

  // If the deposit already covers the fee there is nothing left to collect,
  // so this is a free cancellation from the customer's point of view.
  if (fee <= 0) return { kind: "free", hoursUntil: h };
  return { kind: "fee", hoursUntil: h, fee };
}

/** Whether the customer may move this booking themselves right now. */
export function canReschedule(
  policy: CancellationPolicy,
  booking: BookingForPolicy,
  now: Date,
): { allowed: boolean; reason?: string } {
  if (!policy.selfServiceEnabled) {
    return { allowed: false, reason: "Online changes aren't available — please get in touch." };
  }
  if (booking.status !== "confirmed") {
    return { allowed: false, reason: "This booking can't be moved." };
  }
  const h = hoursUntil(booking, now);
  if (h <= 0) return { allowed: false, reason: "This booking has already started." };
  if (policy.rescheduleMinHours > 0 && h < policy.rescheduleMinHours) {
    return {
      allowed: false,
      reason: `Bookings can only be moved more than ${policy.rescheduleMinHours} hours ahead — please get in touch.`,
    };
  }
  return { allowed: true };
}

/** One sentence describing the policy, for the booking form and emails. */
export function describePolicy(policy: CancellationPolicy): string {
  if (!policy.selfServiceEnabled) return "";
  const parts: string[] = [];
  if (policy.cancelFeeValue > 0 && policy.cancelFreeHours > 0) {
    const fee =
      policy.cancelFeeType === "percent"
        ? `${policy.cancelFeeValue}%`
        : `$${policy.cancelFeeValue}`;
    parts.push(
      `Free cancellation up to ${policy.cancelFreeHours} hours before. After that a ${fee} fee applies.`,
    );
  } else if (policy.cancelFreeHours > 0) {
    parts.push(`Free cancellation up to ${policy.cancelFreeHours} hours before.`);
  } else {
    parts.push("Free cancellation any time.");
  }
  if (policy.cancelLockHours > 0) {
    parts.push(`Inside ${policy.cancelLockHours} hours, please call to cancel.`);
  }
  return parts.join(" ");
}
