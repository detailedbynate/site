import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  CalendarCheck,
  CheckCircle2,
  Copy,
  CreditCard,
  ExternalLink,
  Link2,
  Mail,
  Plug,
  RefreshCw,
  Save,
  Unplug,
  Webhook,
} from "lucide-react";

import {
  getAdminSettings,
  previewCalendarTemplate,
  saveCalendarTemplates,
  completeGoogleConnect,
  disconnectGoogle,
  getGoogleConsentUrl,
  getIntegrations,
  saveGoogleCredentials,
  setGoogleCalendar,
  testGoogleConnection,
} from "@/lib/api/admin.functions";
import {
  disconnectStripe,
  saveStripeSettings,
  saveWebhookSettings,
  testStripeConnection,
  testWebhook,
} from "@/lib/api/finance.functions";
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

export const Route = createFileRoute("/admin/integrations")({
  component: Integrations,
});

type Data = Awaited<ReturnType<typeof getIntegrations>>;

function Integrations() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [test, setTest] = useState<{ ok: boolean; detail: string } | null>(null);

  const flash = (m: string) => {
    setOk(m);
    setTimeout(() => setOk(null), 4000);
  };

  const load = async () => {
    try {
      const res = await getIntegrations();
      setData(res);
      setClientId(res.google.clientId);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load.");
    }
  };

  useEffect(() => {
    void load();
  }, []);

  // Google redirects back here with ?code=… — finish the handshake, then
  // strip the code from the URL so a refresh can't replay it.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const denied = params.get("error");

    if (denied) {
      setError(`Google returned "${denied}". Nothing was changed.`);
      window.history.replaceState({}, "", "/admin/integrations");
      return;
    }
    if (!code) return;

    setBusy("connect");
    completeGoogleConnect({ data: { code } })
      .then((r) => flash(`Connected${r.email ? ` as ${r.email}` : ""}. Pick a calendar below.`))
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't finish connecting."))
      .finally(async () => {
        window.history.replaceState({}, "", "/admin/integrations");
        setBusy(null);
        await load();
      });
  }, []);

  const saveCreds = async () => {
    setBusy("save");
    setError(null);
    try {
      await saveGoogleCredentials({ data: { clientId, clientSecret } });
      setClientSecret("");
      flash("Saved. Now click Connect Google account.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save.");
    } finally {
      setBusy(null);
    }
  };

  const connect = async () => {
    setBusy("connect");
    setError(null);
    try {
      const { url } = await getGoogleConsentUrl();
      window.location.href = url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start the connection.");
      setBusy(null);
    }
  };

  if (!data && !error) return <Spinner label="Loading integrations…" />;
  if (!data) return <ErrorNote>{error}</ErrorNote>;

  const g = data.google;

  return (
    <>
      <PageHeader
        title="Integrations"
        subtitle="Connect the outside services this shop relies on."
      />

      <AnimatePresence>
        {error && <ErrorNote>{error}</ErrorNote>}
        {ok && <SuccessNote>{ok}</SuccessNote>}
      </AnimatePresence>

      <GlassCard className="mt-5 p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--fill-2)]">
              <CalendarCheck className="h-5 w-5 text-primary" />
            </span>
            <div>
              <p className="text-[15px] font-semibold tracking-tight text-foreground">
                Google Calendar
              </p>
              <p className="mt-0.5 max-w-xl text-[12.5px] leading-relaxed text-muted-foreground">
                Two-way sync. Busy events on your calendar remove those times from the booking
                form, and every confirmed booking creates an event. Cancelling deletes it.
              </p>
            </div>
          </div>

          <span
            className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11.5px] font-semibold ring-1 ring-inset ${
              g.connected
                ? "bg-emerald-400/12 text-emerald-300 ring-emerald-400/25"
                : "bg-[var(--fill-2)] text-muted-foreground ring-[var(--line-2)]"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${g.connected ? "bg-emerald-400" : "bg-muted-foreground/60"}`}
            />
            {g.connected ? "Connected" : "Not connected"}
          </span>
        </div>

        {g.connected ? (
          <div className="mt-6 space-y-5">
            <div className="rounded-xl border border-[var(--line-2)] bg-[var(--fill-1)] px-4 py-3">
              <p className="text-[11px] text-muted-foreground">Google account</p>
              <p className="mt-0.5 text-[13.5px] font-semibold text-foreground">
                {g.accountEmail || "Connected account"}
              </p>
            </div>

            <Field
              label="Calendar to sync with"
              hint="Bookings are written here, and this calendar's busy times block your availability."
            >
              {g.listError ? (
                <p className="text-[12.5px] text-destructive">{g.listError}</p>
              ) : (
                <select
                  className={inputCls}
                  value={g.calendarId}
                  onChange={async (e) => {
                    setBusy("cal");
                    try {
                      await setGoogleCalendar({ data: { calendarId: e.target.value } });
                      flash("Calendar updated.");
                      await load();
                    } catch (err) {
                      setError(err instanceof Error ? err.message : "Couldn't switch calendar.");
                    } finally {
                      setBusy(null);
                    }
                  }}
                >
                  {g.calendars.length === 0 && <option value={g.calendarId}>{g.calendarId}</option>}
                  {g.calendars.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.summary}
                      {c.primary ? " (primary)" : ""}
                    </option>
                  ))}
                </select>
              )}
            </Field>

            <div className="flex flex-wrap gap-2">
              <Button
                loading={busy === "test"}
                onClick={async () => {
                  setBusy("test");
                  setTest(null);
                  try {
                    setTest(await testGoogleConnection());
                  } finally {
                    setBusy(null);
                  }
                }}
              >
                <RefreshCw className="h-3.5 w-3.5" /> Test connection
              </Button>
              <Button onClick={connect}>
                <Link2 className="h-3.5 w-3.5" /> Switch Google account
              </Button>
              <Button
                variant="danger"
                loading={busy === "disconnect"}
                onClick={async () => {
                  if (!confirm("Disconnect Google Calendar? Existing bookings are kept.")) return;
                  setBusy("disconnect");
                  try {
                    await disconnectGoogle();
                    flash("Disconnected.");
                    await load();
                  } finally {
                    setBusy(null);
                  }
                }}
              >
                <Unplug className="h-3.5 w-3.5" /> Disconnect
              </Button>
            </div>

            <AnimatePresence>
              {test && (
                <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}>
                  {test.ok ? (
                    <SuccessNote>{test.detail}</SuccessNote>
                  ) : (
                    <ErrorNote>{test.detail}</ErrorNote>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ) : (
          <div className="mt-6">
            <ol className="space-y-4">
              <Step n={1} title="Create a Google Cloud project and enable the Calendar API">
                <a
                  href="https://console.cloud.google.com/apis/library/calendar-json.googleapis.com"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                >
                  Open the Calendar API page <ExternalLink className="h-3 w-3" />
                </a>{" "}
                and click Enable.
              </Step>

              <Step n={2} title="Create an OAuth client">
                Go to{" "}
                <a
                  href="https://console.cloud.google.com/apis/credentials"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                >
                  Credentials <ExternalLink className="h-3 w-3" />
                </a>{" "}
                → Create credentials → OAuth client ID → application type{" "}
                <strong className="text-foreground">Web application</strong>. Under{" "}
                <em>Authorised redirect URIs</em>, add exactly this:
                <CopyRow value={g.redirectUri} />
                <span className="mt-1.5 block text-[11.5px] text-muted-foreground">
                  When you deploy to a real domain, add that version too — the URI must match the
                  address you're using at the time.
                </span>
              </Step>

              <Step n={3} title="Paste the credentials here">
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  <Field label="Client ID">
                    <input
                      className={inputCls}
                      value={clientId}
                      placeholder="1234-abc.apps.googleusercontent.com"
                      onChange={(e) => setClientId(e.target.value)}
                    />
                  </Field>
                  <Field
                    label="Client secret"
                    hint={g.hasClientSecret ? "A secret is saved. Leave blank to keep it." : undefined}
                  >
                    <input
                      className={inputCls}
                      type="password"
                      value={clientSecret}
                      placeholder={g.hasClientSecret ? "••••••••••" : "GOCSPX-..."}
                      onChange={(e) => setClientSecret(e.target.value)}
                    />
                  </Field>
                </div>
                <Button
                  variant="primary"
                  className="mt-3"
                  loading={busy === "save"}
                  disabled={!clientId}
                  onClick={saveCreds}
                >
                  Save credentials
                </Button>
              </Step>

              <Step n={4} title="Connect your Google account">
                Click below, choose the Google account whose calendar you want to use, and approve.
                You'll come straight back here.
                <Button
                  variant="primary"
                  className="mt-3"
                  loading={busy === "connect"}
                  disabled={!g.hasClientId || !g.hasClientSecret}
                  onClick={connect}
                >
                  <Link2 className="h-3.5 w-3.5" /> Connect Google account
                </Button>
                {(!g.hasClientId || !g.hasClientSecret) && (
                  <span className="mt-2 block text-[11.5px] text-muted-foreground">
                    Save your Client ID and secret first.
                  </span>
                )}
              </Step>
            </ol>
          </div>
        )}
      </GlassCard>

      <CalendarTemplateCard />

      <GlassCard className="mt-5 p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--fill-2)]">
              <Mail className="h-5 w-5 text-primary" />
            </span>
            <div>
              <p className="text-[15px] font-semibold tracking-tight text-foreground">
                Email (Resend)
              </p>
              <p className="mt-0.5 text-[12.5px] text-muted-foreground">
                Sends confirmations, reminders and follow-ups.{" "}
                <Link to="/admin/automation" className="text-primary hover:underline">
                  Configure it in Automation
                </Link>
                .
              </p>
            </div>
          </div>
          <span
            className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11.5px] font-semibold ring-1 ring-inset ${
              data.email.configured
                ? "bg-emerald-400/12 text-emerald-300 ring-emerald-400/25"
                : "bg-[var(--fill-2)] text-muted-foreground ring-[var(--line-2)]"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${data.email.configured ? "bg-emerald-400" : "bg-muted-foreground/60"}`}
            />
            {data.email.configured ? `Sending as ${data.email.from}` : "Not connected"}
          </span>
        </div>
      </GlassCard>

      <StripeCard data={data.stripe} onSaved={load} />

      <WebhookCard data={data.webhook} onSaved={load} />

      <GlassCard className="mt-5 p-6">
        <div className="flex items-center gap-2.5">
          <Plug className="h-4 w-4 text-muted-foreground" />
          <p className="text-[15px] font-semibold tracking-tight text-foreground">Also planned</p>
        </div>
        <p className="mt-2 text-[12.5px] text-muted-foreground">
          SMS reminders (Twilio), and accounting export to QuickBooks or Wave. Say the word and
          either can be wired up.
        </p>
      </GlassCard>
    </>
  );
}

const CAL_VARS = [
  "service","addOns","fullName","name","phone","email","vehicle","location",
  "date","time","total","reference","notes","customFields","business","businessPhone",
];

/** Lets the owner control exactly what a synced calendar event says. */
function CalendarTemplateCard() {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [preview, setPreview] = useState<{ title: string; description: string; usedSample: boolean } | null>(null);

  useEffect(() => {
    getAdminSettings()
      .then((r) => {
        setTitle(r.settings.calendarEventTitle);
        setBody(r.settings.calendarEventDescription);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  if (!loaded) return null;

  return (
    <GlassCard className="mt-5 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <CalendarCheck className="h-4 w-4 text-primary" />
            <p className="text-[15px] font-semibold tracking-tight text-foreground">
              Calendar event template
            </p>
          </div>
          <p className="mt-1 max-w-xl text-[12.5px] leading-relaxed text-muted-foreground">
            What each synced event says in Google Calendar. Click a tag to insert it.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                setPreview(await previewCalendarTemplate({ data: { title, description: body } }));
              } finally {
                setBusy(false);
              }
            }}
          >
            Preview
          </Button>
          <Button
            variant="primary"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              setMsg(null);
              try {
                await saveCalendarTemplates({
                  data: { calendarEventTitle: title, calendarEventDescription: body },
                });
                setMsg({ ok: true, text: "Saved. New bookings will use this." });
              } catch (e) {
                setMsg({ ok: false, text: e instanceof Error ? e.message : "Couldn't save." });
              } finally {
                setBusy(false);
              }
            }}
          >
            Save template
          </Button>
        </div>
      </div>

      <div className="mt-5 space-y-4">
        <Field label="Event title">
          <input
            className={inputCls}
            value={title}
            maxLength={300}
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>
        <Field label="Event description">
          <textarea
            className={`${inputCls} min-h-[180px] resize-y font-mono text-[12.5px] leading-relaxed`}
            value={body}
            maxLength={4000}
            onChange={(e) => setBody(e.target.value)}
          />
        </Field>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[11px] text-muted-foreground">Insert:</span>
          {CAL_VARS.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setBody((b) => `${b}{{${v}}}`)}
              className="rounded-md bg-[var(--fill-2)] px-2 py-1 font-mono text-[10.5px] text-muted-foreground ring-1 ring-inset ring-[var(--line-2)] transition hover:bg-[var(--fill-3)] hover:text-foreground"
            >
              {`{{${v}}}`}
            </button>
          ))}
        </div>

        <AnimatePresence>
          {msg &&
            (msg.ok ? <SuccessNote>{msg.text}</SuccessNote> : <ErrorNote>{msg.text}</ErrorNote>)}
        </AnimatePresence>

        <AnimatePresence>
          {preview && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="rounded-xl border border-[var(--line-2)] bg-[var(--fill-1)] p-4">
                <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  Preview{preview.usedSample ? " (sample data — no bookings yet)" : ""}
                </p>
                <p className="text-[14px] font-semibold text-foreground">{preview.title}</p>
                <pre className="mt-2 whitespace-pre-wrap font-sans text-[12.5px] leading-relaxed text-muted-foreground">
                  {preview.description}
                </pre>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </GlassCard>
  );
}

function Step({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--fill-3)] text-[11px] font-bold text-foreground">
        {n}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-semibold text-foreground">{title}</p>
        <div className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">{children}</div>
      </div>
    </li>
  );
}

function CopyRow({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-2 flex items-center gap-2 rounded-lg border border-[var(--line-2)] bg-black/25 px-3 py-2">
      <code className="min-w-0 flex-1 truncate font-mono text-[12px] text-foreground">{value}</code>
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1800);
          } catch {
            /* clipboard blocked — the value is selectable on screen anyway */
          }
        }}
        className="shrink-0 rounded-md p-1.5 text-muted-foreground transition hover:bg-[var(--fill-3)] hover:text-foreground"
      >
        {copied ? (
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
        ) : (
          <Copy className="h-3.5 w-3.5" />
        )}
      </button>
    </div>
  );
}

// ============================ Stripe ====================================

function StripeCard({
  data,
  onSaved,
}: {
  data: Awaited<ReturnType<typeof getIntegrations>>["stripe"];
  onSaved: () => Promise<void>;
}) {
  const [secret, setSecret] = useState("");
  const [publishable, setPublishable] = useState(data.publishableKey);
  const [currency, setCurrency] = useState(data.currency);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const run = async (id: string, fn: () => Promise<string>) => {
    setBusy(id);
    setNote(null);
    try {
      setNote({ ok: true, text: await fn() });
      await onSaved();
    } catch (e) {
      setNote({ ok: false, text: e instanceof Error ? e.message : "That didn't work." });
    } finally {
      setBusy(null);
    }
  };

  return (
    <GlassCard className="mt-5 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--fill-2)]">
            <CreditCard className="h-5 w-5 text-primary" />
          </span>
          <div>
            <p className="text-[15px] font-semibold tracking-tight text-foreground">Stripe</p>
            <p className="mt-0.5 max-w-xl text-[12.5px] text-muted-foreground">
              Send a customer a card payment link for what they owe. Created from the Payments
              page once connected.
            </p>
          </div>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11.5px] font-semibold ring-1 ring-inset ${
            data.configured
              ? "bg-emerald-400/12 text-emerald-300 ring-emerald-400/25"
              : "bg-[var(--fill-2)] text-muted-foreground ring-[var(--line-2)]"
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${data.configured ? "bg-emerald-400" : "bg-muted-foreground/60"}`}
          />
          {data.configured
            ? data.accountName
              ? `${data.accountName}${data.livemode ? "" : " (test mode)"}`
              : `Key ${data.keyHint}`
            : "Not connected"}
        </span>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <Field
          label="Secret key"
          hint={
            data.configured
              ? `Saved (${data.keyHint}). Enter a new one to replace it.`
              : "From Stripe, under Developers then API keys. Starts with sk_"
          }
        >
          <input
            className={inputCls}
            type="password"
            value={secret}
            placeholder={data.configured ? "••••••••••••" : "sk_test_…"}
            autoComplete="off"
            onChange={(e) => setSecret(e.target.value)}
          />
        </Field>
        <Field label="Publishable key" hint="Optional, safe to expose. Starts with pk_">
          <input
            className={inputCls}
            value={publishable}
            placeholder="pk_test_…"
            autoComplete="off"
            onChange={(e) => setPublishable(e.target.value)}
          />
        </Field>
      </div>

      <div className="mt-4 max-w-[220px]">
        <Field label="Currency">
          <select className={inputCls} value={currency} onChange={(e) => setCurrency(e.target.value)}>
            <option value="cad">CAD — Canadian dollar</option>
            <option value="usd">USD — US dollar</option>
            <option value="gbp">GBP — Pound sterling</option>
            <option value="eur">EUR — Euro</option>
            <option value="aud">AUD — Australian dollar</option>
          </select>
        </Field>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          loading={busy === "save"}
          onClick={() =>
            run("save", async () => {
              await saveStripeSettings({
                data: {
                  // Blank means "leave the stored key alone" — otherwise
                  // saving the currency would wipe the key.
                  ...(secret.trim() ? { stripeSecretKey: secret.trim() } : {}),
                  stripePublishableKey: publishable.trim(),
                  stripeCurrency: currency,
                },
              });
              setSecret("");
              return "Saved.";
            })
          }
        >
          <Save className="h-3.5 w-3.5" /> Save
        </Button>

        <Button
          loading={busy === "test"}
          disabled={!data.configured}
          onClick={() =>
            run("test", async () => {
              const info = await testStripeConnection();
              return `Connected to ${info.accountName}${info.country ? ` (${info.country})` : ""}${
                info.livemode ? "" : " — test mode"
              }.`;
            })
          }
        >
          Test connection
        </Button>

        {data.configured && (
          <Button
            variant="danger"
            loading={busy === "off"}
            onClick={() =>
              run("off", async () => {
                if (!confirm("Disconnect Stripe? Existing bookings are unaffected.")) {
                  throw new Error("Cancelled.");
                }
                await disconnectStripe();
                return "Disconnected.";
              })
            }
          >
            Disconnect
          </Button>
        )}
      </div>

      <AnimatePresence>
        {note && (
          <motion.p
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className={`mt-3 text-[12.5px] font-semibold ${note.ok ? "text-emerald-300" : "text-destructive"}`}
          >
            {note.text}
          </motion.p>
        )}
      </AnimatePresence>

      <p className="mt-4 rounded-lg bg-[var(--fill-1)] px-3.5 py-2.5 text-[11.5px] leading-relaxed text-muted-foreground ring-1 ring-inset ring-[var(--line-1)]">
        The site never handles card numbers — Stripe hosts the payment page. Deposits at booking
        time, and marking a job paid automatically when a link is settled, would each need more
        wiring: right now a link is created on demand and you mark it paid once the money lands.
      </p>
    </GlassCard>
  );
}

// ============================ Webhooks ==================================

const WEBHOOK_EVENTS = [
  { id: "booking_created", label: "Booking created" },
  { id: "booking_cancelled", label: "Booking cancelled" },
  { id: "booking_completed", label: "Job completed" },
] as const;

type WebhookEventId = (typeof WEBHOOK_EVENTS)[number]["id"];

function WebhookCard({
  data,
  onSaved,
}: {
  data: Awaited<ReturnType<typeof getIntegrations>>["webhook"];
  onSaved: () => Promise<void>;
}) {
  const [url, setUrl] = useState(data.url);
  const [secret, setSecret] = useState("");
  const [events, setEvents] = useState<string[]>(data.events);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const run = async (id: string, fn: () => Promise<string>) => {
    setBusy(id);
    setNote(null);
    try {
      setNote({ ok: true, text: await fn() });
      await onSaved();
    } catch (e) {
      setNote({ ok: false, text: e instanceof Error ? e.message : "That didn't work." });
    } finally {
      setBusy(null);
    }
  };

  return (
    <GlassCard className="mt-5 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--fill-2)]">
            <Webhook className="h-5 w-5 text-primary" />
          </span>
          <div>
            <p className="text-[15px] font-semibold tracking-tight text-foreground">Webhooks</p>
            <p className="mt-0.5 max-w-xl text-[12.5px] text-muted-foreground">
              POST every booking event to a URL of your choice — Zapier, Make, n8n, or your own
              script. This is how you connect anything not listed here.
            </p>
          </div>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11.5px] font-semibold ring-1 ring-inset ${
            data.url
              ? "bg-emerald-400/12 text-emerald-300 ring-emerald-400/25"
              : "bg-[var(--fill-2)] text-muted-foreground ring-[var(--line-2)]"
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${data.url ? "bg-emerald-400" : "bg-muted-foreground/60"}`}
          />
          {data.url ? "Active" : "Not set up"}
        </span>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <Field label="Endpoint URL" hint="Must use https.">
          <input
            className={inputCls}
            value={url}
            placeholder="https://hooks.zapier.com/…"
            onChange={(e) => setUrl(e.target.value)}
          />
        </Field>
        <Field
          label="Signing secret"
          hint={
            data.hasSecret
              ? "Saved. Enter a new value to replace it."
              : "Optional. Sent as an HMAC-SHA256 digest in x-dbn-signature."
          }
        >
          <input
            className={inputCls}
            type="password"
            value={secret}
            placeholder={data.hasSecret ? "••••••••••••" : "any long random string"}
            autoComplete="off"
            onChange={(e) => setSecret(e.target.value)}
          />
        </Field>
      </div>

      <div className="mt-4">
        <p className="mb-2 text-[12px] font-medium text-muted-foreground">Send on</p>
        <div className="flex flex-wrap gap-1.5">
          {WEBHOOK_EVENTS.map((e) => {
            const on = events.includes(e.id);
            return (
              <button
                key={e.id}
                type="button"
                onClick={() =>
                  setEvents((cur) =>
                    cur.includes(e.id) ? cur.filter((x) => x !== e.id) : [...cur, e.id],
                  )
                }
                className={`rounded-lg px-3 py-1.5 text-[12px] font-semibold ring-1 ring-inset transition ${
                  on
                    ? "bg-primary/12 text-primary ring-primary/30"
                    : "bg-[var(--fill-2)] text-muted-foreground ring-[var(--line-2)] hover:text-foreground"
                }`}
              >
                {e.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          loading={busy === "save"}
          onClick={() =>
            run("save", async () => {
              await saveWebhookSettings({
                data: {
                  webhookUrl: url.trim(),
                  ...(secret.trim() ? { webhookSecret: secret.trim() } : {}),
                  webhookEvents: events as WebhookEventId[],
                },
              });
              setSecret("");
              return "Saved.";
            })
          }
        >
          <Save className="h-3.5 w-3.5" /> Save
        </Button>
        <Button
          loading={busy === "test"}
          disabled={!data.url}
          onClick={() =>
            run("test", async () => {
              const res = await testWebhook();
              return res.ok
                ? `Endpoint replied ${res.status}.`
                : `Endpoint replied ${res.status} — it received the call but rejected it.`;
            })
          }
        >
          Send test
        </Button>
      </div>

      <AnimatePresence>
        {note && (
          <motion.p
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className={`mt-3 text-[12.5px] font-semibold ${note.ok ? "text-emerald-300" : "text-destructive"}`}
          >
            {note.text}
          </motion.p>
        )}
      </AnimatePresence>
    </GlassCard>
  );
}
