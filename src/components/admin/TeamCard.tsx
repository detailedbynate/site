import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { KeyRound, Plus, Trash2, UserPlus, Users, X } from "lucide-react";

import {
  addUser,
  getMe,
  listTeam,
  removeUser,
  resetUserPassword,
  setUserRole,
} from "@/lib/api/auth.functions";
import {
  Avatar,
  Button,
  ErrorNote,
  Field,
  GlassCard,
  SuccessNote,
  inputCls,
} from "./ui";

type Member = Awaited<ReturnType<typeof listTeam>>["users"][number];

/**
 * Team management. Owner-only — staff get a clear explanation instead of a
 * broken panel, since listTeam() throws FORBIDDEN for them.
 */
export function TeamCard() {
  const [users, setUsers] = useState<Member[] | null>(null);
  const [meId, setMeId] = useState<string | null>(null);
  const [allowed, setAllowed] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [resetting, setResetting] = useState<Member | null>(null);
  const [busy, setBusy] = useState(false);

  const [draft, setDraft] = useState({
    name: "",
    email: "",
    password: "",
    role: "staff" as "owner" | "staff",
  });
  const [newPassword, setNewPassword] = useState("");

  const load = async () => {
    try {
      const [team, me] = await Promise.all([listTeam(), getMe()]);
      setUsers(team.users);
      setMeId(me.user?.id ?? null);
      setAllowed(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg.includes("FORBIDDEN")) setAllowed(false);
      else setError(msg || "Couldn't load the team.");
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const flash = (m: string) => {
    setOk(m);
    setTimeout(() => setOk(null), 3500);
  };

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      await addUser({
        data: {
          name: draft.name.trim(),
          email: draft.email.trim(),
          password: draft.password,
          role: draft.role,
        },
      });
      setAdding(false);
      setDraft({ name: "", email: "", password: "", role: "staff" });
      flash("Account created. Send them the password to sign in with.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create that account.");
    } finally {
      setBusy(false);
    }
  };

  const changeRole = async (m: Member, role: "owner" | "staff") => {
    setError(null);
    try {
      await setUserRole({ data: { userId: m.id, role } });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't change that role.");
    }
  };

  const remove = async (m: Member) => {
    if (!confirm(`Remove ${m.name}? They'll be signed out immediately.`)) return;
    setError(null);
    try {
      await removeUser({ data: { userId: m.id } });
      flash(`${m.name} removed.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't remove them.");
    }
  };

  const doReset = async () => {
    if (!resetting) return;
    setBusy(true);
    setError(null);
    try {
      await resetUserPassword({ data: { userId: resetting.id, newPassword } });
      setResetting(null);
      setNewPassword("");
      flash("Password reset. They've been signed out of all devices.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't reset it.");
    } finally {
      setBusy(false);
    }
  };

  if (!allowed) {
    return (
      <GlassCard index={4} className="p-6">
        <div className="flex items-center gap-2.5">
          <Users className="h-4 w-4 text-primary" />
          <p className="text-[15px] font-semibold tracking-tight text-foreground">Team</p>
        </div>
        <p className="mt-2 text-[13px] text-muted-foreground">
          Only owners can manage accounts. Ask an owner if you need access.
        </p>
      </GlassCard>
    );
  }

  return (
    <GlassCard index={4} className="p-6 lg:col-span-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <Users className="h-4 w-4 text-primary" />
            <p className="text-[15px] font-semibold tracking-tight text-foreground">Team</p>
          </div>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            Owners can manage everything. Staff can run the shop but can't add or remove
            accounts, delete records, or change the catalog permanently.
          </p>
        </div>
        <Button variant="primary" onClick={() => setAdding(true)}>
          <UserPlus className="h-3.5 w-3.5" /> Add admin
        </Button>
      </div>

      <AnimatePresence>
        {error && (
          <div className="mt-4">
            <ErrorNote>{error}</ErrorNote>
          </div>
        )}
        {ok && (
          <div className="mt-4">
            <SuccessNote>{ok}</SuccessNote>
          </div>
        )}
      </AnimatePresence>

      <div className="mt-5 space-y-2">
        {users?.map((m, i) => (
          <motion.div
            key={m.id}
            layout
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0, transition: { delay: i * 0.04 } }}
            className="flex flex-wrap items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3"
          >
            <Avatar name={m.name} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13.5px] font-semibold text-foreground">
                {m.name}
                {m.id === meId && (
                  <span className="ml-2 rounded bg-white/[0.08] px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                    you
                  </span>
                )}
              </p>
              <p className="truncate text-[12px] text-muted-foreground">
                {m.email}
                {m.lastLoginAt && ` · last in ${new Date(m.lastLoginAt).toLocaleDateString()}`}
              </p>
            </div>

            <select
              value={m.role}
              onChange={(e) => changeRole(m, e.target.value as "owner" | "staff")}
              className="rounded-lg border border-white/[0.09] bg-white/[0.03] px-2.5 py-1.5 text-[12px] font-semibold capitalize text-foreground outline-none focus:border-primary/60"
            >
              <option value="owner">Owner</option>
              <option value="staff">Staff</option>
            </select>

            <Button size="sm" variant="ghost" onClick={() => setResetting(m)} title="Reset password">
              <KeyRound className="h-3.5 w-3.5" />
            </Button>
            {m.id !== meId && (
              <Button size="sm" variant="ghost" onClick={() => remove(m)} title="Remove">
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </motion.div>
        ))}
      </div>

      {/* Add admin */}
      <AnimatePresence>
        {adding && (
          <Modal onClose={() => setAdding(false)} title="Add an admin">
            <div className="space-y-4">
              <Field label="Name">
                <input
                  className={inputCls}
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </Field>
              <Field label="Email" hint="They'll sign in with this.">
                <input
                  className={inputCls}
                  type="email"
                  value={draft.email}
                  onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                />
              </Field>
              <Field
                label="Temporary password"
                hint="At least 10 characters with a number. Share it with them, then they can change it in Settings."
              >
                <input
                  className={inputCls}
                  type="text"
                  value={draft.password}
                  onChange={(e) => setDraft({ ...draft, password: e.target.value })}
                />
              </Field>
              <Field label="Role">
                <select
                  className={inputCls}
                  value={draft.role}
                  onChange={(e) =>
                    setDraft({ ...draft, role: e.target.value as "owner" | "staff" })
                  }
                >
                  <option value="staff">Staff</option>
                  <option value="owner">Owner</option>
                </select>
              </Field>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <Button onClick={() => setAdding(false)}>Cancel</Button>
              <Button
                variant="primary"
                loading={busy}
                disabled={!draft.name || !draft.email || !draft.password}
                onClick={create}
              >
                <Plus className="h-3.5 w-3.5" /> Create account
              </Button>
            </div>
          </Modal>
        )}

        {resetting && (
          <Modal onClose={() => setResetting(null)} title={`Reset ${resetting.name}'s password`}>
            <Field label="New password" hint="They'll be signed out of every device.">
              <input
                className={inputCls}
                type="text"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </Field>
            <div className="mt-6 flex justify-end gap-2">
              <Button onClick={() => setResetting(null)}>Cancel</Button>
              <Button variant="primary" loading={busy} disabled={!newPassword} onClick={doReset}>
                Reset password
              </Button>
            </div>
          </Modal>
        )}
      </AnimatePresence>
    </GlassCard>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
      className="admin-theme fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-[3px]"
    >
      <motion.div
        initial={{ scale: 0.96, y: 16 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.98, y: 8 }}
        transition={{ type: "spring", stiffness: 280, damping: 28 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl border border-white/[0.08] bg-[var(--card)] p-6"
      >
        <div className="mb-5 flex items-start justify-between">
          <h2 className="text-lg font-bold tracking-tight text-foreground">{title}</h2>
          <Button size="sm" variant="ghost" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        {children}
      </motion.div>
    </motion.div>
  );
}
