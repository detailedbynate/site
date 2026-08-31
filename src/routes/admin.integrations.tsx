import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  CalendarCheck,
  CheckCircle2,
  Copy,
  ExternalLink,
  Link2,
  Mail,
  Plug,
  RefreshCw,
  Unplug,
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
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/[0.06]">
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
                : "bg-white/[0.05] text-muted-foreground ring-white/[0.09]"
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
            <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] px-4 py-3">
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
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/[0.06]">
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
                : "bg-white/[0.05] text-muted-foreground ring-white/[0.09]"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${data.email.configured ? "bg-emerald-400" : "bg-muted-foreground/60"}`}
            />
            {data.email.configured ? `Sending as ${data.email.from}` : "Not connected"}
          </span>
        </div>
      </GlassCard>

      <GlassCard className="mt-5 p-6">
        <div className="flex items-center gap-2.5">
          <Plug className="h-4 w-4 text-muted-foreground" />
          <p className="text-[15px] font-semibold tracking-tight text-foreground">Also planned</p>
        </div>
        <p className="mt-2 text-[12.5px] text-muted-foreground">
          Stripe or Square for deposits, SMS reminders, and webhooks. Say the word and I'll wire
          any of them up.
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
              className="rounded-md bg-white/[0.05] px-2 py-1 font-mono text-[10.5px] text-muted-foreground ring-1 ring-inset ring-white/[0.07] transition hover:bg-white/[0.1] hover:text-foreground"
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
              <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
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
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/[0.07] text-[11px] font-bold text-foreground">
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
    <div className="mt-2 flex items-center gap-2 rounded-lg border border-white/[0.09] bg-black/25 px-3 py-2">
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
        className="shrink-0 rounded-md p-1.5 text-muted-foreground transition hover:bg-white/[0.08] hover:text-foreground"
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
