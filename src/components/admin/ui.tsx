import { forwardRef, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { Loader2, X as XIcon } from "lucide-react";

// Shared building blocks for the admin. Everything here is theme-token
// driven (no hardcoded colors) so the admin restyles with the marketing
// site — see the brand tokens in styles.css.

export const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  show: (i = 0) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.05, duration: 0.45, ease: [0.16, 1, 0.3, 1] as const },
  }),
};

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="mb-8 flex flex-wrap items-end justify-between gap-4"
    >
      <div>
        <h1 className="text-[26px] font-bold leading-tight tracking-[-0.03em] text-foreground">{title}</h1>
        {subtitle && (
          <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
            {subtitle}
          </p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </motion.div>
  );
}

export function GlassCard({
  children,
  className = "",
  index = 0,
  hover = false,
}: {
  children: ReactNode;
  className?: string;
  index?: number;
  hover?: boolean;
}) {
  return (
    <motion.div
      custom={index}
      variants={fadeUp}
      initial="hidden"
      animate="show"
      {...(hover ? { whileHover: { y: -4 } } : {})}
      className={`liquid-glass rounded-2xl ${className}`}
    >
      {children}
    </motion.div>
  );
}

/**
 * Headline number card.
 *
 * Padding and type step down below `sm`, where these sit two-up in roughly
 * 170px of width. Everything from `sm:` upward is the original desktop
 * sizing, untouched.
 */
export function StatTile({
  label,
  value,
  hint,
  icon: Icon,
  index = 0,
  accent = false,
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon: React.ComponentType<{ className?: string }>;
  index?: number;
  accent?: boolean;
}) {
  return (
    <motion.div
      custom={index}
      variants={fadeUp}
      initial="hidden"
      animate="show"
      whileHover={{ y: -2 }}
      className={`liquid-glass relative overflow-hidden rounded-2xl p-4 sm:p-5 ${
        accent ? "ring-1 ring-inset ring-primary/25" : ""
      }`}
    >
      <div className="flex items-start gap-2 sm:items-center">
        <Icon className="mt-px h-3.5 w-3.5 shrink-0 text-primary sm:mt-0 sm:h-4 sm:w-4" />
        {/* Wraps rather than truncating: at half a phone's width "Revenue this
            month" became "REVENUE THIS M…", which reads worse than two lines.
            `sm:` and up is single-line as before. */}
        <p className="text-[10px] font-semibold uppercase leading-tight tracking-[0.1em] text-muted-foreground sm:truncate sm:text-[11px] sm:leading-normal sm:tracking-[0.12em]">
          {label}
        </p>
      </div>
      <motion.p
        key={String(value)}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="tnum mt-2.5 text-[22px] font-bold leading-none tracking-tight text-foreground sm:mt-3 sm:text-[30px]"
      >
        {value}
      </motion.p>
      {hint && <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground sm:mt-2 sm:text-xs">{hint}</p>}
    </motion.div>
  );
}

const statusStyles: Record<string, string> = {
  confirmed: "bg-primary/12 text-primary ring-primary/25",
  completed: "bg-emerald-400/12 text-emerald-300 ring-emerald-400/25",
  cancelled: "bg-[var(--fill-2)] text-muted-foreground ring-[var(--line-2)]",
  active: "bg-emerald-400/12 text-emerald-300 ring-emerald-400/25",
  inactive: "bg-[var(--fill-2)] text-muted-foreground ring-[var(--line-2)]",
};

export function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-semibold capitalize ring-1 ring-inset ${
        statusStyles[status] ?? statusStyles.inactive
      }`}
    >
      {status}
    </span>
  );
}

type ButtonVariant = "primary" | "outline" | "ghost" | "danger";

const variants: Record<ButtonVariant, string> = {
  primary: "text-primary-foreground",
  outline: "border border-[var(--line-2)] bg-[var(--fill-1)] text-foreground hover:bg-[var(--fill-3)]",
  ghost: "text-muted-foreground hover:text-foreground hover:bg-[var(--fill-2)]",
  danger:
    "border border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/20",
};

export const Button = forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: ButtonVariant;
    loading?: boolean;
    size?: "sm" | "md";
  }
>(function Button(
  { variant = "outline", loading, size = "md", className = "", children, disabled, ...rest },
  ref,
) {
  const sizing = size === "sm" ? "px-2.5 py-1.5 text-xs" : "px-4 py-2 text-[13px]";
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50 ${sizing} ${variants[variant]} ${className}`}
      style={
        variant === "primary"
          ? { backgroundImage: "var(--gradient-brand)" }
          : undefined
      }
      {...rest}
    >
      {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      {children}
    </button>
  );
});

export const inputCls =
  "w-full rounded-lg border border-[var(--line-2)] bg-[var(--fill-1)] px-3.5 py-2.5 text-[13px] text-foreground outline-none transition placeholder:text-muted-foreground/50 focus:border-primary/60 focus:bg-[var(--fill-2)] focus:ring-2 focus:ring-primary/20";

export function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12px] font-medium text-muted-foreground">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-[11px] text-muted-foreground">{hint}</span>}
      {error && (
        <motion.span
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-1 block text-[11px] font-semibold text-destructive"
        >
          {error}
        </motion.span>
      )}
    </label>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      className="liquid-glass flex flex-col items-center rounded-2xl px-6 py-16 text-center"
    >
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
        <Icon className="h-6 w-6 text-primary" />
      </span>
      <p className="mt-4 text-[15px] font-semibold text-foreground">{title}</p>
      <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </motion.div>
  );
}

/**
 * Loading state. Reserves most of the viewport on purpose: every page fetches
 * on mount, so a short spinner followed by a tall page made the layout snap
 * downward the instant data arrived. Holding the height keeps the transition
 * from the previous page continuous.
 */
export function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.12 }}
      className="flex min-h-[58vh] items-center justify-center gap-2 text-sm text-muted-foreground"
    >
      <Loader2 className="h-4 w-4 animate-spin" /> {label}
    </motion.div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <motion.p
      role="alert"
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-lg bg-destructive/12 px-3.5 py-2.5 text-[13px] font-medium text-destructive ring-1 ring-inset ring-destructive/25"
    >
      {children}
    </motion.p>
  );
}

export function SuccessNote({ children }: { children: ReactNode }) {
  return (
    <motion.p
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-lg bg-emerald-400/12 px-3.5 py-2.5 text-[13px] font-medium text-emerald-300 ring-1 ring-inset ring-emerald-400/25"
    >
      {children}
    </motion.p>
  );
}

/** Table shell that scrolls horizontally on small screens without pushing the page. */
export function TableWrap({ children }: { children: ReactNode }) {
  return (
    <div className="liquid-glass overflow-hidden rounded-3xl">
      <div className="overflow-x-auto">{children}</div>
    </div>
  );
}

export function Th({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <th
      className={`whitespace-nowrap px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground ${className}`}
    >
      {children}
    </th>
  );
}

export function Td({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <td className={`px-4 py-3 align-middle text-sm ${className}`}>{children}</td>;
}

export function money(n: number): string {
  // The sign goes before the currency symbol: a loss reads "-$135", never
  // "$-135". Finance shows negatives routinely, so this matters.
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toLocaleString("en-US")}`;
}

export function hours(minutes: number): string {
  return `${Math.round((minutes / 60) * 10) / 10} hr`;
}

/** "14:30" -> "2:30 PM" */
export function time12h(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")} ${period}`;
}

export function prettyDate(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

// --------------------------------------------------------------------------
// List + detail. Tables force every column to fit the narrowest screen and
// still can't show everything; a scannable row that opens a full detail
// panel shows the summary you need at a glance and the rest on demand.
// --------------------------------------------------------------------------

/**
 * Renders children into <body>.
 *
 * `position: fixed` is resolved against the nearest ancestor that has a
 * transform, filter or backdrop-filter — not the viewport. The admin page
 * wrapper animates (transform) and every card uses backdrop-filter, so any
 * overlay rendered inline lands relative to that ancestor and can end up
 * hundreds of pixels down the page, half off-screen. Portalling to body is
 * the only reliable fix.
 */
export function Portal({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted || typeof document === "undefined") return null;
  return createPortal(children, document.body);
}

export function ListRow({
  onClick,
  index = 0,
  muted = false,
  children,
}: {
  onClick?: () => void;
  index?: number;
  muted?: boolean;
  children: ReactNode;
}) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0, transition: { delay: Math.min(index * 0.03, 0.25) } }}
      exit={{ opacity: 0, scale: 0.99 }}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={(e) => {
        if (onClick && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onClick();
        }
      }}
      className={`group grid cursor-pointer grid-cols-[auto_1fr_auto] items-center gap-4 rounded-xl border border-[var(--line-1)] bg-[var(--fill-1)] px-4 py-3.5 transition-colors hover:border-primary/30 hover:bg-[var(--fill-2)] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
        muted ? "opacity-55" : ""
      }`}
    >
      {children}
    </motion.div>
  );
}

/** Circle with initials — cheap, recognisable row anchor. */
export function Avatar({ name, sub }: { name: string; sub?: string }) {
  const initials = name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
  return (
    <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--fill-2)] text-[12px] font-bold text-foreground ring-1 ring-inset ring-[var(--line-2)]">
      {initials || "?"}
      {sub && (
        <span className="absolute -bottom-0.5 -right-0.5 rounded-full bg-[var(--card)] px-1 text-[9px] font-bold text-primary ring-1 ring-white/10">
          {sub}
        </span>
      )}
    </span>
  );
}

/** Right-hand slide-over used for the full record. */
export function DetailPanel({
  open,
  onClose,
  title,
  eyebrow,
  footer,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  eyebrow?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Portal>
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-black/55 backdrop-blur-[3px]"
          />
          <motion.aside
            initial={{ x: 460 }}
            animate={{ x: 0 }}
            exit={{ x: 460 }}
            transition={{ type: "spring", stiffness: 320, damping: 36 }}
            role="dialog"
            aria-modal="true"
            className="admin-theme fixed inset-y-0 right-0 z-50 flex w-full max-w-[460px] flex-col border-l border-[var(--line-2)] bg-[var(--background)]"
          >
            <div className="flex items-start justify-between gap-4 border-b border-[var(--line-1)] px-6 py-5">
              <div className="min-w-0">
                {eyebrow && (
                  <p className="mb-1 text-[11px] font-medium text-muted-foreground">{eyebrow}</p>
                )}
                <h2 className="truncate text-lg font-bold tracking-tight text-foreground">
                  {title}
                </h2>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="shrink-0 rounded-lg p-2 text-muted-foreground transition hover:bg-[var(--fill-2)] hover:text-foreground"
              >
                <XIcon className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>

            {footer && (
              <div className="border-t border-[var(--line-1)] px-6 py-4">{footer}</div>
            )}
          </motion.aside>
        </>
      )}
    </AnimatePresence>
    </Portal>
  );
}

/** Label/value pair for inside a DetailPanel. */
export function DetailField({
  label,
  children,
  icon: Icon,
}: {
  label: string;
  children: ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="border-b border-[var(--line-1)] py-3 last:border-0">
      <p className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
        {Icon && <Icon className="h-3 w-3" />}
        {label}
      </p>
      <div className="text-[13.5px] font-medium leading-relaxed text-foreground">{children}</div>
    </div>
  );
}

export function DetailGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-6 last:mb-0">
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-primary">
        {title}
      </p>
      {children}
    </section>
  );
}

/** Pill-style on/off control — clearer than a bare switch about its state. */
export function ToggleChip({
  on,
  onChange,
  labels = ["Live", "Hidden"],
}: {
  on: boolean;
  onChange: (next: boolean) => void;
  labels?: [string, string];
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!on);
      }}
      className={`relative inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold ring-1 ring-inset transition-colors ${
        on
          ? "bg-emerald-400/12 text-emerald-300 ring-emerald-400/30 hover:bg-emerald-400/20"
          : "bg-[var(--fill-2)] text-muted-foreground ring-[var(--line-2)] hover:bg-[var(--fill-3)]"
      }`}
    >
      <motion.span
        layout
        transition={{ type: "spring", stiffness: 500, damping: 30 }}
        className={`h-1.5 w-1.5 rounded-full ${on ? "bg-emerald-400" : "bg-muted-foreground/60"}`}
        style={on ? { boxShadow: "0 0 8px currentColor" } : undefined}
      />
      {on ? labels[0] : labels[1]}
    </button>
  );
}
