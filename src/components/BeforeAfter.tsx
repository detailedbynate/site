import { useRef, useState } from "react";
import { ChevronsLeftRight } from "lucide-react";

/**
 * Drag (or arrow-key) comparison of a before and after photo of the same car.
 * Colours fall back to literals so it renders the same outside `.site`.
 */
export function BeforeAfter({
  before,
  after,
  label,
}: {
  before: string;
  after: string;
  label?: string;
}) {
  const [pos, setPos] = useState(50);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const move = (clientX: number) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * 100;
    setPos(Math.max(0, Math.min(100, x)));
  };

  const nudge = (by: number) => setPos((p) => Math.max(0, Math.min(100, p + by)));

  return (
    <div
      ref={containerRef}
      role="slider"
      tabIndex={0}
      aria-label={label ? `Before and after: ${label}` : "Before and after"}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pos)}
      aria-valuetext={`${Math.round(pos)}% showing before`}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          nudge(-5);
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          nudge(5);
        }
      }}
      onMouseDown={(e) => {
        dragging.current = true;
        move(e.clientX);
      }}
      onMouseMove={(e) => dragging.current && move(e.clientX)}
      onMouseUp={() => (dragging.current = false)}
      onMouseLeave={() => (dragging.current = false)}
      onTouchStart={(e) => {
        dragging.current = true;
        move(e.touches[0].clientX);
      }}
      onTouchMove={(e) => dragging.current && move(e.touches[0].clientX)}
      onTouchEnd={() => (dragging.current = false)}
      className="relative aspect-[4/3] w-full cursor-ew-resize select-none overflow-hidden rounded-[12px] border border-[var(--line,#29405f)] bg-[var(--harbour,#152a44)]"
    >
      <img
        src={after}
        alt="After detailing"
        loading="lazy"
        className="pointer-events-none absolute inset-0 h-full w-full object-cover"
      />
      <div
        className="pointer-events-none absolute inset-0 overflow-hidden"
        style={{ width: `${pos}%` }}
      >
        <img
          src={before}
          alt="Before detailing"
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover"
          style={{ width: `${(100 / Math.max(pos, 0.5)) * 100}%`, maxWidth: "none" }}
        />
      </div>

      <span className="absolute left-3 top-3 rounded-[4px] bg-[#0d1b2e]/85 px-2 py-1 text-[13px] font-semibold text-white">
        Before
      </span>
      <span className="absolute right-3 top-3 rounded-[4px] bg-[#dceaf8] px-2 py-1 text-[13px] font-semibold text-[#0d1b2e]">
        After
      </span>
      {label && (
        <span className="absolute bottom-3 left-3 rounded-[4px] bg-[#0d1b2e]/85 px-2 py-1 text-[13px] text-white">
          {label}
        </span>
      )}

      <div
        className="pointer-events-none absolute bottom-0 top-0 w-0.5 bg-white"
        style={{ left: `${pos}%`, transform: "translateX(-50%)" }}
      >
        <div className="absolute left-1/2 top-1/2 flex h-10 w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white bg-[#0d1b2e] text-white">
          <ChevronsLeftRight aria-hidden className="h-4 w-4" />
        </div>
      </div>
    </div>
  );
}
