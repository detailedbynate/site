import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, Mail, Play, Save, Send } from "lucide-react";

import {
  getAutomation,
  runAutomationNow,
  saveEmailRule,
  saveEmailSettings,
} from "@/lib/api/admin.functions";
import {
  Button,
  ErrorNote,
  Field,
  GlassCard,
  PageHeader,
  Spinner,
  SuccessNote,
  ToggleChip,
  inputCls,
} from "@/components/admin/ui";

export const Route = createFileRoute("/admin/automation")({
  component: Automation,
});

type Data = Awaited<ReturnType<typeof getAutomation>>;
type Rule = Data["rules"][number];

const META: Record<string, { title: string; blurb: string; timing?: string }> = {
  booking_confirmed: {
    title: "Booking confirmation",
    blurb: "Sent the moment someone books.",
  },
  reminder: {
    title: "Appointment reminder",
    blurb: "A nudge before the job so nobody forgets.",
    timing: "hours before the appointment",
  },
  after_service: {
    title: "Follow-up / review request",
    blurb: "Sent after the detail is finished.",
    timing: "hours after the job ends",
  },
  booking_cancelled: {
    title: "Cancellation notice",
    blurb: "Sent when you cancel a booking.",
  },
};

const VARS = [
  "name",
  "fullName",
  "service",
  "addOns",
  "date",
  "time",
  "total",
  "reference",
  "location",
  "vehicle",
  "business",
  "businessPhone",
];

function Automation() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Rule>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  // Email credentials
  const [apiKey, setApiKey] = useState("");
  const [from, setFrom] = useState("");
  const [replyTo, setReplyTo] = useState("");
  const [savingCreds, setSavingCreds] = useState(false);

  const load = async () => {
    try {
      const res = await getAutomation();
      setData(res);
      setDrafts(Object.fromEntries(res.rules.map((r) => [r.id, { ...r }])));
      setFrom(res.from);
      setReplyTo(res.replyTo);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load.");
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const flash = (m: string) => {
    setOk(m);
    setTimeout(() => setOk(null), 3500);
  };

  const saveRule = async (rule: Rule) => {
    setSavingId(rule.id);
    setError(null);
    try {
      await saveEmailRule({
        data: {
          id: rule.id,
          enabled: rule.enabled,
          subject: rule.subject,
          body: rule.body,
          offsetHours: rule.offsetHours,
        },
      });
      flash("Saved.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save.");
    } finally {
      setSavingId(null);
    }
  };

  const saveCreds = async () => {
    setSavingCreds(true);
    setError(null);
    try {
      await saveEmailSettings({
        data: { resendApiKey: apiKey, emailFrom: from, emailReplyTo: replyTo },
      });
      setApiKey("");
      flash("Email settings saved.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save.");
    } finally {
      setSavingCreds(false);
    }
  };

  if (!data && !error) return <Spinner label="Loading automation…" />;
  if (!data) return <ErrorNote>{error}</ErrorNote>;

  return (
    <>
      <PageHeader
        title="Automation"
        subtitle="Emails that send themselves — confirmations, reminders and follow-ups."
        actions={
          <Button
            loading={running}
            onClick={async () => {
              setRunning(true);
              try {
                const r = await runAutomationNow();
                flash(`Checked ${r.checked} bookings, sent ${r.sent}.`);
                await load();
              } catch (e) {
                setError(e instanceof Error ? e.message : "Failed.");
              } finally {
                setRunning(false);
              }
            }}
          >
            <Play className="h-3.5 w-3.5" /> Run now
          </Button>
        }
      />

      <AnimatePresence>
        {error && <ErrorNote>{error}</ErrorNote>}
        {ok && <SuccessNote>{ok}</SuccessNote>}
      </AnimatePresence>

      {!data.configured && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-5 flex items-start gap-3 rounded-xl bg-amber-400/10 px-4 py-3 ring-1 ring-inset ring-amber-400/25"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
          <p className="text-[13px] text-amber-100">
            <span className="font-semibold">Email isn't connected yet.</span> Rules below are saved
            but nothing sends. Add a Resend API key and a verified from-address to switch it on.
          </p>
        </motion.div>
      )}

      <GlassCard className="mb-5 p-6">
        <div className="flex items-center gap-2.5">
          <Mail className="h-4 w-4 text-primary" />
          <p className="text-[15px] font-semibold tracking-tight text-foreground">
            Email connection
          </p>
        </div>
        <p className="mt-1 text-[12.5px] text-muted-foreground">
          Uses{" "}
          <a
            href="https://resend.com"
            target="_blank"
            rel="noreferrer"
            className="text-primary hover:underline"
          >
            Resend
          </a>{" "}
          — free for 3,000 emails a month. Create an API key, verify your domain, paste it here.
        </p>

        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          <Field
            label="API key"
            hint={data.hasKey ? "A key is saved. Leave blank to keep it." : "Starts with re_"}
          >
            <input
              className={inputCls}
              type="password"
              value={apiKey}
              placeholder={data.hasKey ? "••••••••••••" : "re_..."}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </Field>
          <Field label="From address" hint="Must be on a domain you verified.">
            <input
              className={inputCls}
              value={from}
              placeholder="bookings@detailedbynate.com"
              onChange={(e) => setFrom(e.target.value)}
            />
          </Field>
          <Field label="Reply-to" hint="Optional.">
            <input
              className={inputCls}
              value={replyTo}
              placeholder="nate@detailedbynate.com"
              onChange={(e) => setReplyTo(e.target.value)}
            />
          </Field>
        </div>

        <Button variant="primary" className="mt-4" loading={savingCreds} onClick={saveCreds}>
          <Save className="h-3.5 w-3.5" /> Save connection
        </Button>
      </GlassCard>

      <div className="space-y-4">
        {data.rules.map((rule, i) => {
          const draft = drafts[rule.id] ?? rule;
          const meta = META[rule.id];
          const dirty = JSON.stringify(draft) !== JSON.stringify(rule);
          return (
            <GlassCard key={rule.id} index={i} className="p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-[15px] font-semibold tracking-tight text-foreground">
                    {meta.title}
                  </p>
                  <p className="mt-0.5 text-[12.5px] text-muted-foreground">{meta.blurb}</p>
                </div>
                <ToggleChip
                  on={draft.enabled}
                  labels={["On", "Off"]}
                  onChange={(next) =>
                    setDrafts({ ...drafts, [rule.id]: { ...draft, enabled: next } })
                  }
                />
              </div>

              <div className="mt-5 space-y-4">
                {meta.timing && (
                  <Field label="Timing">
                    <div className="flex items-center gap-2">
                      <input
                        className={`${inputCls} w-24`}
                        type="number"
                        min={0}
                        max={720}
                        value={draft.offsetHours}
                        onChange={(e) =>
                          setDrafts({
                            ...drafts,
                            [rule.id]: { ...draft, offsetHours: Number(e.target.value) },
                          })
                        }
                      />
                      <span className="text-[12.5px] text-muted-foreground">{meta.timing}</span>
                    </div>
                  </Field>
                )}

                <Field label="Subject">
                  <input
                    className={inputCls}
                    value={draft.subject}
                    maxLength={200}
                    onChange={(e) =>
                      setDrafts({ ...drafts, [rule.id]: { ...draft, subject: e.target.value } })
                    }
                  />
                </Field>

                <Field label="Message">
                  <textarea
                    className={`${inputCls} min-h-[190px] resize-y font-mono text-[12.5px] leading-relaxed`}
                    value={draft.body}
                    maxLength={5000}
                    onChange={(e) =>
                      setDrafts({ ...drafts, [rule.id]: { ...draft, body: e.target.value } })
                    }
                  />
                </Field>

                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="mr-1 text-[11px] text-muted-foreground">Insert:</span>
                  {VARS.map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() =>
                        setDrafts({
                          ...drafts,
                          [rule.id]: { ...draft, body: `${draft.body}{{${v}}}` },
                        })
                      }
                      className="rounded-md bg-white/[0.05] px-2 py-1 font-mono text-[10.5px] text-muted-foreground ring-1 ring-inset ring-white/[0.07] transition hover:bg-white/[0.1] hover:text-foreground"
                    >
                      {`{{${v}}}`}
                    </button>
                  ))}
                </div>

                <Button
                  variant={dirty ? "primary" : "outline"}
                  loading={savingId === rule.id}
                  disabled={!dirty}
                  onClick={() => saveRule(draft)}
                >
                  <Save className="h-3.5 w-3.5" /> {dirty ? "Save changes" : "Saved"}
                </Button>
              </div>
            </GlassCard>
          );
        })}
      </div>

      <GlassCard className="mt-5 p-6">
        <div className="flex items-center gap-2.5">
          <Send className="h-4 w-4 text-primary" />
          <p className="text-[15px] font-semibold tracking-tight text-foreground">Recent sends</p>
        </div>
        {data.log.length === 0 ? (
          <p className="mt-3 text-[13px] text-muted-foreground">Nothing sent yet.</p>
        ) : (
          <div className="mt-4 space-y-1.5">
            {data.log.map((e) => (
              <div
                key={e.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-white/[0.03] px-3 py-2 text-[12px]"
              >
                <span
                  className={`rounded px-1.5 py-0.5 text-[10.5px] font-semibold ${
                    e.status === "sent"
                      ? "bg-emerald-400/12 text-emerald-300"
                      : e.status === "failed"
                        ? "bg-destructive/12 text-destructive"
                        : "bg-white/[0.06] text-muted-foreground"
                  }`}
                >
                  {e.status}
                </span>
                <span className="text-muted-foreground">{e.to}</span>
                <span className="min-w-0 flex-1 truncate text-foreground">{e.subject}</span>
                {e.error && (
                  <span className="truncate text-[11px] text-muted-foreground">{e.error}</span>
                )}
                <span className="text-[11px] text-muted-foreground">
                  {new Date(e.createdAt).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </GlassCard>
    </>
  );
}
