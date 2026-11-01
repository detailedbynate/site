import type { CSSProperties, ReactNode } from "react";
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
  The phone version of a day: time runs DOWN the left edge and each job is a
  card as tall as the job is long — the layout Jobber and Square Appointments
  use on phones. The page simply scrolls vertically, like any list; nothing
  scrolls sideways. (Desktop keeps the horizontal Timeline, where a whole
  day fits across the screen.)
*/

export function DayColumn({
  items,
  hours: [fromHour, toHour],
  hourHeight = 72,
  schedule,
  isToday,
  nowMinute,
  empty,
  onJob,
}: {
  items: TimedItem[];
  hours: [number, number];
  hourHeight?: number;
  schedule?: Hours;
  isToday: boolean;
  nowMinute: number;
  empty?: ReactNode;
  onJob: (job: Job) => void;
}) {
  const height = (toHour - fromHour) * hourHeight;
  const y = (min: number) =>
    ((Math.min(Math.max(min, fromHour * 60), toHour * 60) - fromHour * 60) / 60) * hourHeight;
  const offs = items.filter((t) => t.kind === "off");
  const placed = placeLanes(items.filter((t) => t.kind !== "off"));
  const closed: [number, number][] = !schedule?.open
    ? [[fromHour, toHour]]
    : [
        [fromHour, schedule.openHour],
        [schedule.closeHour, toHour],
      ];

  return (
    <div className="flex">
      {/* Hour gutter */}
      <div className="relative w-12 shrink-0" style={{ height }}>
        {Array.from({ length: toHour - fromHour + 1 }, (_, i) => fromHour + i).map((h, i) => (
          <span
            key={h}
            className={`tnum absolute right-2.5 whitespace-nowrap text-[11px] font-medium text-[var(--st-ink-soft)] ${
              i === 0 ? "" : i === toHour - fromHour ? "-translate-y-full" : "-translate-y-1/2"
            }`}
            style={{ top: (h - fromHour) * hourHeight }}
          >
            {h === 24 ? "" : clock(h * 60)}
          </span>
        ))}
      </div>

      <div
        className="relative min-w-0 flex-1 border-l border-[var(--line-1)]"
        style={{
          height,
          backgroundImage: `repeating-linear-gradient(to bottom, var(--st-line) 0 1px, transparent 1px ${hourHeight}px)`,
        }}
      >
        {closed.map(
          ([a, b], i) =>
            b > a && (
              <div
                key={i}
                className="cal-closed absolute inset-x-0"
                style={{ top: y(a * 60), height: y(b * 60) - y(a * 60) }}
              />
            ),
        )}

        {!placed.length && !offs.length && empty && (
          <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-[13px] text-[var(--st-body-soft)]">
            {empty}
          </div>
        )}

        {placed.map((p, i) => (
          <Block
            key={`${p.kind}-${p.id}`}
            item={p}
            index={i}
            top={y(p.start)}
            height={Math.max(y(p.end) - y(p.start), 26)}
            onJob={onJob}
          />
        ))}

        {/* Time off: a see-through band over the column, never a lane. */}
        {offs.map((o) =>
          o.kind === "off" ? (
            <div
              key={o.id}
              className="cal-off-band pointer-events-none absolute inset-x-1 z-[15] flex justify-end rounded-xl p-1.5"
              style={{ top: y(o.start), height: Math.max(y(o.end) - y(o.start), 22) }}
            >
              <span className="cal-off-tag cal-off-ink flex h-fit max-w-full items-center gap-1 truncate rounded-full px-2 py-0.5 text-[10.5px] font-semibold">
                <Ban className="h-3 w-3 shrink-0" />
                <span className="truncate">{o.off.reason || "Time off"}</span>
              </span>
            </div>
          ) : null,
        )}

        {isToday && nowMinute > fromHour * 60 && nowMinute < toHour * 60 && (
          <div
            className="pointer-events-none absolute inset-x-0 z-20 flex items-center"
            style={{ top: y(nowMinute) }}
            aria-label={`Now, ${clock(nowMinute)}`}
          >
            <span className="-ml-[5px] h-2.5 w-2.5 rounded-full bg-[var(--st-accent)]" />
            <span className="h-[2px] flex-1 bg-[var(--st-accent)]" />
          </div>
        )}
      </div>
    </div>
  );
}

function Block({
  item,
  index,
  top,
  height,
  onJob,
}: {
  item: Placed;
  index: number;
  top: number;
  height: number;
  onJob: (job: Job) => void;
}) {
  const style = {
    top: top + 2,
    height: height - 4,
    left: `calc(${(item.lane / item.lanes) * 100}% + 4px)`,
    width: `calc(${100 / item.lanes}% - 8px)`,
    animationDelay: `${Math.min(index * 25, 150)}ms`,
  } as CSSProperties;
  // How much room there is decides how much is said.
  const tiny = height < 46;
  const roomy = height >= 112;

  if (item.kind === "job") {
    const job = item.job;
    const name = job.client?.name ?? "Client";
    return (
      <button
        type="button"
        onClick={() => onJob(job)}
        className="cal-glass cal-press cal-enter absolute z-10 overflow-hidden rounded-2xl text-left outline-none focus-visible:ring-2 focus-visible:ring-primary"
        style={{ ...style, "--c": jobColor(job) } as CSSProperties}
        title={`${range(item.start, item.end)} · ${name} · ${job.serviceTitle}`}
      >
        <span className="absolute inset-y-2.5 left-0 w-[3px] rounded-r-full bg-[var(--c)]" />
        {tiny ? (
          <p className="flex h-full items-center gap-1.5 truncate pl-3.5 pr-2 text-[12.5px] font-semibold text-foreground">
            <span className="tnum text-muted-foreground">{clock(item.start)}</span>
            <span className="truncate">{name}</span>
          </p>
        ) : (
          <div className="flex h-full min-w-0 flex-col py-2.5 pl-4 pr-3">
            <div className="flex items-start justify-between gap-2">
              <p className="truncate text-[15px] font-semibold tracking-tight text-foreground">{name}</p>
              {job.status === "completed" ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-muted-foreground" />
              ) : (
                <span className="tnum shrink-0 text-[13px] font-semibold text-foreground/90">
                  {money((job.totalPrice ?? 0) - (job.discount ?? 0))}
                </span>
              )}
            </div>
            <p className="tnum truncate text-[12px] text-muted-foreground">
              {range(item.start, item.end)} · {job.serviceTitle}
            </p>
            {roomy && (
              <>
                {vehicleLine(job) && (
                  <p className="mt-1 truncate text-[12px] text-muted-foreground">{vehicleLine(job)}</p>
                )}
                <p className="mt-auto flex items-center gap-1 truncate text-[12px] text-muted-foreground">
                  {job.location === "mobile" ? (
                    <MapPin className="h-3 w-3 shrink-0" />
                  ) : (
                    <Store className="h-3 w-3 shrink-0" />
                  )}
                  <span className="truncate">
                    {job.location === "mobile" ? job.address || "Mobile" : "Drop-off"}
                  </span>
                </p>
              </>
            )}
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
        style={style}
        title={`${range(item.start, item.end)} · ${e.summary}`}
      >
        <p className="flex items-center gap-1 truncate text-[12.5px] font-medium text-foreground/90">
          <span className="truncate">{e.summary}</span>
          <ExternalLink className="h-3 w-3 shrink-0 opacity-50" />
        </p>
        {!tiny && (
          <p className="tnum truncate text-[11px] text-muted-foreground">{range(item.start, item.end)} · Google</p>
        )}
      </a>
    );
  }
  return null;
}
