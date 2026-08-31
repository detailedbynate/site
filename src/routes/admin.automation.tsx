import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, Mail, Play, Plus, Save, Send, Trash2, Workflow, X } from "lucide-react";

import {
  createCustomRule,
  getAutomation,
  removeCustomRule,
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
  Portal,
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
  type NewRule = {
    name: string;
    trigger: "booking_confirmed" | "reminder" | "after_service" | "booking_cancelled";
    subject: string;
    body: string;
    offsetHours: number;
  };
  const [newRule, setNewRule] = useState<NewRule | null>(null);

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
          id: rule.id as never,
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

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[15px] font-semibold tracking-tight text-foreground">Workflows</p>
          <p className="text-[12.5px] text-muted-foreground">
            The four built-in ones can be edited or switched off. Add your own to send extra
            emails at the same trigger points.
          </p>
        </div>
        <Button
          variant="primary"
          onClick={() =>
            setNewRule({
              name: "",
              trigger: "after_service",
              subject: "",
              body: "",
              offsetHours: 24,
            })
          }
        >
          <Plus className="h-3.5 w-3.5" /> New workflow
        </Button>
      </div>

      <div className="space-y-4">
        {data.rules.map((rule, i) => {
          const draft = drafts[rule.id] ?? rule;
          const meta = rule.custom
            ? {
                title: rule.name ?? "Custom workflow",
                blurb: "Custom workflow",
                timing:
                  rule.trigger === "reminder"
                    ? "hours before the appointment"
                    : rule.trigger === "after_service"
                      ? "hours after the job ends"
                      : undefined,
              }
            : META[rule.id];
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
                <div className="flex items-center gap-2">
                  <ToggleChip
                    on={draft.enabled}
                    labels={["On", "Off"]}
                    onChange={(next) =>
                      setDrafts({ ...drafts, [rule.id]: { ...draft, enabled: next } })
                    }
                  />
                  {rule.custom && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        if (!confirm("Delete this workflow?")) return;
                        await removeCustomRule({ data: { id: rule.id } });
                        await load();
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
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

      <AnimatePresence>
        {newRule && (
          <Portal>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setNewRule(null)}
              className="admin-theme fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-[3px]"
            >
              <motion.div
                initial={{ scale: 0.96, y: 16 }}
                animate={{ scale: 1, y: 0 }}
                exit={{ scale: 0.98, y: 8 }}
                onClick={(e) => e.stopPropagation()}
                className="max-h-[88vh] w-full max-w-lg overflow-y-auto overscroll-contain rounded-2xl border border-white/[0.08] bg-[var(--card)] p-6"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2.5">
                    <Workflow className="h-4 w-4 text-primary" />
                    <h2 className="text-lg font-bold tracking-tight text-foreground">
                      New workflow
                    </h2>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => setNewRule(null)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>

                <div className="mt-5 space-y-4">
                  <Field label="Name" hint="Just for you - customers never see it.">
                    <input
                      className={inputCls}
                      value={newRule.name}
                      maxLength={80}
                      placeholder="Second review nudge"
                      onChange={(e) => setNewRule({ ...newRule, name: e.target.value })}
                    />
                  </Field>

                  <Field label="When should it send?">
                    <select
                      className={inputCls}
                      value={newRule.trigger}
                      onChange={(e) =>
                        setNewRule({
                          ...newRule,
                          trigger: e.target.value as NewRule["trigger"],
                        })
                      }
                    >
                      <option value="booking_confirmed">When a booking is made</option>
                      <option value="reminder">Before the appointment</option>
                      <option value="after_service">After the job is finished</option>
                      <option value="booking_cancelled">When a booking is cancelled</option>
                    </select>
                  </Field>

                  {(newRule.trigger === "reminder" || newRule.trigger === "after_service") && (
                    <Field label="Hours offset">
                      <input
                        className={inputCls}
                        type="number"
                        min={0}
                        max={720}
                        value={newRule.offsetHours}
                        onChange={(e) =>
                          setNewRule({ ...newRule, offsetHours: Number(e.target.value) })
                        }
                      />
                    </Field>
                  )}

                  <Field label="Subject">
                    <input
                      className={inputCls}
                      value={newRule.subject}
                      maxLength={200}
                      onChange={(e) => setNewRule({ ...newRule, subject: e.target.value })}
                    />
                  </Field>

                  <Field label="Message">
                    <textarea
                      className={`${inputCls} min-h-[150px] resize-y font-mono text-[12.5px]`}
                      value={newRule.body}
                      maxLength={5000}
                      onChange={(e) => setNewRule({ ...newRule, body: e.target.value })}
                    />
                  </Field>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="mr-1 text-[11px] text-muted-foreground">Insert:</span>
                    {VARS.map((v) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => setNewRule({ ...newRule, body: `${newRule.body}{{${v}}}` })}
                        className="rounded-md bg-white/[0.05] px-2 py-1 font-mono text-[10.5px] text-muted-foreground ring-1 ring-inset ring-white/[0.07] transition hover:bg-white/[0.1] hover:text-foreground"
                      >
                        {`{{${v}}}`}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="mt-6 flex justify-end gap-2">
                  <Button onClick={() => setNewRule(null)}>Cancel</Button>
                  <Button
                    variant="primary"
                    disabled={
                      !newRule.name.trim() || !newRule.subject.trim() || !newRule.body.trim()
                    }
                    onClick={async () => {
                      try {
                        await createCustomRule({ data: { ...newRule, enabled: true } });
                        setNewRule(null);
                        flash("Workflow created.");
                        await load();
                      } catch (e) {
                        setError(e instanceof Error ? e.message : "Could not create it.");
                      }
                    }}
                  >
                    Create workflow
                  </Button>
                </div>
              </motion.div>
            </motion.div>
          </Portal>
        )}
      </AnimatePresence>

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
