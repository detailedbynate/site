import { useRef, useState } from "react";
import { motion } from "motion/react";

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

  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-50px" }}
      transition={{ duration: 0.7 }}
      ref={containerRef}
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
      className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl border border-border bg-card select-none cursor-ew-resize group"
    >
      <img
        src={after}
        alt="After detailing"
        loading="lazy"
        className="absolute inset-0 w-full h-full object-cover pointer-events-none"
      />
      <div
        className="absolute inset-0 overflow-hidden pointer-events-none"
        style={{ width: `${pos}%` }}
      >
        <img
          src={before}
          alt="Before detailing"
          loading="lazy"
          className="absolute inset-0 w-full h-full object-cover"
          style={{ width: `${(100 / pos) * 100}%`, maxWidth: "none" }}
        />
      </div>

      <span className="absolute top-3 left-3 px-2.5 py-1 rounded-full bg-background/70 backdrop-blur text-[10px] uppercase tracking-widest font-semibold text-foreground">
        Before
      </span>
      <span className="absolute top-3 right-3 px-2.5 py-1 rounded-full bg-primary/90 text-primary-foreground text-[10px] uppercase tracking-widest font-semibold shadow-[0_0_15px_var(--primary)]">
        After
      </span>
      {label && (
        <span className="absolute bottom-3 left-3 px-2.5 py-1 rounded-full bg-background/70 backdrop-blur text-xs font-medium text-foreground">
          {label}
        </span>
      )}

      <div
        className="absolute top-0 bottom-0 w-0.5 bg-primary shadow-[0_0_20px_var(--primary)] pointer-events-none"
        style={{ left: `${pos}%`, transform: "translateX(-50%)" }}
      >
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-[0_0_25px_var(--primary)] text-xs font-bold">
          ⇆
        </div>
      </div>
    </motion.div>
  );
}
