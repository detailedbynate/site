import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AnimatePresence } from "motion/react";
import { BarChart3, ExternalLink, FileText, Scale } from "lucide-react";

import { getSitePages, saveSitePages } from "@/lib/api/admin.functions";
import { TabBar } from "@/components/admin/TabBar";
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

export const Route = createFileRoute("/admin/pages")({
  component: SitePages,
});

type Data = Awaited<ReturnType<typeof getSitePages>>;

const editorCls =
  "w-full rounded-xl border border-[var(--line-2)] bg-[var(--fill-1)] px-4 py-3 font-mono text-[12.5px] leading-relaxed text-foreground outline-none transition focus:border-primary/60";

function SitePages() {
  const [d, setD] = useState<Data | null>(null);
  const [tab, setTab] = useState<"privacy" | "terms" | "analytics">("privacy");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getSitePages()
      .then(setD)
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load."));
  }, []);

  if (!d && !error) return <Spinner label="Loading pages…" />;
  if (!d) return <ErrorNote>{error}</ErrorNote>;

  const set = <K extends keyof Data>(k: K, v: Data[K]) => setD({ ...d, [k]: v });

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await saveSitePages({
        data: {
          privacyBody: d.privacyBody,
          termsBody: d.termsBody,
          analyticsScriptUrl: d.analyticsScriptUrl,
          analyticsSiteId: d.analyticsSiteId,
        },
      });
      setD({
        ...d,
        privacyUpdated: res.settings.privacyUpdated,
        termsUpdated: res.settings.termsUpdated,
      });
      setOk("Saved. The public pages update immediately.");
      setTimeout(() => setOk(null), 3500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  };

  const isPrivacy = tab === "privacy";
  const body = isPrivacy ? d.privacyBody : d.termsBody;
  const fallback = isPrivacy ? d.defaultPrivacy : d.defaultTerms;
  const updated = isPrivacy ? d.privacyUpdated : d.termsUpdated;
  const usingDefault = !body.trim();

  return (
    <>
      <PageHeader
        title="Pages & analytics"
        subtitle="Your privacy policy, terms, and how you measure traffic."
        actions={
          <Button loading={busy} onClick={save}>
            Save
          </Button>
        }
      />

      <AnimatePresence>
        {error && <ErrorNote>{error}</ErrorNote>}
        {ok && <SuccessNote>{ok}</SuccessNote>}
      </AnimatePresence>

      <TabBar
        layoutId="site-pages"
        value={tab}
        onChange={(v) => setTab(v as typeof tab)}
        tabs={[
          { value: "privacy", label: "Privacy policy" },
          { value: "terms", label: "Terms" },
          { value: "analytics", label: "Analytics" },
        ]}
      />

      {tab !== "analytics" ? (
        <GlassCard className="mt-5 p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--fill-2)]">
                {isPrivacy ? (
                  <Scale className="h-5 w-5 text-primary" />
                ) : (
                  <FileText className="h-5 w-5 text-primary" />
                )}
              </span>
              <div>
                <p className="text-[15px] font-semibold tracking-tight text-foreground">
                  {isPrivacy ? "Privacy Policy" : "Terms of Service"}
                </p>
                <p className="mt-0.5 text-[12.5px] text-muted-foreground">
                  {usingDefault
                    ? "Showing the starting draft. Edit it and save to make it yours."
                    : `Your own wording. Last updated ${updated || "—"}.`}
                </p>
              </div>
            </div>
            <a
              href={isPrivacy ? "/privacy" : "/terms"}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-muted-foreground transition-colors hover:text-foreground"
            >
              View page <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>

          <div className="mt-5">
            <Field
              label="Page text"
              hint="Plain text. A line starting with ## is a heading, a line starting with - is a bullet, **bold** works, and a blank line starts a new paragraph."
            >
              <textarea
                className={`${editorCls} min-h-[420px] resize-y`}
                value={body || fallback}
                onChange={(e) =>
                  set(isPrivacy ? "privacyBody" : "termsBody", e.target.value as never)
                }
              />
            </Field>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => set(isPrivacy ? "privacyBody" : "termsBody", fallback as never)}
            >
              Restore the starting draft
            </Button>
            <p className="text-[11.5px] text-muted-foreground">
              {"{{business}}, {{email}}, {{phone}} and {{cancellationPolicy}} fill themselves in from Settings."}
            </p>
          </div>

          <p className="mt-5 rounded-xl bg-[var(--fill-1)] px-4 py-3 text-[12px] leading-relaxed text-muted-foreground">
            These drafts describe what this site actually does — the fields the booking form
            collects, and Stripe, Resend and Google Calendar as the only services your data
            reaches. They are a starting point, not legal advice. Read them, make them true for
            your business, and get anything that matters checked.
          </p>
        </GlassCard>
      ) : (
        <GlassCard className="mt-5 p-5 sm:p-6">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--fill-2)]">
              <BarChart3 className="h-5 w-5 text-primary" />
            </span>
            <div>
              <p className="text-[15px] font-semibold tracking-tight text-foreground">Analytics</p>
              <p className="mt-0.5 max-w-xl text-[12.5px] leading-relaxed text-muted-foreground">
                For a cookieless provider — Plausible, Fathom or Umami. Deliberately not Google
                Analytics: a cookieless script needs no consent banner, and the only cookie this
                site sets anywhere is the admin session.
              </p>
            </div>
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <Field
              label="Script URL"
              hint="e.g. https://plausible.io/js/script.js — leave blank for no analytics."
            >
              <input
                className={inputCls}
                value={d.analyticsScriptUrl}
                placeholder="https://plausible.io/js/script.js"
                onChange={(e) => set("analyticsScriptUrl", e.target.value as never)}
              />
            </Field>
            <Field label="Site / domain" hint="Sent as data-domain. Your domain, no https://.">
              <input
                className={inputCls}
                value={d.analyticsSiteId}
                placeholder="detailedbynate.com"
                onChange={(e) => set("analyticsSiteId", e.target.value as never)}
              />
            </Field>
          </div>
        </GlassCard>
      )}
    </>
  );
}
