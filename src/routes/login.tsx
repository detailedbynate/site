import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ArrowLeft, Lock, Mail, ShieldCheck, Sparkles, User } from "lucide-react";

import { getAuthStatus, login, setupOwner } from "@/lib/api/auth.functions";
import { Button, ErrorNote, Field, inputCls } from "@/components/admin/ui";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Sign in — Detailed by Nate" },
      // Keep the admin out of search results.
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"loading" | "login" | "setup">("loading");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Decide between "sign in" and "create the first account" — and bounce
  // straight through if there's already a valid session cookie.
  useEffect(() => {
    let cancelled = false;
    getAuthStatus()
      .then((res) => {
        if (cancelled) return;
        if (res.user) {
          void navigate({ to: "/admin" });
          return;
        }
        setMode(res.needsSetup ? "setup" : "login");
      })
      .catch(() => {
        if (!cancelled) setMode("login");
      });
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (mode === "setup" && password !== confirm) {
      setError("Those passwords don't match.");
      return;
    }

    setBusy(true);
    try {
      if (mode === "setup") {
        await setupOwner({ data: { name: name.trim(), email: email.trim(), password } });
      } else {
        await login({ data: { email: email.trim(), password } });
      }
      await navigate({ to: "/admin" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
      setBusy(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-16">
      {/* ambient glow */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="animate-aurora absolute -top-40 left-1/2 h-[700px] w-[700px] -translate-x-1/2 rounded-full bg-primary/10 blur-[130px]" />
        <div className="animate-float absolute bottom-0 right-10 h-[420px] w-[420px] rounded-full bg-primary-glow/10 blur-[110px]" />
      </div>

      <Link
        to="/"
        className="absolute left-6 top-6 inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground transition hover:text-primary"
      >
        <ArrowLeft className="h-4 w-4" /> Back to site
      </Link>

      <motion.div
        initial={{ opacity: 0, y: 28, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 180, damping: 22 }}
        className="glass-strong sheen w-full max-w-md rounded-4xl p-8"
      >
        <motion.span
          initial={{ scale: 0, rotate: -90 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ delay: 0.12, type: "spring", stiffness: 240, damping: 15 }}
          className="flex h-14 w-14 items-center justify-center rounded-2xl"
          style={{ backgroundImage: "var(--gradient-brand)", boxShadow: "var(--shadow-glow)" }}
        >
          {mode === "setup" ? (
            <Sparkles className="h-6 w-6 text-primary-foreground" />
          ) : (
            <ShieldCheck className="h-6 w-6 text-primary-foreground" />
          )}
        </motion.span>

        <h1 className="mt-5 font-display text-2xl font-bold tracking-tight text-foreground">
          {mode === "setup" ? "Create your account" : "Shop admin"}
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {mode === "setup"
            ? "No account exists yet. This first one becomes the owner."
            : "Sign in to manage bookings, customers and settings."}
        </p>

        {mode === "loading" ? (
          <div className="mt-8 space-y-3">
            <div className="h-11 animate-pulse rounded-2xl bg-secondary/60" />
            <div className="h-11 animate-pulse rounded-2xl bg-secondary/60" />
          </div>
        ) : (
          <form onSubmit={submit} className="mt-7 space-y-4">
            <AnimatePresence>
              {mode === "setup" && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <Field label="Your name">
                    <div className="relative">
                      <User className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <input
                        className={`${inputCls} pl-10`}
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Nate"
                        autoComplete="name"
                        required
                        maxLength={80}
                      />
                    </div>
                  </Field>
                </motion.div>
              )}
            </AnimatePresence>

            <Field label="Email">
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  className={`${inputCls} pl-10`}
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@detailedbynate.com"
                  autoComplete="email"
                  required
                  maxLength={255}
                />
              </div>
            </Field>

            <Field
              label="Password"
              hint={mode === "setup" ? "At least 10 characters, with a number." : undefined}
            >
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  className={`${inputCls} pl-10`}
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••"
                  autoComplete={mode === "setup" ? "new-password" : "current-password"}
                  required
                  maxLength={200}
                />
              </div>
            </Field>

            <AnimatePresence>
              {mode === "setup" && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <Field label="Confirm password">
                    <div className="relative">
                      <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <input
                        className={`${inputCls} pl-10`}
                        type="password"
                        value={confirm}
                        onChange={(e) => setConfirm(e.target.value)}
                        placeholder="••••••••••"
                        autoComplete="new-password"
                        required
                        maxLength={200}
                      />
                    </div>
                  </Field>
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence>{error && <ErrorNote>{error}</ErrorNote>}</AnimatePresence>

            <Button type="submit" variant="primary" loading={busy} className="w-full">
              {mode === "setup" ? "Create account" : "Sign in"}
            </Button>
          </form>
        )}
      </motion.div>
    </div>
  );
}
