import { motion } from "motion/react";
import { Check } from "lucide-react";

type Props = {
  steps: string[];
  current: number;
};

export function StepProgress({ steps, current }: Props) {
  const pct = (current / (steps.length - 1)) * 100;

  return (
    <div className="w-full">
      <div className="mb-3 flex items-end justify-between gap-4 sm:mb-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
            Step {current + 1} of {steps.length}
          </p>
          <h2 className="mt-1 text-base font-semibold text-foreground sm:text-lg">{steps[current]}</h2>
        </div>
        <motion.span
          key={pct}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="shrink-0 text-sm font-semibold text-muted-foreground"
        >
          {Math.round(pct)}% complete
        </motion.span>
      </div>

      <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-secondary">
        <motion.div
          className="animate-shimmer h-full rounded-full"
          style={{
            backgroundImage:
              "linear-gradient(90deg, var(--brand-deep), var(--brand), var(--brand-soft), var(--brand))",
          }}
          initial={false}
          animate={{ width: `${pct}%` }}
          transition={{ type: "spring", stiffness: 120, damping: 20 }}
        />
      </div>

      <div className="mt-3 flex items-center justify-between gap-1 sm:mt-4">
        {steps.map((s, i) => {
          const done = i < current;
          const active = i === current;
          return (
            <div key={s} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
              <motion.div
                animate={{
                  scale: active ? 1.15 : 1,
                  backgroundColor: done || active ? "var(--brand)" : "var(--secondary)",
                }}
                transition={{ type: "spring", stiffness: 300, damping: 18 }}
                className="flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold text-primary-foreground sm:h-7 sm:w-7"
                style={{ boxShadow: active ? "var(--shadow-glow)" : "none" }}
              >
                {done ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  <span className={done || active ? "" : "text-muted-foreground"}>{i + 1}</span>
                )}
              </motion.div>
              <span
                className={`hidden truncate text-[11px] font-medium sm:block ${
                  active ? "text-foreground" : "text-muted-foreground"
                }`}
              >
                {s}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
