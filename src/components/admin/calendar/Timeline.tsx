import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { Ban, CheckCircle2, ExternalLink, MapPin, Store } from "lucide-react";

import { money } from "@/components/admin/ui";
import {
  clock,
  jobColor,
  placeLanes,
  range,
  vehicleLine,
  type Hours,
  type Job,
  type Placed,
  type TimedItem,
} from "./model";

/*
  Horizontal timeline: hours run left to right across the top, and each job
  is a frosted card whose left edge is its start and whose width is its
  length. Rows stack downward — one row (split into lanes) for Day, one row
  per weekday for Week, like a dispatch board.

  Positions are percentages of the track, with a minimum pixel width per
  hour, so a desktop fits the whole day while a phone scrolls sideways
  instead of crushing a four-hour job into a sliver.
*/

export interface TimelineRow {
  key: string;
  /** Left column label (Week view). Day view has none. */
  label?: ReactNode;
  items: TimedItem[];
  schedule?: Hours;
  isToday: boolean;
  /** Shown in the track when the row has nothing on it. */
  empty?: ReactNode;
}

export function Timeline({
  rows,
  hours: [fromHour, toHour],
  minHourPx,
  laneHeight,
  nowMinute,
  compact = false,
  labelWidth = 0,
  onJob,
}: {
  rows: TimelineRow[];
  hours: [number, number];
  minHourPx: number;
  laneHeight: number;
  nowMinute: number;
  compact?: boolean;
  labelWidth?: number;
  onJob: (job: Job) => void;
}) {
  const span = (toHour - fromHour) * 60;
  const pct = (min: number) => ((Math.min(Math.max(min, fromHour * 60), toHour * 60) - fromHour * 60) / span) * 100;
  const hourCount = toHour - fromHour;
  const scroller = useRef<HTMLDivElement>(null);

  // On a phone the track is wider than the screen. Open it on the first job
  // (or "now"), not on an empty 7 AM.
  const firstStart = Math.min(
    ...rows.flatMap((r) => r.items.filter((i) => i.kind !== "off").map((i) => i.start)),
    rows.some((r) => r.isToday) ? nowMinute : Infinity,
  );
  useEffect(() => {
    const el = scroller.current;
    if (!el || el.scrollWidth <= el.clientWidth || !Number.isFinite(firstStart)) return;
    const track = el.scrollWidth - labelWidth;
    const x = labelWidth + (pct(firstStart) / 100) * track - labelWidth - 24;
    el.scrollTo({ left: Math.max(0, x), behavior: "smooth" });
    // Only when the set of rows changes, not on every "now" tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.map((r) => r.key).join(), fromHour, toHour]);

  // One vertical hairline per hour, as a background: no extra elements.
  const grid: CSSProperties = {
    backgroundImage: "linear-gradient(to right, var(--st-line) 1px, transparent 1px)",
    backgroundSize: `${100 / hourCount}% 100%`,
  };

  return (
    <div ref={scroller} className="cal-scroll -mx-4 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:px-6">
      {/* Phones scroll at the full per-hour width; from md up an hour may
          shrink to 60% of it, so a whole working day fits on a laptop. */}
      <div
        className="relative min-w-[var(--tl-min)] md:min-w-[var(--tl-min-md)]"
        style={
          {
            "--tl-min": `${labelWidth + hourCount * minHourPx}px`,
            "--tl-min-md": `${labelWidth + hourCount * Math.round(minHourPx * 0.6)}px`,
          } as CSSProperties
        }
      >
        {/* Hour header: "09:00" over a dot, as in the reference. */}
        <div className="flex">
          {labelWidth > 0 && <div style={{ width: labelWidth }} className="shrink-0" />}
          <div className="relative h-11 flex-1">
            {Array.from({ length: hourCount + 1 }, (_, i) => fromHour + i).map((h, i) => (
              <div
                key={h}
                className={`absolute top-0 flex flex-col items-center ${i === 0 ? "" : i === hourCount ? "-translate-x-full items-end" : "-translate-x-1/2"}`}
                style={{ left: `${(i / hourCount) * 100}%` }}
              >
                <span className="tnum whitespace-nowrap text-[11.5px] font-medium text-[var(--st-ink-soft)]">
                  {h === 24 ? "" : clock(h * 60)}
                </span>
                <span className="mt-2 h-1.5 w-1.5 rounded-full bg-[var(--st-ink-soft)] opacity-70" />
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          {rows.map((row) => {
            const timed = row.items;
            const offs = timed.filter((t) => t.kind === "off");
            const placed = placeLanes(timed.filter((t) => t.kind !== "off"));
            const lanes = Math.max(1, ...placed.map((p) => p.lane + 1));
            const height = lanes * laneHeight;
            const s = row.schedule;
            const closed: [number, number][] = !s?.open
              ? [[fromHour, toHour]]
              : [
                  [fromHour, s.openHour],
                  [s.closeHour, toHour],
                ];

            return (
              <div key={row.key} className="flex">
                {labelWidth > 0 && (
                  <div
                    className="cal-row-label sticky left-0 z-30 flex shrink-0 items-center pr-3"
                    style={{ width: labelWidth, height }}
                  >
                    {row.label}
                  </div>
                )}
                <div
                  className={`relative flex-1 rounded-2xl ${row.isToday && labelWidth ? "cal-row-today" : ""}`}
                  style={{ ...grid, height }}
                >
                  {closed.map(
                    ([a, b], i) =>
                      b > a && (
                        <div
                          key={i}
                          className="cal-closed absolute inset-y-0 rounded-xl"
                          style={{ left: `${pct(a * 60)}%`, width: `${pct(b * 60) - pct(a * 60)}%` }}
                        />
                      ),
                  )}

                  {!placed.length && !offs.length && row.empty && (
                    <div className="absolute inset-0 flex items-center justify-center text-[12.5px] text-[var(--st-body-soft)]">
                      {row.empty}
                    </div>
                  )}

                  {placed.map((p, i) => (
                    <Card
                      key={`${p.kind}-${p.id}`}
                      item={p}
                      index={i}
                      left={pct(p.start)}
                      width={pct(p.end) - pct(p.start)}
                      top={p.lane * laneHeight}
                      height={laneHeight}
                      compact={compact}
                      onJob={onJob}
                    />
                  ))}

                  {offs.map((o) => (
                    <OffBand key={o.id} item={o} left={pct(o.start)} width={pct(o.end) - pct(o.start)} />
                  ))}

                  {row.isToday && nowMinute > fromHour * 60 && nowMinute < toHour * 60 && (
                    <div
                      className="pointer-events-none absolute inset-y-[-6px] z-20 flex flex-col items-center"
                      style={{ left: `${pct(nowMinute)}%` }}
                      aria-label={`Now, ${clock(nowMinute)}`}
                    >
                      <span className="h-2 w-2 -translate-x-1/2 rounded-full bg-[var(--st-accent)]" />
                      <span className="w-[2px] flex-1 -translate-x-1/2 bg-[var(--st-accent)]" />
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Card({
  item,
  index,
  left,
  width,
  top,
  height,
  compact,
  onJob,
}: {
  item: Placed;
  index: number;
  left: number;
  width: number;
  top: number;
  height: number;
  compact: boolean;
  onJob: (job: Job) => void;
}) {
  const style = {
    left: `calc(${left}% + 3px)`,
    width: `calc(${width}% - 6px)`,
    top: top + 5,
    height: height - 10,
  } as CSSProperties;
  /*
    Plain elements with CSS hover/press, not Motion components. The whole view
    already slides in as one piece, so a per-card entrance only repeated that
    motion — while each Motion card cost its own animation setup on every day
    you stepped to. CSS transforms run on the compositor and cost nothing
    until touched. `index` is kept for a tiny staggered fade on first paint.
  */
  const enter = { animationDelay: `${Math.min(index * 25, 150)}ms` } as CSSProperties;

  if (item.kind === "job") {
    const job = item.job;
    const name = job.client?.name ?? "Client";
    const done = job.status === "completed";
    return (
      <button
        type="button"
        onClick={() => onJob(job)}
        className="cal-glass cal-press cal-enter group absolute z-10 overflow-hidden rounded-2xl text-left outline-none focus-visible:ring-2 focus-visible:ring-primary"
        style={{ ...style, ...enter, "--c": jobColor(job) } as CSSProperties}
        title={`${range(item.start, item.end)} · ${name} · ${job.serviceTitle}`}
      >
        <span className="absolute inset-y-3 left-0 w-[3px] rounded-r-full bg-[var(--c)]" />
        {compact ? (
          <div className="flex h-full flex-col justify-center pl-3.5 pr-2.5">
            <p className="truncate text-[12.5px] font-semibold text-foreground">{name}</p>
            <p className="tnum truncate text-[11px] text-muted-foreground">
              {range(item.start, item.end)} · {job.serviceTitle}
            </p>
          </div>
        ) : (
          <div className="flex h-full min-w-0 flex-col pb-2.5 pl-4 pr-3 pt-3">
            <div className="flex items-start justify-between gap-2">
              <p className="truncate text-[15px] font-semibold tracking-tight text-foreground">{name}</p>
              {done ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-muted-foreground" />
              ) : (
                <span className="tnum shrink-0 text-[12.5px] font-semibold text-foreground/90">
                  {money((job.totalPrice ?? 0) - (job.discount ?? 0))}
                </span>
              )}
            </div>
            <span className="tnum mt-1.5 w-fit max-w-full truncate rounded-full bg-[var(--fill-3)] px-2.5 py-[3px] text-[11.5px] font-medium text-foreground/90">
              {range(item.start, item.end)}
            </span>
            <p className="mt-1.5 truncate text-[12px] text-muted-foreground">
              {job.serviceTitle}
              {job.addOnTitles?.length ? ` + ${job.addOnTitles.length}` : ""}
              {vehicleLine(job) ? ` · ${vehicleLine(job)}` : ""}
            </p>
            <p className="mt-auto flex items-center gap-1 truncate text-[11.5px] text-muted-foreground">
              {job.location === "mobile" ? (
                <MapPin className="h-3 w-3 shrink-0" />
              ) : (
                <Store className="h-3 w-3 shrink-0" />
              )}
              <span className="truncate">
                {job.location === "mobile" ? job.address || "Mobile" : "Drop-off"}
              </span>
            </p>
          </div>
        )}
      </button>
    );
  }

  if (item.kind === "event") {
    const e = item.event;
    return (
      <a
        href={e.htmlLink || undefined}
        target="_blank"
        rel="noreferrer"
        className={`cal-glass-ghost cal-press cal-enter absolute z-[5] flex flex-col justify-center overflow-hidden rounded-2xl px-3 ${e.free ? "opacity-60" : ""}`}
        style={{ ...style, ...enter }}
        title={`${range(item.start, item.end)} · ${e.summary}${e.free ? " (free — still bookable)" : ""}`}
      >
        <p className="flex items-center gap-1 truncate text-[12.5px] font-medium text-foreground/90">
          <span className="truncate">{e.summary}</span>
          <ExternalLink className="h-3 w-3 shrink-0 opacity-50" />
        </p>
        <p className="tnum truncate text-[11px] text-muted-foreground">{range(item.start, item.end)} · Google</p>
      </a>
    );
  }
  return null;
}

/** Time off: a striped band over the whole row, see-through and click-through. */
function OffBand({ item, left, width }: { item: TimedItem; left: number; width: number }) {
  if (item.kind !== "off") return null;
  return (
    <div
      className="cal-off-band pointer-events-none absolute inset-y-0 z-[15] flex items-start justify-end rounded-xl p-1.5"
      style={{ left: `${left}%`, width: `${width}%` }}
      title={item.off.reason || "Time off"}
    >
      <span className="flex max-w-full items-center gap-1 truncate rounded-full cal-off-tag cal-off-ink px-2 py-0.5 text-[10.5px] font-semibold">
        <Ban className="h-3 w-3 shrink-0" />
        <span className="truncate">{item.off.reason || "Time off"}</span>
      </span>
    </div>
  );
}
