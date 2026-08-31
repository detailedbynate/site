import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AnimatePresence } from "motion/react";
import { Building2, Clock, KeyRound, ShieldCheck } from "lucide-react";

import { getAdminSettings, saveSettings } from "@/lib/api/admin.functions";
import { TeamCard } from "@/components/admin/TeamCard";
import { changePassword, getMe, updateProfile } from "@/lib/api/auth.functions";
import {
  Button,
  ErrorNote,
  Field,
  GlassCard,
  PageHeader,
  Spinner,
  SuccessNote,
  inputCls,
} from "@/components/admin/ui";

export const Route = createFileRoute("/admin/settings")({
  component: SettingsPage,
});

type Settings = Awaited<ReturnType<typeof getAdminSettings>>["settings"];

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function SettingsPage() {
  const [s, setS] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getAdminSettings()
      .then((r) => setS(r.settings))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load."));
  }, []);

  const flash = (msg: string) => {
    setOk(msg);
    setTimeout(() => setOk(null), 3500);
  };

  const save = async () => {
    if (!s) return;
    setBusy(true);
    setError(null);
    try {
      const res = await saveSettings({ data: s });
      setS(res.settings);
      flash("Settings saved. Availability now uses these hours.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  };

  if (!s && !error) return <Spinner label="Loading settings…" />;
  if (!s) return <ErrorNote>{error}</ErrorNote>;

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS({ ...s, [k]: v });

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Business details and the rules that govern what customers can book."
        actions={
          <Button variant="primary" loading={busy} onClick={save}>
            Save changes
          </Button>
        }
      />

      <AnimatePresence>
        {error && <ErrorNote>{error}</ErrorNote>}
        {ok && <SuccessNote>{ok}</SuccessNote>}
      </AnimatePresence>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <GlassCard index={0} className="p-6">
          <div className="flex items-center gap-2.5">
            <Building2 className="h-4 w-4 text-primary" />
            <p className="text-[15px] font-semibold tracking-tight text-foreground">Business</p>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Shown on the booking confirmation and used as the reply-to.
          </p>

          <div className="mt-5 space-y-4">
            <Field label="Business name">
              <input
                className={inputCls}
                value={s.businessName}
                maxLength={80}
                onChange={(e) => set("businessName", e.target.value)}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Contact email">
                <input
                  className={inputCls}
                  type="email"
                  value={s.contactEmail}
                  onChange={(e) => set("contactEmail", e.target.value)}
                />
              </Field>
              <Field label="Contact phone">
                <input
                  className={inputCls}
                  value={s.contactPhone}
                  onChange={(e) => set("contactPhone", e.target.value)}
                />
              </Field>
            </div>
            <Field label="Service area">
              <input
                className={inputCls}
                value={s.serviceArea}
                maxLength={120}
                onChange={(e) => set("serviceArea", e.target.value)}
              />
            </Field>
            <Field label="Mobile travel fee ($)" hint="Added when a customer picks mobile service.">
              <input
                className={inputCls}
                type="number"
                min={0}
                value={s.travelFee}
                onChange={(e) => set("travelFee", Number(e.target.value))}
              />
            </Field>
          </div>
        </GlassCard>

        <GlassCard index={1} className="p-6">
          <div className="flex items-center gap-2.5">
            <Clock className="h-4 w-4 text-primary" />
            <p className="text-[15px] font-semibold tracking-tight text-foreground">
              Hours & booking rules
            </p>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            These directly control which slots customers are offered.
          </p>

          <div className="mt-5 space-y-4">
            <Field label="Timezone" hint="An IANA name, e.g. America/Toronto.">
              <input
                className={inputCls}
                value={s.timezone}
                onChange={(e) => set("timezone", e.target.value)}
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Opens at (hour)">
                <input
                  className={inputCls}
                  type="number"
                  min={0}
                  max={23}
                  value={s.openHour}
                  onChange={(e) => set("openHour", Number(e.target.value))}
                />
              </Field>
              <Field label="Closes at (hour)">
                <input
                  className={inputCls}
                  type="number"
                  min={1}
                  max={24}
                  value={s.closeHour}
                  onChange={(e) => set("closeHour", Number(e.target.value))}
                />
              </Field>
            </div>

            <Field label="Closed days">
              <div className="flex flex-wrap gap-1.5">
                {DAYS.map((d, i) => {
                  const closed = s.closedDays.includes(i);
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() =>
                        set(
                          "closedDays",
                          closed ? s.closedDays.filter((x) => x !== i) : [...s.closedDays, i],
                        )
                      }
                      className={`rounded-xl border px-3 py-2 text-xs font-semibold transition ${
                        closed
                          ? "border-destructive/40 bg-destructive/15 text-destructive"
                          : "border-border bg-card text-foreground hover:border-primary/50"
                      }`}
                    >
                      {d}
                    </button>
                  );
                })}
              </div>
              <span className="mt-1.5 block text-[11px] text-muted-foreground">
                Highlighted days are closed and show greyed out to customers.
              </span>
            </Field>

            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Slot step (min)">
                <input
                  className={inputCls}
                  type="number"
                  min={15}
                  step={15}
                  value={s.slotIncrementMinutes}
                  onChange={(e) => set("slotIncrementMinutes", Number(e.target.value))}
                />
              </Field>
              <Field label="Lead days" hint="0 = same day.">
                <input
                  className={inputCls}
                  type="number"
                  min={0}
                  value={s.leadDays}
                  onChange={(e) => set("leadDays", Number(e.target.value))}
                />
              </Field>
              <Field label="Window (days)">
                <input
                  className={inputCls}
                  type="number"
                  min={1}
                  value={s.bookingWindowDays}
                  onChange={(e) => set("bookingWindowDays", Number(e.target.value))}
                />
              </Field>
            </div>
          </div>
        </GlassCard>

        <AccountCard />
        <SecurityCard />
        <TeamCard />
      </div>
    </>
  );
}

function AccountCard() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    getMe().then((r) => {
      if (r.user) {
        setName(r.user.name);
        setEmail(r.user.email);
      }
    });
  }, []);

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await updateProfile({ data: { name: name.trim(), email: email.trim() } });
      setMsg({ ok: true, text: "Profile updated." });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Couldn't save." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <GlassCard index={2} className="p-6">
      <div className="flex items-center gap-2.5">
        <ShieldCheck className="h-4 w-4 text-primary" />
        <p className="text-[15px] font-semibold tracking-tight text-foreground">Your account</p>
      </div>

      <div className="mt-5 space-y-4">
        <Field label="Name">
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Email" hint="This is your sign-in address.">
          <input
            className={inputCls}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <AnimatePresence>
          {msg &&
            (msg.ok ? <SuccessNote>{msg.text}</SuccessNote> : <ErrorNote>{msg.text}</ErrorNote>)}
        </AnimatePresence>
        <Button variant="primary" loading={busy} onClick={save}>
          Update profile
        </Button>
      </div>
    </GlassCard>
  );
}

function SecurityCard() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const save = async () => {
    setMsg(null);
    if (next !== confirm) {
      setMsg({ ok: false, text: "New passwords don't match." });
      return;
    }
    setBusy(true);
    try {
      await changePassword({ data: { currentPassword: current, newPassword: next } });
      setCurrent("");
      setNext("");
      setConfirm("");
      setMsg({ ok: true, text: "Password changed. Other devices were signed out." });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Couldn't change password." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <GlassCard index={3} className="p-6">
      <div className="flex items-center gap-2.5">
        <KeyRound className="h-4 w-4 text-primary" />
        <p className="text-[15px] font-semibold tracking-tight text-foreground">Password</p>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Changing this signs out every other device immediately.
      </p>

      <div className="mt-5 space-y-4">
        <Field label="Current password">
          <input
            className={inputCls}
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </Field>
        <Field label="New password" hint="At least 10 characters, with a number.">
          <input
            className={inputCls}
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
        </Field>
        <Field label="Confirm new password">
          <input
            className={inputCls}
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </Field>
        <AnimatePresence>
          {msg &&
            (msg.ok ? <SuccessNote>{msg.text}</SuccessNote> : <ErrorNote>{msg.text}</ErrorNote>)}
        </AnimatePresence>
        <Button
          variant="primary"
          loading={busy}
          disabled={!current || !next}
          onClick={save}
        >
          Change password
        </Button>
      </div>
    </GlassCard>
  );
}
