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
  LayoutDashboard,
  LogOut,
  MapPin,
  Menu,
  Package,
  Plug,
  Receipt,
  Settings,
  Sparkles,
  Tag,
  TrendingUp,
  Users,
  Wrench,
  Workflow,
} from "lucide-react";

import { getMe, logout } from "@/lib/api/auth.functions";
import type { PublicUser } from "@/lib/auth.server";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Admin — Detailed by Nate" },
      { name: "robots", content: "noindex, nofollow" },
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

// Mirrors the reference layout the owner asked for. Items marked `soon`
// render a "planned" page rather than fake UI that pretends to work.
const NAV: { heading?: string; items: NavItem[] }[] = [
  {
    items: [
      { to: "/admin", label: "Dashboard", icon: LayoutDashboard },
      { to: "/admin/calendar", label: "Calendar", icon: CalendarRange },
      { to: "/admin/appointments", label: "Appointments", icon: CalendarDays },
      { to: "/admin/sales", label: "Sales", icon: TrendingUp },
      { to: "/admin/orders", label: "Orders", icon: Receipt },
      { to: "/admin/payments", label: "Payments", icon: CreditCard, soon: true },
      { to: "/admin/customers", label: "Customers", icon: Users },
    ],
  },
  {
    heading: "Resources",
    items: [
      { to: "/admin/services", label: "Services", icon: Package },
      { to: "/admin/addons", label: "Add-ons", icon: Sparkles },
      { to: "/admin/coupons", label: "Coupons", icon: Tag },
      { to: "/admin/agents", label: "Agents", icon: Wrench, soon: true },
      { to: "/admin/locations", label: "Locations", icon: MapPin, soon: true },
      { to: "/admin/assets", label: "Assets", icon: Blocks, soon: true },
    ],
  },
  {
    heading: "Settings",
    items: [
      { to: "/admin/settings", label: "Settings", icon: Settings },
      { to: "/admin/automation", label: "Automation", icon: Workflow, soon: true },
      { to: "/admin/integrations", label: "Integrations", icon: Plug, soon: true },
      { to: "/admin/form-fields", label: "Form Fields", icon: FileInput, soon: true },
    ],
  },
];

function AdminLayout() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [user, setUser] = useState<PublicUser | null>(null);
  const [checked, setChecked] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

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

  // Close the mobile drawer whenever the route changes.
  useEffect(() => setMobileOpen(false), [pathname]);

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
                      : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground"
                  } ${collapsed ? "justify-center" : ""}`}
                >
                  {/* A tinted panel plus a left rail reads as selected without
                      shouting like a full gradient pill on every item. */}
                  {active && (
                    <motion.span
                      layoutId="admin-nav-active"
                      transition={{ type: "spring", stiffness: 420, damping: 36 }}
                      className="absolute inset-0 -z-10 rounded-xl bg-white/[0.07] ring-1 ring-inset ring-white/[0.09]"
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
                      className="ml-auto shrink-0 rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/80"
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
        <div className={`rounded-xl bg-white/[0.04] p-3 ring-1 ring-inset ring-white/[0.06] ${collapsed ? "px-2" : ""}`}>
          {!collapsed && (
            <div className="flex items-center gap-2.5">
              <span
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[12px] font-bold text-primary-foreground"
                style={{ backgroundImage: "var(--gradient-brand)" }}
              >
                {user?.name?.slice(0, 1).toUpperCase()}
              </span>
              <div className="min-w-0">
                <p className="truncate text-[13px] font-semibold text-foreground">{user?.name}</p>
                <p className="truncate text-[11px] capitalize text-muted-foreground">{user?.role}</p>
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={signOut}
            className={`mt-2 flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-xs font-semibold text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive ${
              collapsed ? "justify-center" : ""
            }`}
          >
            <LogOut className="h-3.5 w-3.5" />
            {!collapsed && "Sign out"}
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="admin-theme relative flex min-h-screen">
      {/* One faint accent wash, top-left only - enough to feel lit, quiet
          enough to read a dense table over. */}
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute -left-40 -top-64 h-[560px] w-[560px] rounded-full bg-primary/[0.07] blur-[150px]" />
      </div>

      {/* Desktop sidebar */}
      <motion.aside
        animate={{ width: collapsed ? 84 : 260 }}
        transition={{ type: "spring", stiffness: 260, damping: 30 }}
        className="sticky top-0 z-30 hidden h-screen shrink-0 border-r border-white/[0.06] bg-white/[0.02] backdrop-blur-2xl lg:block"
      >
        {sidebar}
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="absolute right-2 top-4 hidden h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition hover:bg-white/[0.08] hover:text-foreground lg:flex"
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
              className="admin-theme fixed inset-y-0 left-0 z-50 w-[260px] border-r border-white/[0.06] bg-[var(--background)] lg:hidden"
            >
              {sidebar}
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-white/[0.06] bg-[var(--background)]/85 px-4 py-3 backdrop-blur-xl lg:hidden">
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

        <main className="px-4 py-8 sm:px-8 lg:px-10">
          <AnimatePresence mode="wait">
            <motion.div
              key={pathname}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}
