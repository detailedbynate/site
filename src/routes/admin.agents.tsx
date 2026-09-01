import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  BadgeCheck,
  CalendarClock,
  CircleUser,
  Clock,
  Mail,
  Phone,
  Plus,
  Trash2,
  UserPlus,
  Users,
  Wallet,
} from "lucide-react";

import { listAdminAgents, removeAgent, saveAgent } from "@/lib/api/operations.functions";
import { EditorModal, FieldRow } from "@/components/admin/EditorModal";
import { AvatarPicker } from "@/components/admin/AvatarPicker";
import { getAvatars } from "@/lib/api/content.functions";
import {
  Button,
  EmptyState,
  ErrorNote,
  Field,
  GlassCard,
  PageHeader,
  Spinner,
  StatTile,
  SuccessNote,
  ToggleChip,
  inputCls,
  money,
} from "@/components/admin/ui";

export const Route = createFileRoute("/admin/agents")({
  component: Agents,
});

type Data = Awaited<ReturnType<typeof listAdminAgents>>;
type Agent = Data["agents"][number];

const COLORS = ["#38bdf8", "#a78bfa", "#34d399", "#fbbf24", "#fb7185", "#f472b6", "#2dd4bf", "#f97316"];

const uid = () =>
  globalThis.crypto?.randomUUID?.() ?? `g-${Date.now()}-${Math.random().toString(16).slice(2)}`;

function blank(sortOrder: number): Agent {
  return {
    id: uid(),
    name: "",
    email: "",
    phone: "",
    title: "",
    payType: "none",
    payRate: 0,
    color: COLORS[sortOrder % COLORS.length],
    userId: undefined,
    notes: undefined,
    active: true,
    sortOrder,
    createdAt: new Date().toISOString(),
    jobsAssigned: 0,
    jobsCompleted: 0,
    upcoming: 0,
    revenue: 0,
    hours: 0,
    estimatedPay: 0,
    linkedAccount: null,
  };
}

function Agents() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [draft, setDraft] = useState<Agent | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await listAdminAgents());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const flash = (m: string) => {
    setOk(m);
    setTimeout(() => setOk(null), 2600);
  };

  const save = async () => {
    if (!draft) return;
    if (!draft.name.trim()) return setError("Give them a name.");
    setSaving(true);
    setError(null);
    try {
      await saveAgent({
        data: {
          id: draft.id,
          name: draft.name.trim(),
          email: draft.email.trim(),
          phone: draft.phone.trim(),
          title: draft.title.trim(),
          payType: draft.payType,
          payRate: Number(draft.payRate) || 0,
          color: draft.color,
          userId: draft.userId || undefined,
          notes: draft.notes?.trim() || undefined,
          active: draft.active,
          sortOrder: draft.sortOrder,
        },
      });
      setDraft(null);
      flash(isNew ? "Team member added." : "Saved.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  };

  const del = async (a: Agent) => {
    if (!confirm(`Remove ${a.name}? Their jobs stay, but become unassigned.`)) return;
    try {
      await removeAgent({ data: { id: a.id } });
      flash("Removed.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove them.");
    }
  };

  if (error && !data) return <ErrorNote>{error}</ErrorNote>;
  if (!data) return <Spinner label="Loading team…" />;

  const active = data.agents.filter((a) => a.active);

  return (
    <>
      <PageHeader
        title="Agents"
        subtitle="The people doing the work. Assign a job to someone from the Appointments page, then see what each person has done here."
        actions={
          <Button
            variant="primary"
            onClick={() => {
              setDraft(blank(data.agents.length));
              setIsNew(true);
            }}
          >
            <Plus className="h-3.5 w-3.5" /> Add team member
          </Button>
        }
      />

      <AnimatePresence>{ok && <SuccessNote>{ok}</SuccessNote>}</AnimatePresence>
      {error && (
        <div className="mb-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile index={0} label="Team" value={active.length} hint={`${data.agents.length - active.length} inactive`} icon={Users} accent />
        <StatTile index={1} label="Unassigned jobs" value={data.unassigned} hint="no one allocated yet" icon={CalendarClock} />
        <StatTile
          index={2}
          label="Hours worked"
          value={`${data.agents.reduce((s, a) => s + a.hours, 0)}h`}
          hint="completed jobs only"
          icon={Clock}
        />
        <StatTile
          index={3}
          label="Est. pay owed"
          value={money(data.agents.reduce((s, a) => s + a.estimatedPay, 0))}
          hint="from pay settings — an estimate"
          icon={Wallet}
        />
      </div>

      {data.agents.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            icon={Users}
            title="No team members yet"
            body="Even solo, adding yourself lets you track hours worked and revenue per person. Add someone else when you take on help."
            action={
              <Button
                variant="primary"
                onClick={() => {
                  setDraft(blank(0));
                  setIsNew(true);
                }}
              >
                <Plus className="h-3.5 w-3.5" /> Add team member
              </Button>
            }
          />
        </div>
      ) : (
        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <AnimatePresence initial={false}>
            {data.agents.map((a, i) => (
              <motion.div
                key={a.id}
                layout
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0, transition: { delay: Math.min(i * 0.05, 0.3) } }}
                exit={{ opacity: 0, scale: 0.98 }}
                className={`liquid-glass group relative rounded-2xl p-5 ${a.active ? "" : "opacity-55"}`}
              >
                <div className="flex items-start gap-3">
                  <AgentFace agent={a} />
                  <button
                    type="button"
                    onClick={() => {
                      setDraft(a);
                      setIsNew(false);
                    }}
                    className="min-w-0 flex-1 text-left"
                  >
                    <p className="truncate text-[14px] font-bold text-foreground">{a.name}</p>
                    <p className="truncate text-[11.5px] text-muted-foreground">
                      {a.title || "Detailer"}
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => del(a)}
                    aria-label={`Remove ${a.name}`}
                    className="rounded-md p-1.5 text-muted-foreground opacity-0 transition hover:bg-destructive/15 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>

                {(a.email || a.phone) && (
                  <div className="mt-3 space-y-1">
                    {a.email && (
                      <p className="flex items-center gap-1.5 truncate text-[11.5px] text-muted-foreground">
                        <Mail className="h-3 w-3 shrink-0" />
                        {a.email}
                      </p>
                    )}
                    {a.phone && (
                      <p className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                        <Phone className="h-3 w-3 shrink-0" />
                        {a.phone}
                      </p>
                    )}
                  </div>
                )}

                <div className="mt-4 grid grid-cols-3 gap-2 border-t border-[var(--line-2)] pt-4">
                  <Cell label="Done" value={String(a.jobsCompleted)} />
                  <Cell label="Upcoming" value={String(a.upcoming)} />
                  <Cell label="Revenue" value={money(a.revenue)} />
                </div>

                {a.payType !== "none" && (
                  <p className="mt-3 rounded-lg bg-[var(--fill-2)] px-2.5 py-2 text-[11.5px] text-muted-foreground">
                    {a.payType === "hourly"
                      ? `${money(a.payRate)}/hr · ${a.hours}h`
                      : `${a.payRate}% commission`}
                    <span className="tnum ml-1.5 font-semibold text-foreground">
                      ≈ {money(a.estimatedPay)}
                    </span>
                  </p>
                )}

                {a.linkedAccount && (
                  <p className="mt-2 flex items-center gap-1.5 text-[11px] text-primary">
                    <BadgeCheck className="h-3 w-3" /> Signs in as {a.linkedAccount}
                  </p>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      <GlassCard index={4} className="mt-5 flex flex-wrap items-center justify-between gap-4 p-5">
        <div>
          <p className="text-[13.5px] font-semibold text-foreground">Logins are separate</p>
          <p className="mt-0.5 max-w-xl text-[12px] text-muted-foreground">
            A team member here is a person you schedule work for. Giving them access to this admin
            is a different thing — create the account under Settings, then link it above.
          </p>
        </div>
        <Link to="/admin/settings">
          <Button>
            <UserPlus className="h-3.5 w-3.5" /> Manage accounts
          </Button>
        </Link>
      </GlassCard>

      <EditorModal
        open={!!draft}
        onClose={() => setDraft(null)}
        title={isNew ? "Add team member" : `Edit ${draft?.name}`}
        footer={
          <>
            <Button onClick={() => setDraft(null)}>Cancel</Button>
            <Button variant="primary" loading={saving} onClick={save}>
              Save
            </Button>
          </>
        }
      >
        {draft && (
          <>
            {!isNew && (
              <div className="rounded-lg border border-[var(--line-2)] bg-[var(--fill-1)] px-3.5 py-3">
                <AvatarPicker
                  kind="agent"
                  id={draft.id}
                  name={draft.name}
                  photoId={draft.avatarPhotoId}
                  color={draft.color}
                  onChange={load}
                />
              </div>
            )}
            <FieldRow>
              <Field label="Name">
                <input
                  className={inputCls}
                  value={draft.name}
                  maxLength={80}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </Field>
              <Field label="Job title" hint="Optional">
                <input
                  className={inputCls}
                  value={draft.title}
                  maxLength={60}
                  placeholder="Lead detailer"
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                />
              </Field>
            </FieldRow>

            <FieldRow>
              <Field label="Email" hint="Optional">
                <input
                  type="email"
                  className={inputCls}
                  value={draft.email}
                  maxLength={160}
                  onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                />
              </Field>
              <Field label="Phone" hint="Optional">
                <input
                  className={inputCls}
                  value={draft.phone}
                  maxLength={40}
                  onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
                />
              </Field>
            </FieldRow>

            <FieldRow>
              <Field label="Paid by">
                <select
                  className={inputCls}
                  value={draft.payType}
                  onChange={(e) => setDraft({ ...draft, payType: e.target.value as Agent["payType"] })}
                >
                  <option value="none">Not tracked</option>
                  <option value="hourly">Hourly rate</option>
                  <option value="commission">Commission on jobs</option>
                </select>
              </Field>
              {draft.payType !== "none" && (
                <Field
                  label={draft.payType === "hourly" ? "Rate per hour" : "Commission %"}
                  hint={draft.payType === "commission" ? "Percent of the job total" : undefined}
                >
                  <input
                    type="number"
                    min={0}
                    max={draft.payType === "commission" ? 100 : undefined}
                    step="0.01"
                    className={inputCls}
                    value={draft.payRate}
                    onChange={(e) => setDraft({ ...draft, payRate: Number(e.target.value) })}
                  />
                </Field>
              )}
            </FieldRow>

            <Field label="Colour" hint="Used to tell people apart on the schedule">
              <div className="flex flex-wrap gap-2">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={`Colour ${c}`}
                    onClick={() => setDraft({ ...draft, color: c })}
                    className={`h-8 w-8 rounded-full transition ${
                      draft.color === c ? "ring-2 ring-white/70 ring-offset-2 ring-offset-[var(--card)]" : ""
                    }`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </Field>

            {data.accounts.length > 0 && (
              <Field label="Linked login" hint="Optional — connects this person to an admin account">
                <select
                  className={inputCls}
                  value={draft.userId ?? ""}
                  onChange={(e) => setDraft({ ...draft, userId: e.target.value || undefined })}
                >
                  <option value="">No account</option>
                  {data.accounts.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} ({u.email})
                    </option>
                  ))}
                </select>
              </Field>
            )}

            <Field label="Notes" hint="Optional">
              <textarea
                className={`${inputCls} min-h-[70px] resize-y`}
                value={draft.notes ?? ""}
                maxLength={1000}
                onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              />
            </Field>

            <div className="flex items-center justify-between rounded-lg border border-[var(--line-2)] bg-[var(--fill-1)] px-3.5 py-3">
              <span className="text-[12.5px] text-foreground">
                Currently working
                <span className="block text-[11px] text-muted-foreground">
                  Inactive people keep their history but can't be assigned new jobs.
                </span>
              </span>
              <ToggleChip
                on={draft.active}
                labels={["Active", "Inactive"]}
                onChange={(next) => setDraft({ ...draft, active: next })}
              />
            </div>
          </>
        )}
      </EditorModal>
    </>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10.5px] uppercase tracking-[0.1em] text-muted-foreground">{label}</p>
      <p className="tnum mt-0.5 text-[15px] font-bold text-foreground">{value}</p>
    </div>
  );
}

/**
 * Roster avatar: their photo when they have one, initials on their colour
 * when they don't. Fetched per agent rather than bundled into the list
 * response so the page isn't carrying base64 for people you never look at.
 */
function AgentFace({ agent }: { agent: Agent }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!agent.avatarPhotoId) {
      setUrl(null);
      return;
    }
    getAvatars({ data: { photoIds: [agent.avatarPhotoId] } })
      .then((r) => !cancelled && setUrl(r.avatars[agent.avatarPhotoId!] ?? null))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [agent.avatarPhotoId]);

  if (url) {
    return (
      <img
        src={url}
        alt=""
        className="h-11 w-11 shrink-0 rounded-full object-cover ring-1 ring-inset ring-[var(--line-2)]"
      />
    );
  }
  return (
    <span
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[13px] font-bold text-black/80"
      style={{ backgroundColor: agent.color }}
    >
      {agent.name
        .split(" ")
        .slice(0, 2)
        .map((w) => w[0])
        .join("")
        .toUpperCase() || "?"}
    </span>
  );
}
