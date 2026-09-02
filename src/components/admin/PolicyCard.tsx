import { useEffect, useState } from "react";
import { AnimatePresence } from "motion/react";
import { AlertTriangle, ShieldCheck } from "lucide-react";

import { getPolicy, savePolicy } from "@/lib/api/admin.functions";
import { describePolicy, depositFor } from "@/lib/policy";
import {
  Button,
  ErrorNote,
  Field,
  GlassCard,
  Spinner,
  SuccessNote,
  Toggle,
  inputCls,
} from "@/components/admin/ui";

type Policy = Awaited<ReturnType<typeof getPolicy>>;

/**
 * Deposits and the cancellation policy.
 *
 * Deliberately its own card and its own save: these are the settings that
 * decide what a customer is charged, and they should not ride along with a
 * change to the shop's phone number.
 */
export function PolicyCard() {
  const [p, setP] = useState<Policy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getPolicy()
      .then(setP)
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load the policy."));
  }, []);

  if (!p && !error) return <Spinner label="Loading policy…" />;
  if (!p) return <ErrorNote>{error}</ErrorNote>;

  const set = <K extends keyof Policy>(k: K, v: Policy[K]) => setP({ ...p, [k]: v });

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await savePolicy({
        data: {
          depositEnabled: p.depositEnabled,
          depositType: p.depositType,
          depositValue: p.depositValue,
          selfServiceEnabled: p.selfServiceEnabled,
          cancelFreeHours: p.cancelFreeHours,
          cancelFeeType: p.cancelFeeType,
          cancelFeeValue: p.cancelFeeValue,
          cancelLockHours: p.cancelLockHours,
          rescheduleMinHours: p.rescheduleMinHours,
        },
      });
      setOk("Policy saved.");
      setTimeout(() => setOk(null), 3500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  };

  // A worked example beats any amount of explanation.
  const sample = 200;
  const deposit = depositFor(p, sample);

  return (
    <GlassCard index={6} className="p-6 lg:col-span-2">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--fill-2)]">
          <ShieldCheck className="h-5 w-5 text-primary" />
        </span>
        <div>
          <p className="text-[15px] font-semibold tracking-tight text-foreground">
            Deposits &amp; cancellation
          </p>
          <p className="mt-0.5 max-w-xl text-[12.5px] leading-relaxed text-muted-foreground">
            What you take up front, and what happens when someone cancels late.
          </p>
        </div>
      </div>

      {!p.stripeReady && (
        <div className="mt-5 flex items-start gap-2 rounded-xl border border-amber-400/30 bg-amber-400/[0.07] px-4 py-3">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" />
          <p className="text-[12.5px] leading-relaxed text-amber-100/90">
            Stripe isn't connected, so deposits and fees can't be switched on yet — there'd be no
            way to take the money. Connect it under Integrations first.
          </p>
        </div>
      )}

      <AnimatePresence>
        {error && <ErrorNote>{error}</ErrorNote>}
        {ok && <SuccessNote>{ok}</SuccessNote>}
      </AnimatePresence>

      {/* ------------------------- deposits -------------------------- */}
      <div className="mt-6 border-t border-[var(--line-2)] pt-5">
        <Toggle
          checked={p.depositEnabled}
          onChange={(v: boolean) => set("depositEnabled", v)}
          disabled={!p.stripeReady}
          label="Take a deposit at booking"
          hint="The customer gets a payment link on the confirmation screen and in their email. The balance is still due on the day."
        />

        {p.depositEnabled && (
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Deposit type">
              <select
                className={inputCls}
                value={p.depositType}
                onChange={(e) => set("depositType", e.target.value as "percent" | "fixed")}
              >
                <option value="percent">Percentage of the total</option>
                <option value="fixed">Fixed amount</option>
              </select>
            </Field>
            <Field
              label={p.depositType === "percent" ? "Deposit (%)" : "Deposit ($)"}
              hint={`A $${sample} job would take ${deposit === 0 ? "nothing" : `$${deposit}`} up front.`}
            >
              <input
                className={inputCls}
                type="number"
                min={0}
                max={p.depositType === "percent" ? 100 : undefined}
                value={p.depositValue}
                onChange={(e) => set("depositValue", Number(e.target.value))}
              />
            </Field>
          </div>
        )}
      </div>

      {/* ---------------------- self-service ------------------------- */}
      <div className="mt-6 border-t border-[var(--line-2)] pt-5">
        <Toggle
          checked={p.selfServiceEnabled}
          onChange={(v: boolean) => set("selfServiceEnabled", v)}
          label="Let customers change or cancel their own booking"
          hint="Each confirmation carries a private link to their booking. Switch this off and the link only shows the details."
        />

        {p.selfServiceEnabled && (
          <>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field
                label="Free cancellation up to (hours before)"
                hint="Cancel earlier than this and there's nothing to pay."
              >
                <input
                  className={inputCls}
                  type="number"
                  min={0}
                  value={p.cancelFreeHours}
                  onChange={(e) => set("cancelFreeHours", Number(e.target.value))}
                />
              </Field>
              <Field
                label="Can move a booking up to (hours before)"
                hint="0 = they can move it right up to the appointment."
              >
                <input
                  className={inputCls}
                  type="number"
                  min={0}
                  value={p.rescheduleMinHours}
                  onChange={(e) => set("rescheduleMinHours", Number(e.target.value))}
                />
              </Field>
              <Field label="Late cancellation fee">
                <select
                  className={inputCls}
                  value={p.cancelFeeType}
                  disabled={!p.stripeReady}
                  onChange={(e) => set("cancelFeeType", e.target.value as "percent" | "fixed")}
                >
                  <option value="percent">Percentage of the total</option>
                  <option value="fixed">Fixed amount</option>
                </select>
              </Field>
              <Field
                label={p.cancelFeeType === "percent" ? "Fee (%)" : "Fee ($)"}
                hint="0 = no fee, cancelling is always free."
              >
                <input
                  className={inputCls}
                  type="number"
                  min={0}
                  max={p.cancelFeeType === "percent" ? 100 : undefined}
                  value={p.cancelFeeValue}
                  disabled={!p.stripeReady}
                  onChange={(e) => set("cancelFeeValue", Number(e.target.value))}
                />
              </Field>
              <Field
                label="No online cancelling inside (hours)"
                hint="They have to call instead. 0 = they can always cancel online. Must be shorter than the free window."
              >
                <input
                  className={inputCls}
                  type="number"
                  min={0}
                  value={p.cancelLockHours}
                  onChange={(e) => set("cancelLockHours", Number(e.target.value))}
                />
              </Field>
            </div>

            <div className="mt-5 rounded-xl bg-[var(--fill-1)] px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Customers will see
              </p>
              <p className="mt-1.5 text-[13px] leading-relaxed text-foreground">
                {describePolicy(p) || "No cancellation policy."}
              </p>
            </div>
          </>
        )}
      </div>

      <div className="mt-6">
        <Button loading={busy} onClick={save}>
          Save policy
        </Button>
      </div>
    </GlassCard>
  );
}
