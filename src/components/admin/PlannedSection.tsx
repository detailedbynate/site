import { motion } from "motion/react";
import { Link } from "@tanstack/react-router";
import { ArrowUpRight, Construction } from "lucide-react";

import { PageHeader } from "./ui";

// Deliberately not fake UI. These sections exist in the nav because the
// owner asked for the full layout, but nothing backs them yet — so they say
// so plainly and point at the feature that does the job today.

export function PlannedSection({
  title,
  subtitle,
  what,
  insteadLabel,
  insteadTo,
}: {
  title: string;
  subtitle: string;
  what: string[];
  insteadLabel?: string;
  insteadTo?: string;
}) {
  return (
    <>
      <PageHeader title={title} subtitle={subtitle} />

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="liquid-glass relative overflow-hidden rounded-2xl p-8"
      >
        <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-primary/10 blur-[80px]" />

        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-400/15">
          <Construction className="h-5 w-5 text-amber-400" />
        </span>

        <h2 className="mt-4 text-lg font-bold tracking-tight text-foreground">Not built yet</h2>
        <p className="mt-2 max-w-xl text-sm text-muted-foreground">
          This section is in the layout so the shape of the admin is settled, but there's no data
          behind it yet. Here's what it would do:
        </p>

        <ul className="mt-5 space-y-2.5">
          {what.map((item, i) => (
            <motion.li
              key={item}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0, transition: { delay: 0.1 + i * 0.07 } }}
              className="flex items-start gap-2.5 text-sm text-foreground/80"
            >
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary shadow-[0_0_8px_var(--primary)]" />
              {item}
            </motion.li>
          ))}
        </ul>

        {insteadLabel && insteadTo && (
          <Link
            to={insteadTo}
            className="mt-7 inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-[13px] font-semibold text-primary-foreground transition-opacity hover:opacity-90"
            style={{ backgroundImage: "var(--gradient-brand)" }}
          >
            {insteadLabel} <ArrowUpRight className="h-4 w-4" />
          </Link>
        )}
      </motion.div>
    </>
  );
}
