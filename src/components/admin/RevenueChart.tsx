import { useId, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

import { money } from "./ui";

export type ChartPoint = {
  key: string;
  label: string;
  revenue: number;
  /** Confirmed-but-not-done work in the same period. Optional. */
  booked?: number;
  jobs: number;
  bookedJobs?: number;
  start?: string;
  end?: string;
};

export type ChartMode = "bars" | "area";

/**
 * Revenue over time, drawn either as bars or as a filled line.
 *
 * Both views read the same data and share one hover state, so switching is
 * purely presentational — the numbers can't differ between them.
 *
 * Drawn by hand rather than with a charting library: the whole thing is a
 * few paths, and a library would be a large dependency plus a second theming
 * system to keep in sync with the token palette.
 */
export function RevenueChart({
  data,
  mode,
  height = 224,
  showBooked = true,
}: {
  data: ChartPoint[];
  mode: ChartMode;
  height?: number;
  showBooked?: boolean;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const gradientId = useId();

  const hasBooked = showBooked && data.some((d) => (d.booked ?? 0) > 0);
  const peak = Math.max(
    1,
    ...data.map((d) => Math.max(d.revenue, hasBooked ? (d.booked ?? 0) : 0)),
  );

  const active = hover !== null ? data[hover] : null;

  return (
    <div className="relative">
      {/* Shared tooltip. Positioned over the hovered column in both views. */}
      <AnimatePresence>
        {active && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full rounded-lg border border-[var(--line-2)] bg-[var(--card)] px-3 py-2 text-[11px] shadow-lg"
            style={{
              left: `${((hover! + 0.5) / data.length) * 100}%`,
              top: -4,
            }}
          >
            <p className="font-semibold text-foreground">
              {active.start && active.end && active.start !== active.end
                ? `${active.label}`
                : active.label}
            </p>
            <p className="tnum mt-0.5 text-muted-foreground">
              {money(active.revenue)} · {active.jobs} job{active.jobs === 1 ? "" : "s"}
            </p>
            {hasBooked && (active.booked ?? 0) > 0 && (
              <p className="tnum text-muted-foreground">
                {money(active.booked ?? 0)} booked
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {mode === "bars" ? (
        // `items-stretch`, NOT `items-end`. With items-end each column sizes
        // to its own content, so the bar's `height: N%` resolved against a
        // few pixels and every bar rendered as a sliver. Stretching gives the
        // column the container's full height for the percentage to work off.
        <div className="flex items-stretch gap-1.5" style={{ height }}>
          {data.map((d, i) => (
            <div
              key={d.key}
              className="group relative flex flex-1 flex-col items-center gap-2"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            >
              <div className="relative flex w-full flex-1 items-end gap-[2px]">
                <motion.div
                  initial={{ height: 0 }}
                  animate={{ height: `${(d.revenue / peak) * 100}%` }}
                  transition={{ delay: 0.04 + i * 0.025, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                  className={`rounded-t-md ${hasBooked ? "w-1/2" : "w-full"}`}
                  style={{
                    backgroundImage: "var(--gradient-brand)",
                    minHeight: d.revenue > 0 ? 4 : 2,
                    opacity: d.revenue > 0 ? (hover === null || hover === i ? 1 : 0.45) : 0.2,
                  }}
                />
                {hasBooked && (
                  <motion.div
                    initial={{ height: 0 }}
                    animate={{ height: `${((d.booked ?? 0) / peak) * 100}%` }}
                    transition={{ delay: 0.07 + i * 0.025, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                    className="w-1/2 rounded-t-md bg-[var(--fill-3)] ring-1 ring-inset ring-[var(--line-2)]"
                    style={{
                      minHeight: (d.booked ?? 0) > 0 ? 4 : 2,
                      opacity: (d.booked ?? 0) > 0 ? (hover === null || hover === i ? 1 : 0.45) : 0.15,
                    }}
                  />
                )}
              </div>
              <span
                className={`text-[10px] font-medium transition-colors ${
                  hover === i ? "text-foreground" : "text-muted-foreground"
                } ${
                  // Eight "Aug 31"-style labels will not fit across a phone,
                  // so show every other one below `sm`. Hidden with opacity,
                  // not display, so the columns keep identical widths and
                  // nothing shifts. Desktop is unaffected.
                  data.length > 6 && i % 2 === 1 ? "max-sm:opacity-0" : ""
                }`}
              >
                {d.label}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <AreaChart
          data={data}
          peak={peak}
          height={height}
          hover={hover}
          setHover={setHover}
          gradientId={gradientId}
          hasBooked={hasBooked}
        />
      )}
    </div>
  );
}

function AreaChart({
  data,
  peak,
  height,
  hover,
  setHover,
  gradientId,
  hasBooked,
}: {
  data: ChartPoint[];
  peak: number;
  height: number;
  hover: number | null;
  setHover: (i: number | null) => void;
  gradientId: string;
  hasBooked: boolean;
}) {
  // Fixed viewBox, stretched by CSS. `vector-effect` keeps strokes crisp at
  // any width, and `preserveAspectRatio="none"` lets the shape fill the card.
  const W = 600;
  const H = 200;
  const padY = 12;

  const x = (i: number) => (data.length === 1 ? W / 2 : (i / (data.length - 1)) * W);
  const y = (v: number) => H - padY - (v / peak) * (H - padY * 2);

  const line = (pick: (d: ChartPoint) => number) =>
    data.map((d, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(pick(d))}`).join(" ");

  const areaPath = `${line((d) => d.revenue)} L ${x(data.length - 1)} ${H} L ${x(0)} ${H} Z`;

  return (
    <div className="relative" style={{ height }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="h-[calc(100%-18px)] w-full overflow-visible"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.38" />
            <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Horizontal guides at 0 / 50 / 100% of peak. */}
        {[0, 0.5, 1].map((f) => (
          <line
            key={f}
            x1={0}
            x2={W}
            y1={y(peak * f)}
            y2={y(peak * f)}
            stroke="var(--line-1)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}

        {hasBooked && (
          <motion.path
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            d={line((d) => d.booked ?? 0)}
            fill="none"
            stroke="var(--line-3)"
            strokeWidth={2}
            strokeDasharray="5 4"
            vectorEffect="non-scaling-stroke"
          />
        )}

        <motion.path
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6 }}
          d={areaPath}
          fill={`url(#${gradientId})`}
        />
        <motion.path
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          d={line((d) => d.revenue)}
          fill="none"
          stroke="var(--primary)"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />

        {data.map((d, i) => (
          <circle
            key={d.key}
            cx={x(i)}
            cy={y(d.revenue)}
            r={hover === i ? 6 : 4}
            fill="var(--card)"
            stroke="var(--primary)"
            strokeWidth={2.5}
            vectorEffect="non-scaling-stroke"
            className="transition-all"
          />
        ))}
      </svg>

      {/* Hover targets and labels sit above the SVG so pointer maths stays
          simple — one column per point, full height. */}
      <div className="absolute inset-0 flex">
        {data.map((d, i) => (
          <div
            key={d.key}
            className="flex flex-1 flex-col justify-end"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            <span
              className={`pb-0 text-center text-[10px] font-medium transition-colors ${
                hover === i ? "text-foreground" : "text-muted-foreground"
              } ${data.length > 6 && i % 2 === 1 ? "max-sm:opacity-0" : ""}`}
            >
              {d.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Bars / line switch. */
export function ChartModeToggle({
  mode,
  onChange,
}: {
  mode: ChartMode;
  onChange: (m: ChartMode) => void;
}) {
  return (
    <div className="inline-flex gap-0.5 rounded-lg bg-[var(--fill-2)] p-0.5 ring-1 ring-inset ring-[var(--line-1)]">
      {(["bars", "area"] as ChartMode[]).map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => onChange(m)}
          aria-label={m === "bars" ? "Bar chart" : "Line chart"}
          aria-pressed={mode === m}
          className={`relative rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors ${
            mode === m ? "text-foreground" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {mode === m && (
            <motion.span
              layoutId="chart-mode"
              transition={{ type: "spring", stiffness: 420, damping: 34 }}
              className="absolute inset-0 -z-10 rounded-md bg-[var(--fill-3)]"
            />
          )}
          {m === "bars" ? "Bars" : "Line"}
        </button>
      ))}
    </div>
  );
}
