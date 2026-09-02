import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Blocks,
  CalendarDays,
  CalendarRange,
  ChevronsLeft,
  CreditCard,
  FileInput,
  ExternalLink,
  LayoutDashboard,
  LogOut,
  MapPin,
  Menu,
  MessageSquareQuote,
  Moon,
  Sun,
  Package,
  PiggyBank,
  Plug,
  Receipt,
  Scale,
  Search,
  Settings,
  Sparkles,
  Tag,
  TrendingUp,
  Users,
  Wrench,
  Workflow,
} from "lucide-react";

import { getMe, logout } from "@/lib/api/auth.functions";
import { useAdminTheme } from "@/components/admin/theme";
import { BottomNav } from "@/components/admin/BottomNav";
import { getAvatars } from "@/lib/api/content.functions";
import type { PublicUser } from "@/lib/auth.server";

export const Route = createFileRoute("/admin")({
  /*
    PWA tags live on the ADMIN route, not the root.

    That is what keeps the customer-facing site an ordinary web page: no
    manifest is advertised there, so no browser offers to install it, and
    nothing about how it looks or behaves changes. These tags only exist on
    /admin and below.
  */
  head: () => ({
    meta: [
      { title: "Admin — Detailed by Nate" },
      { name: "robots", content: "noindex, nofollow" },
      // Matches --background on the admin surfaces, so the phone's status
      // bar blends into the app instead of banding against it.
      { name: "theme-color", content: "#101318" },
      // iOS ignores the manifest's display mode; these are its equivalents.
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { name: "apple-mobile-web-app-title", content: "Admin" },
    ],
    links: [
      { rel: "manifest", href: "/admin/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/admin/icon" },
    ],
  }),
  component: AdminLayout,
});

type NavItem = {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Sections without a real backing feature yet — shown, but honest. */
  soon?: boolean;
};

// Mirrors the reference layout the owner asked for. `soon` renders a
// "planned" page rather than fake UI that pretends to work — every section
// below is now backed by real data, so nothing carries the flag today.
const NAV: { heading?: string; items: NavItem[] }[] = [
  {
    items: [
      { to: "/admin", label: "Dashboard", icon: LayoutDashboard },
      { to: "/admin/calendar", label: "Calendar", icon: CalendarRange },
      { to: "/admin/appointments", label: "Appointments", icon: CalendarDays },
      { to: "/admin/customers", label: "Customers", icon: Users },
    ],
  },
  {
    heading: "Money",
    items: [
      { to: "/admin/finance", label: "Finance", icon: PiggyBank },
      { to: "/admin/sales", label: "Sales", icon: TrendingUp },
      { to: "/admin/orders", label: "Orders", icon: Receipt },
      { to: "/admin/payments", label: "Payments", icon: CreditCard },
    ],
  },
  {
    heading: "Resources",
    items: [
      { to: "/admin/services", label: "Services", icon: Package },
      { to: "/admin/addons", label: "Add-ons", icon: Sparkles },
      { to: "/admin/coupons", label: "Coupons", icon: Tag },
      { to: "/admin/agents", label: "Agents", icon: Wrench },
      { to: "/admin/locations", label: "Locations", icon: MapPin },
      { to: "/admin/assets", label: "Assets", icon: Blocks },
    ],
  },
  {
    heading: "Settings",
    items: [
      { to: "/admin/settings", label: "Settings", icon: Settings },
      { to: "/admin/automation", label: "Automation", icon: Workflow },
      { to: "/admin/integrations", label: "Integrations", icon: Plug },
      { to: "/admin/seo", label: "SEO & branding", icon: Search },
      { to: "/admin/testimonials", label: "Reviews & FAQ", icon: MessageSquareQuote },
      { to: "/admin/pages", label: "Pages & analytics", icon: Scale },
      { to: "/admin/form-fields", label: "Form Fields", icon: FileInput },
    ],
  },
];

/** "MONDAY, MARCH 24" — the reference layout's date strip. */
function todayLabel(): string {
  return new Date()
    .toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })
    .toUpperCase();
}

function AdminLayout() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [user, setUser] = useState<PublicUser | null>(null);
  const [checked, setChecked] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const { theme, toggle, themeRef } = useAdminTheme();
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  /*
    Register the admin service worker.

    Done here rather than in the root so it can only ever happen on /admin —
    a customer never registers a worker, and the public site is never under
    one. The scope comes from the script's own path (/admin/), so even if it
    somehow ran elsewhere it could not intercept a customer page.

    Failure is ignored on purpose: no worker means no install prompt, which
    is a missing convenience, not a broken admin.
  */
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/admin/sw.js", { scope: "/admin/" }).catch(() => undefined);
  }, []);

  // Client-side guard. The real enforcement is server-side — every admin
  // server function calls requireUser() — so this is purely so an
  // unauthenticated visitor gets redirected instead of seeing empty shells.
  useEffect(() => {
    let cancelled = false;
    getMe()
      .then((res) => {
        if (cancelled) return;
        if (!res.user) {
          void navigate({ to: "/login" });
          return;
        }
        setUser(res.user);
        setChecked(true);
      })
      .catch(() => {
        if (!cancelled) void navigate({ to: "/login" });
      });
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  // Their profile picture, if they have set one. Fetched separately so the
  // session check stays a small response.
  useEffect(() => {
    const id = user?.avatarPhotoId;
    if (!id) {
      setAvatarUrl(null);
      return;
    }
    let cancelled = false;
    getAvatars({ data: { photoIds: [id] } })
      .then((r) => !cancelled && setAvatarUrl(r.avatars[id] ?? null))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [user?.avatarPhotoId]);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => setMobileOpen(false), [pathname]);

  /**
   * Select a number field's contents when it gains focus.
   *
   * Every numeric input is controlled and shows "0" when empty. Clicking to
   * the LEFT of that zero and typing 5 produced "50", not 5 — so you had to
   * clear it by hand or nudge with the arrow keys. Selecting on focus makes
   * the first keystroke replace the value, which is what everyone expects.
   *
   * Done once here by delegation rather than on ~30 individual inputs, so it
   * also covers any number field added later. `focusin` because `focus`
   * doesn't bubble. select() only changes the selection, never the value, so
   * React's controlled state stays in sync.
   */
  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => {
      const el = e.target as HTMLElement | null;
      if (el instanceof HTMLInputElement && el.type === "number" && !el.readOnly) {
        el.select();
      }
    };
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, []);

  const signOut = async () => {
    await logout().catch(() => undefined);
    await navigate({ to: "/login" });
  };

  if (!checked) {
    return (
      <div className="admin-theme flex min-h-screen items-center justify-center">
        <motion.div
          animate={{ opacity: [0.4, 1, 0.4] }}
          transition={{ duration: 1.4, repeat: Infinity }}
          className="font-display text-sm tracking-widest text-muted-foreground"
        >
          CHECKING SESSION…
        </motion.div>
      </div>
    );
  }

  const sidebar = (
    <div className="flex h-full flex-col p-3">
      <div className={`mb-4 flex items-center gap-2.5 px-1.5 pr-8 pt-1 ${collapsed ? "justify-center pr-1.5" : ""}`}>
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
          style={{ backgroundImage: "var(--gradient-brand)" }}
        >
          <Sparkles className="h-[17px] w-[17px] text-primary-foreground" />
        </span>
        {!collapsed && (
          <div className="min-w-0">
            <p className="truncate text-[13px] font-bold tracking-tight text-foreground">
              Detailed by Nate
            </p>
            <p className="truncate text-[11px] text-muted-foreground">Shop admin</p>
          </div>
        )}
      </div>

      {/* Greeting card. Gives the sidebar a human anchor and is the natural
          home for the theme switch, the way the reference layout does it. */}
      {!collapsed && (
        <div className="mb-4 rounded-2xl bg-[var(--fill-2)] p-3.5 ring-1 ring-inset ring-[var(--line-1)]">
          <div className="flex items-start justify-between gap-2">
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt=""
                className="h-10 w-10 shrink-0 rounded-xl object-cover ring-1 ring-inset ring-[var(--line-2)]"
              />
            ) : (
              <span
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[14px] font-bold text-primary-foreground"
                style={{ backgroundImage: "var(--gradient-brand)" }}
              >
                {user?.name?.slice(0, 1).toUpperCase()}
              </span>
            )}
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={toggle}
                aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
                title={theme === "dark" ? "Light mode" : "Dark mode"}
                className="relative flex h-7 w-7 items-center justify-center overflow-hidden rounded-lg text-muted-foreground transition hover:bg-[var(--fill-3)] hover:text-foreground"
              >
                <AnimatePresence mode="wait" initial={false}>
                  <motion.span
                    key={theme}
                    initial={{ y: 12, opacity: 0, rotate: -35 }}
                    animate={{ y: 0, opacity: 1, rotate: 0 }}
                    exit={{ y: -12, opacity: 0, rotate: 35 }}
                    transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                    className="absolute"
                  >
                    {theme === "dark" ? (
                      <Moon className="h-[15px] w-[15px]" />
                    ) : (
                      <Sun className="h-[15px] w-[15px]" />
                    )}
                  </motion.span>
                </AnimatePresence>
              </button>
              <button
                type="button"
                onClick={signOut}
                aria-label="Sign out"
                title="Sign out"
                className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
              >
                <LogOut className="h-[15px] w-[15px]" />
              </button>
            </div>
          </div>
          <p className="mt-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {todayLabel()}
          </p>
          <p className="mt-0.5 text-[17px] font-bold leading-tight tracking-tight text-foreground">
            Welcome back,
            <br />
            {(user?.name ?? "").split(" ")[0]}!
          </p>
        </div>
      )}

      <nav className="-mr-1 min-h-0 flex-1 space-y-0.5 overflow-y-auto pr-1">
      {NAV.map((group, gi) => (
        <div key={gi} className="mb-1">
          {group.heading && !collapsed && (
            <p className="mb-1 mt-4 px-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/60">
              {group.heading}
            </p>
          )}
          {group.heading && collapsed && <div className="my-3 border-t border-border/60" />}

          {group.items.map((item) => {
            // "/admin" must match exactly, or it would light up on every child.
            const active = item.to === "/admin" ? pathname === "/admin" : pathname.startsWith(item.to);
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                title={collapsed ? item.label : undefined}
                className="group relative block"
              >
                <motion.div
                  whileTap={{ scale: 0.985 }}
                  className={`relative flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[13px] font-medium transition-colors ${
                    active
                      ? "text-foreground"
                      : "text-muted-foreground hover:bg-[var(--fill-2)] hover:text-foreground"
                  } ${collapsed ? "justify-center" : ""}`}
                >
                  {/* A tinted panel plus a left rail reads as selected without
                      shouting like a full gradient pill on every item. */}
                  {active && (
                    <motion.span
                      layoutId="admin-nav-active"
                      transition={{ type: "spring", stiffness: 420, damping: 36 }}
                      className="absolute inset-0 -z-10 rounded-xl bg-[var(--fill-3)] ring-1 ring-inset ring-[var(--line-2)]"
                    />
                  )}
                  {active && !collapsed && (
                    <motion.span
                      layoutId="admin-nav-rail"
                      transition={{ type: "spring", stiffness: 420, damping: 36 }}
                      className="absolute -left-1 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full"
                      style={{ backgroundImage: "var(--gradient-brand)" }}
                    />
                  )}
                  <Icon
                    className={`h-[17px] w-[17px] shrink-0 transition-colors ${active ? "text-primary" : ""}`}
                  />
                  {!collapsed && <span className="truncate">{item.label}</span>}
                  {!collapsed && item.soon && (
                    <span
                      className="ml-auto shrink-0 rounded-md bg-[var(--fill-2)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/80"
                      title="Planned - not built yet"
                    >
                      Soon
                    </span>
                  )}
                </motion.div>
              </Link>
            );
          })}
        </div>
      ))}

      </nav>

      <div className="shrink-0 pt-3">
        {collapsed ? (
          <div className="space-y-1">
            <button
              type="button"
              onClick={toggle}
              aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              className="flex w-full items-center justify-center rounded-xl px-2.5 py-2 text-muted-foreground transition hover:bg-[var(--fill-3)] hover:text-foreground"
            >
              {theme === "dark" ? <Moon className="h-3.5 w-3.5" /> : <Sun className="h-3.5 w-3.5" />}
            </button>
            <button
              type="button"
              onClick={signOut}
              aria-label="Sign out"
              className="flex w-full items-center justify-center rounded-xl px-2.5 py-2 text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <Link
            to="/"
            className="group relative flex items-center gap-2.5 overflow-hidden rounded-2xl px-3.5 py-3 text-primary-foreground transition-opacity hover:opacity-95"
            style={{ backgroundImage: "var(--gradient-brand)" }}
          >
            <ExternalLink className="h-4 w-4 shrink-0" />
            <span className="min-w-0">
              <span className="block text-[12.5px] font-bold leading-tight">View live site</span>
              <span className="block text-[10.5px] opacity-80">See what customers see</span>
            </span>
          </Link>
        )}
      </div>
    </div>
  );

  return (
    <div ref={themeRef} className="admin-theme relative flex min-h-screen">
      {/*
        Ambient background. Three very low-opacity washes that drift slowly on
        different periods, so the ground is never quite static but never
        distracting either — a dashboard gets read for minutes at a time.

        Kept behind everything and non-interactive. The whole layer is hidden
        from anyone who prefers reduced motion (see `.ambient` in styles.css),
        which leaves the flat background rather than a jittering one.
      */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="admin-ambient-base absolute inset-0" />
        <motion.div
          aria-hidden
          className="ambient absolute -left-48 -top-72 h-[620px] w-[620px] rounded-full blur-[150px]"
          style={{ background: "var(--ambient-1)" }}
          animate={{ x: [0, 60, 0], y: [0, 40, 0], scale: [1, 1.08, 1] }}
          transition={{ duration: 34, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          aria-hidden
          className="ambient absolute -right-56 top-1/4 h-[560px] w-[560px] rounded-full blur-[160px]"
          style={{ background: "var(--ambient-2)" }}
          animate={{ x: [0, -50, 0], y: [0, 60, 0], scale: [1, 1.12, 1] }}
          transition={{ duration: 42, repeat: Infinity, ease: "easeInOut", delay: 3 }}
        />
        <motion.div
          aria-hidden
          className="ambient absolute -bottom-72 left-1/3 h-[600px] w-[600px] rounded-full blur-[170px]"
          style={{ background: "var(--ambient-3)" }}
          animate={{ x: [0, 40, 0], y: [0, -40, 0], scale: [1, 1.06, 1] }}
          transition={{ duration: 50, repeat: Infinity, ease: "easeInOut", delay: 6 }}
        />
      </div>

      {/* Desktop sidebar */}
      <motion.aside
        animate={{ width: collapsed ? 84 : 260 }}
        transition={{ type: "spring", stiffness: 260, damping: 30 }}
        className="admin-panel sticky top-0 z-30 hidden h-screen shrink-0 border-r border-[var(--line-1)] bg-[var(--fill-1)] backdrop-blur-2xl lg:block"
      >
        {sidebar}
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="absolute right-2 top-4 hidden h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition hover:bg-[var(--fill-3)] hover:text-foreground lg:flex"
        >
          <motion.span animate={{ rotate: collapsed ? 180 : 0 }}>
            <ChevronsLeft className="h-3.5 w-3.5" />
          </motion.span>
        </button>
      </motion.aside>

      {/* Mobile drawer */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileOpen(false)}
              className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
            />
            <motion.aside
              initial={{ x: -280 }}
              animate={{ x: 0 }}
              exit={{ x: -280 }}
              transition={{ type: "spring", stiffness: 300, damping: 32 }}
              className="admin-theme fixed inset-y-0 left-0 z-50 w-[260px] border-r border-[var(--line-1)] bg-[var(--background)] lg:hidden"
            >
              {sidebar}
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-[var(--line-1)] bg-[var(--background)]/85 px-4 py-3 backdrop-blur-xl lg:hidden">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
            className="rounded-xl border border-border p-2 text-foreground"
          >
            <Menu className="h-4 w-4" />
          </button>
          <span className="text-[13px] font-bold">Shop admin</span>
          <Link to="/" className="ml-auto text-xs font-semibold text-muted-foreground">
            View site
          </Link>
        </header>

        {/*
          Page transition.

          This used to be `AnimatePresence mode="wait"`, which unmounts the old
          page, waits out its exit, and only then mounts the new one. For that
          whole gap the container is empty, so the page collapses to zero
          height, the scrollbar jumps, and everything snaps back when the new
          page arrives — the "glitch" when moving between sections.

          Instead: no exit animation and no waiting. The new page fades and
          lifts in over a floor of min-height, so the frame never collapses.
          `key` still forces a fresh mount per route, which is what resets
          scroll-independent state.
        */}
        <main className="min-h-[calc(100vh-1px)] px-4 pb-28 pt-8 sm:px-8 lg:px-10 lg:pb-8">
          <motion.div
            key={pathname}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
          >
            <Outlet />
          </motion.div>
        </main>

        {/* Phones only; the sidebar covers this from `lg` up. */}
        <BottomNav />
      </div>
    </div>
  );
}
