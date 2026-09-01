import { useEffect, useRef, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { motion } from "motion/react";
import { CalendarDays, CalendarRange, LayoutDashboard, Users } from "lucide-react";

/**
 * Thumb-reachable navigation, phones only.
 *
 * Hidden from `lg` up, where the sidebar already does this job — the desktop
 * layout is untouched. The top hamburger stays too: this covers the handful
 * of places you need mid-job, the drawer still reaches everything else.
 *
 * It slides away when you scroll down and comes back when you scroll up, so
 * it isn't sitting over content while you're reading a long appointment.
 */

type NavItem = {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** "/admin" would otherwise match every child route. */
  exact?: boolean;
};

const ITEMS: NavItem[] = [
  { to: "/admin", label: "Home", icon: LayoutDashboard, exact: true },
  { to: "/admin/appointments", label: "Jobs", icon: CalendarDays },
  { to: "/admin/calendar", label: "Calendar", icon: CalendarRange },
  { to: "/admin/customers", label: "Customers", icon: Users },
];

export function BottomNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [hidden, setHidden] = useState(false);
  const lastY = useRef(0);

  useEffect(() => {
    lastY.current = window.scrollY;

    const onScroll = () => {
      const y = window.scrollY;
      const delta = y - lastY.current;

      // Ignore tiny movements and rubber-banding at the very top, otherwise
      // the bar flickers as you settle a scroll.
      if (Math.abs(delta) < 8) return;
      if (y < 80) setHidden(false);
      else setHidden(delta > 0);

      lastY.current = y;
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <motion.nav
      aria-label="Quick navigation"
      animate={{ y: hidden ? 96 : 0 }}
      transition={{ type: "spring", stiffness: 380, damping: 34 }}
      className="admin-panel fixed inset-x-0 bottom-0 z-40 border-t border-[var(--line-1)] bg-[var(--background)]/85 backdrop-blur-xl lg:hidden"
      // Keeps the row clear of the iPhone home indicator.
      style={{ paddingBottom: "max(0.4rem, env(safe-area-inset-bottom))" }}
    >
      <div className="flex items-stretch justify-around px-1 pt-1.5">
        {ITEMS.map((item) => {
          const active = item.exact
            ? pathname === item.to
            : pathname === item.to || pathname.startsWith(`${item.to}/`);
          const Icon = item.icon;
          return (
            <Link
              key={item.to}
              to={item.to}
              className="relative flex min-w-0 flex-1 flex-col items-center gap-1 rounded-xl px-1 py-1.5"
            >
              {active && (
                <motion.span
                  layoutId="bottom-nav-active"
                  transition={{ type: "spring", stiffness: 420, damping: 34 }}
                  className="absolute inset-0 -z-10 rounded-xl bg-[var(--fill-2)]"
                />
              )}
              <Icon
                className={`h-[19px] w-[19px] shrink-0 transition-colors ${
                  active ? "text-primary" : "text-muted-foreground"
                }`}
              />
              <span
                className={`truncate text-[10px] font-semibold transition-colors ${
                  active ? "text-foreground" : "text-muted-foreground"
                }`}
              >
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </motion.nav>
  );
}
