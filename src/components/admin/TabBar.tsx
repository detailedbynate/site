import { motion } from "motion/react";

/**
 * Segmented control with a pill that slides between options.
 *
 * The pill is a single element shared across tabs via `layoutId`, so Motion
 * tweens its position instead of hard-cutting a background colour from one
 * button to the next — which is what made switching categories look like it
 * glitched. Every tab group in the admin uses this so the motion is identical
 * everywhere.
 */
export function TabBar<T extends string>({
  tabs,
  value,
  onChange,
  layoutId,
  size = "md",
}: {
  tabs: { value: T; label: string; count?: number }[];
  value: T;
  onChange: (next: T) => void;
  /** Must be unique per tab group on the page. */
  layoutId: string;
  size?: "sm" | "md";
}) {
  const pad = size === "sm" ? "px-3 py-1.5 text-[12px]" : "px-3.5 py-2 text-[13px]";

  return (
    <div
      role="tablist"
      className="inline-flex flex-wrap gap-0.5 rounded-xl bg-[var(--fill-2)] p-1 ring-1 ring-inset ring-[var(--line-1)]"
    >
      {tabs.map((t) => {
        const active = t.value === value;
        return (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.value)}
            className={`relative rounded-lg font-semibold transition-colors ${pad} ${
              active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {active && (
              <motion.span
                layoutId={layoutId}
                transition={{ type: "spring", stiffness: 420, damping: 34 }}
                className="absolute inset-0 -z-10 rounded-lg bg-[var(--fill-3)] shadow-sm ring-1 ring-inset ring-[var(--line-2)]"
              />
            )}
            {t.label}
            {t.count !== undefined && (
              <span className="tnum ml-1.5 opacity-50">{t.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Wrapper for whatever a tab reveals. Crossfades on change and animates its
 * own height, so the page doesn't jump when panels differ in length.
 */
export function TabPanel({
  tabKey,
  children,
}: {
  tabKey: string;
  children: React.ReactNode;
}) {
  return (
    <motion.div
      key={tabKey}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  );
}
