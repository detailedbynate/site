import type { CSSProperties } from "react";
import { motion } from "motion/react";
import { Ban, CheckCircle2, ExternalLink, MapPin, Store } from "lucide-react";

import { money } from "@/components/admin/ui";
import {
  clock,
  jobColor,
  placeLanes,
  range,
  vehicleLine,
  type AllDayItem,
  type DayContents,
  type Hours,
  type Job,
  type Placed,
} from "./model";

/*
  One time grid, used by both Day (one column) and Week (seven).

  Every block is positioned by the clock: top is its start, height is its
  length. A four-hour Diamond is visibly four times a one-hour wash, which is
  the thing the old month-grid list could never show — you could not see at
  a glance whether a 1 PM slot really fits after a 9:30 job.
*/

export function TimeGrid({
  days,
  contents,
  hours: [fromHour, toHour],
  hourHeight,
  schedules,
  today,
  nowMinute,
  compact = false,
  onJob,
}: {
  days: string[];
  contents: Map<string, DayContents>;
  hours: [number, number];
  hourHeight: number;
  schedules: Map<string, Hours | undefined>;
  today: string;
  nowMinute: number;
  compact?: boolean;
  onJob: (job: Job) => void;
}) {
  const height = (toHour - fromHour) * hourHeight;
  const y = (min: number) => ((min - fromHour * 60) / 60) * hourHeight;
  const hourMarks = Array.from({ length: toHour - fromHour + 1 }, (_, i) => fromHour + i);

  // Hour lines as a background, so seven columns cost no extra elements.
  const lines: CSSProperties = {
    height,
    backgroundImage: `repeating-linear-gradient(to bottom, var(--line-1) 0 1px, transparent 1px ${hourHeight}px)`,
  };

  return (
    <div className="flex">
      {/* Hour gutter */}
      <div className="relative w-11 shrink-0 sm:w-14" style={{ height }}>
        {hourMarks.map((h, i) => (
          <span
            key={h}
            className={`tnum absolute right-2 text-[10.5px] font-medium text-muted-foreground sm:right-3 sm:text-[11px] ${
              i === 0 ? "" : "-translate-y-1/2"
            }`}
            style={{ top: (h - fromHour) * hourHeight }}
          >
            {h === 24 ? "" : clock(h * 60)}
          </span>
        ))}
      </div>

      <div
        className="grid min-w-0 flex-1"
        style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}
      >
        {days.map((date) => {
          const day = contents.get(date);
          // Time off is a band BEHIND the work, not a lane beside it: a lunch
          // block over a long job should not squeeze that job to half width.
          const timed = day?.timed ?? [];
          const placed: Placed[] = [
            ...timed
              .filter((t) => t.kind === "off")
              .map((t) => ({ ...t, lane: 0, lanes: 1 })),
            ...placeLanes(timed.filter((t) => t.kind !== "off")),
          ];
          const s = schedules.get(date);
          const isToday = date === today;

          return (
            <div
              key={date}
              className={`relative border-l border-[var(--line-1)] ${isToday && days.length > 1 ? "bg-primary/[0.03]" : ""}`}
              style={lines}
            >
              {/* Outside business hours: shaded, so open time stands out. */}
              {(!s?.open ? [[fromHour, toHour]] : [[fromHour, s.openHour], [s.closeHour, toHour]]).map(
                ([a, b], i) =>
                  b > a && (
                    <div
                      key={i}
                      className="cal-closed absolute inset-x-0"
                      style={{ top: y(a * 60), height: (b - a) * hourHeight }}
                    />
                  ),
              )}

              {placed.map((p, i) => (
                <Block
                  key={`${p.kind}-${p.id}`}
                  item={p}
                  index={i}
                  top={y(Math.max(p.start, fromHour * 60))}
                  height={Math.max(
                    ((Math.min(p.end, toHour * 60) - Math.max(p.start, fromHour * 60)) / 60) *
                      hourHeight,
                    18,
                  )}
                  compact={compact}
                  onJob={onJob}
                />
              ))}

              {isToday && nowMinute >= fromHour * 60 && nowMinute <= toHour * 60 && (
                <div
                  className="pointer-events-none absolute inset-x-0 z-20 flex items-center"
                  style={{ top: y(nowMinute) }}
                  aria-label={`Now, ${clock(nowMinute)}`}
                >
                  <span className="-ml-[5px] h-2.5 w-2.5 rounded-full bg-[oklch(0.65_0.22_25)] ring-2 ring-[var(--background)]" />
                  <span className="h-[2px] flex-1 bg-[oklch(0.65_0.22_25)]" />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Block({
  item,
  index,
  top,
  height,
  compact,
  onJob,
}: {
  item: Placed;
  index: number;
  top: number;
  height: number;
  compact: boolean;
  onJob: (job: Job) => void;
}) {
  const style: CSSProperties = {
    top: top + 1,
    height: height - 2,
    left: `calc(${(item.lane / item.lanes) * 100}% + 3px)`,
    width: `calc(${100 / item.lanes}% - 6px)`,
  };
  const anim = {
    initial: { opacity: 0, y: 6 },
    animate: { opacity: 1, y: 0, transition: { delay: Math.min(index * 0.04, 0.3) } },
  };
  // How much room there is decides how much is said.
  const tiny = height < 40;
  const short = height < 76 || compact;

  if (item.kind === "job") {
    const job = item.job;
    const color = jobColor(job);
    const done = job.status === "completed";
    const where = job.location === "mobile" ? job.address || "Mobile" : "Drop-off";
    const name = job.client?.name ?? "Client";

    return (
      <motion.button
        type="button"
        {...anim}
        whileHover={{ scale: 1.012 }}
        whileTap={{ scale: 0.985 }}
        onClick={() => onJob(job)}
        className="cal-job group absolute z-10 overflow-hidden rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-primary"
        style={{ ...style, "--c": color } as CSSProperties}
        title={`${range(item.start, item.end)} · ${name} · ${job.serviceTitle}`}
      >
        <div className={`flex h-full flex-col ${tiny ? "justify-center px-2" : compact ? "px-2 py-1.5" : "px-3 py-2.5"}`}>
          {tiny ? (
            <p className="truncate text-[11px] font-semibold text-foreground">
              <span className="tnum cal-ink">{clock(item.start)}</span> {name}
            </p>
          ) : (
            <>
              <p className="tnum cal-ink flex items-center gap-1 truncate text-[10.5px] font-semibold sm:text-[11px]">
                {done && <CheckCircle2 className="h-3 w-3 shrink-0" />}
                {range(item.start, item.end)}
              </p>
              <p
                className={`mt-0.5 truncate font-bold tracking-tight text-foreground ${compact ? "text-[12px]" : "text-[14px] sm:text-[15px]"}`}
              >
                {name}
              </p>
              {!short && (
                <>
                  <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
                    {job.serviceTitle}
                    {job.addOnTitles?.length ? ` + ${job.addOnTitles.length} add-on${job.addOnTitles.length === 1 ? "" : "s"}` : ""}
                    {vehicleLine(job) ? ` · ${vehicleLine(job)}` : ""}
                  </p>
                  <div className="mt-auto flex items-end justify-between gap-2 pt-1.5">
                    <p className="flex min-w-0 items-center gap-1 truncate text-[11.5px] text-muted-foreground">
                      {job.location === "mobile" ? (
                        <MapPin className="h-3 w-3 shrink-0" />
                      ) : (
                        <Store className="h-3 w-3 shrink-0" />
                      )}
                      <span className="truncate">{where}</span>
                    </p>
                    <span className="tnum shrink-0 text-[12.5px] font-bold text-foreground">
                      {money((job.totalPrice ?? 0) - (job.discount ?? 0))}
                    </span>
                  </div>
                </>
              )}
              {short && !compact && (
                <p className="truncate text-[11.5px] text-muted-foreground">{job.serviceTitle}</p>
              )}
            </>
          )}
        </div>
      </motion.button>
    );
  }

  if (item.kind === "event") {
    const e = item.event;
    const Tag = e.htmlLink ? motion.a : motion.div;
    return (
      <Tag
        {...anim}
        {...(e.htmlLink ? { href: e.htmlLink, target: "_blank", rel: "noreferrer" } : {})}
        className={`cal-event absolute z-[5] overflow-hidden rounded-xl ${e.free ? "opacity-60" : ""}`}
        style={style}
        title={`${range(item.start, item.end)} · ${e.summary}${e.free ? " (free — still bookable)" : ""}`}
      >
        <div className={`flex h-full flex-col ${tiny ? "justify-center px-2" : "px-2.5 py-1.5"}`}>
          <p className="flex items-center gap-1 truncate text-[11.5px] font-semibold text-foreground/85">
            <span className="truncate">{e.summary}</span>
            {!tiny && e.htmlLink && <ExternalLink className="h-3 w-3 shrink-0 opacity-50" />}
          </p>
          {!tiny && (
            <p className="tnum truncate text-[10.5px] text-muted-foreground">
              {range(item.start, item.end)} · Google
            </p>
          )}
        </div>
      </Tag>
    );
  }

  return (
    <motion.div
      {...anim}
      // Above the jobs but see-through and click-through: a lunch break over
      // a long job stays visible as a clash without hiding the job's details.
      className="cal-off cal-off-overlay pointer-events-none absolute z-[15] flex justify-end overflow-hidden rounded-xl"
      style={style}
      title={item.off.reason || "Time off"}
    >
      <p className="cal-off-tag cal-off-ink m-1 flex h-fit items-center gap-1 truncate rounded-lg px-2 py-1 text-[11px] font-semibold">
        <Ban className="h-3 w-3 shrink-0" />
        {item.off.reason || "Time off"}
      </p>
    </motion.div>
  );
}

/** Whole-day entries (days off, all-day Google events) above the grid. */
export function AllDayChips({ items, compact = false }: { items: AllDayItem[]; compact?: boolean }) {
  if (!items.length) return null;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      {items.map((it) =>
        it.kind === "off" ? (
          <span
            key={it.id}
            className={`cal-off flex items-center gap-1 truncate rounded-lg font-semibold cal-off-ink ${compact ? "px-1.5 py-0.5 text-[10.5px]" : "px-2.5 py-1.5 text-[12px]"}`}
          >
            <Ban className="h-3 w-3 shrink-0" />
            <span className="truncate">{it.off.reason || "Day off"}</span>
          </span>
        ) : (
          <a
            key={it.id}
            href={it.event.htmlLink}
            target="_blank"
            rel="noreferrer"
            className={`cal-event truncate rounded-lg font-semibold text-foreground/85 ${compact ? "px-1.5 py-0.5 text-[10.5px]" : "px-2.5 py-1.5 text-[12px]"}`}
            title={`${it.event.summary} — all day, blocks booking`}
          >
            {it.event.summary}
          </a>
        ),
      )}
    </div>
  );
}
