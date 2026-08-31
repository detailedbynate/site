import { createFileRoute, Link } from "@tanstack/react-router";
import { motion, useInView, useMotionValue, useTransform, animate } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Sparkles, Star, ShieldCheck, Clock, MapPin } from "lucide-react";
import { BeforeAfter } from "@/components/BeforeAfter";
import before1 from "@/assets/before-1.jpg";
import after1 from "@/assets/after-1.jpg";
import before2 from "@/assets/before-2.jpg";
import after2 from "@/assets/after-2.jpg";
import before3 from "@/assets/before-3.jpg";
import after3 from "@/assets/after-3.jpg";

export const Route = createFileRoute("/results")({
  head: () => ({
    meta: [
      { title: "Results — Detailed by Nate | Before & After Gallery" },
      { name: "description", content: "Real before-and-after detailing results from Detailed by Nate, serving the Sault Ste. Marie area." },
      { property: "og:title", content: "Results — Detailed by Nate" },
      { property: "og:description", content: "Before-and-after detailing results from the Sault Ste. Marie area." },
    ],
  }),
  component: ResultsPage,
});

function Counter({ to, suffix = "" }: { to: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-50px" });
  const count = useMotionValue(0);
  const rounded = useTransform(count, (v) => Math.floor(v).toLocaleString());
  const [display, setDisplay] = useState("0");

  useEffect(() => {
    if (!inView) return;
    const controls = animate(count, to, { duration: 2.2, ease: [0.16, 1, 0.3, 1] });
    const unsub = rounded.on("change", setDisplay);
    return () => { controls.stop(); unsub(); };
  }, [inView, to, count, rounded]);

  return <span ref={ref}>{display}{suffix}</span>;
}

const results = [
  {
    label: "Paint correction",
    detail: "Black sedan hood",
    before: before1,
    after: after1,
    desc: "Swirl-marked, oxidized factory black paint brought back to a wet, mirror-deep gloss with a two-stage polish and ceramic seal.",
    package: "Diamond",
  },
  {
    label: "Interior reset",
    detail: "Tan leather cabin",
    before: before2,
    after: after2,
    desc: "Stained leather seats, dusty dash, and grimy cupholders steam-cleaned, conditioned, and protected. Smells like new again.",
    package: "Gold",
  },
  {
    label: "Wheel & tire deep clean",
    detail: "Off-road SUV",
    before: before3,
    after: after3,
    desc: "Caked-on brake dust and trail mud removed without damaging the finish. Tires dressed for a clean satin shine.",
    package: "Silver",
  },
];

function ResultsPage() {
  return (
    <div className="min-h-screen overflow-x-hidden">
      {/* Nav */}
      <motion.nav
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.6 }}
        className="fixed top-0 left-0 right-0 z-50 glass"
      >
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link to="/" className="font-display font-bold text-lg tracking-tight">
            Detailed <span className="text-primary glow-text">by Nate</span>
          </Link>
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full border border-border hover:border-primary/60 transition-colors text-sm font-semibold"
          >
            <ArrowLeft className="w-4 h-4" /> Back home
          </Link>
        </div>
      </motion.nav>

      {/* Hero */}
      <section className="relative min-h-[75vh] flex items-center pt-32 pb-20">
        <div className="absolute inset-0 -z-10 overflow-hidden">
          <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[800px] h-[800px] bg-primary/10 rounded-full blur-[120px]" />
          <div className="absolute top-1/2 right-0 w-[500px] h-[500px] bg-primary/5 rounded-full blur-[100px]" />
        </div>

        <div className="max-w-7xl mx-auto px-6 w-full">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.2 }}
            className="max-w-4xl mx-auto text-center"
          >
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full glass mb-8 text-xs tracking-wide">
              <Sparkles className="w-3.5 h-3.5 text-primary" />
              Real client transformations
            </div>
            <h1 className="font-helvetica font-bold tracking-[-0.04em] leading-[0.95] text-[clamp(2.75rem,7vw,6.5rem)] mb-6">
              <span className="block text-foreground">The receipts.</span>
              <span className="block text-primary glow-text">See the proof.</span>
            </h1>
            <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-12">
              Every car below is a real job from the Sault Ste. Marie area. Drag the divider to see the transformation.
            </p>

            {/* Quick stats */}
            <div className="grid grid-cols-3 gap-4 max-w-lg mx-auto">
              {[
                { value: 150, suffix: "+", label: "Cars done" },
                { value: 5, suffix: ".0", label: "Avg rating" },
                { value: 100, suffix: "%", label: "Real results" },
              ].map((s, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.5 + i * 0.1 }}
                  className="glass rounded-xl p-4 text-center"
                >
                  <div className="text-2xl md:text-3xl font-bold text-primary glow-text">
                    <Counter to={s.value} suffix={s.suffix} />
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{s.label}</p>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </div>
      </section>

      {/* Gallery */}
      <section className="pb-24 px-6">
        <div className="max-w-6xl mx-auto space-y-28">
          {results.map((r, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 50 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ duration: 0.7 }}
              className={`grid lg:grid-cols-5 gap-10 items-center ${i % 2 === 1 ? "lg:[&>div:first-child]:order-2" : ""}`}
            >
              <div className="lg:col-span-3">
                <div className="relative group">
                  <BeforeAfter before={r.before} after={r.after} label={r.label} />
                  <div className="absolute -inset-1 rounded-2xl bg-gradient-to-br from-primary/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 -z-10 blur-sm" />
                </div>
              </div>
              <div className="lg:col-span-2 space-y-5">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-xs text-primary tracking-wider">0{i + 1}</span>
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-primary/30 text-primary text-[10px] uppercase tracking-widest font-semibold">
                    <ShieldCheck className="w-3 h-3" /> {r.package}
                  </span>
                </div>
                <h2 className="text-3xl md:text-4xl font-bold tracking-tight">
                  {r.label}
                  <span className="block text-muted-foreground text-xl md:text-2xl mt-1 font-normal">{r.detail}</span>
                </h2>
                <p className="text-muted-foreground leading-relaxed text-base md:text-lg">{r.desc}</p>

                <div className="flex flex-wrap gap-4 pt-2">
                  <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Clock className="w-3.5 h-3.5 text-primary" /> 3-5 hours
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                    <MapPin className="w-3.5 h-3.5 text-primary" /> Sault Ste. Marie area
                  </span>
                </div>

                <Link
                  to="/book"
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-foreground text-background font-semibold text-sm hover:scale-[1.02] active:scale-[0.98] transition-all shadow-lg"
                >
                  Book this package <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Trust bar */}
      <section className="py-20 px-6 relative">
        <div className="absolute inset-0 -z-10 overflow-hidden">
          <div className="absolute bottom-0 left-0 w-[600px] h-[400px] bg-primary/5 rounded-full blur-[100px]" />
        </div>
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="max-w-5xl mx-auto glass rounded-3xl p-10 md:p-14 text-center"
        >
          <div className="flex justify-center gap-1 mb-5">
            {[...Array(5)].map((_, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, scale: 0 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ delay: 0.3 + i * 0.1, type: "spring" }}
              >
                <Star className="w-7 h-7 fill-primary text-primary" />
              </motion.div>
            ))}
          </div>
          <p className="text-lg md:text-xl text-foreground/90 max-w-2xl mx-auto mb-8">
            "Every single detailer says they are 'detail oriented.' Nate is the only one I've found who truly means it. My car hasn't looked this good since I bought it."
          </p>
          <div className="flex items-center justify-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-sm">MK</div>
            <div className="text-left">
              <p className="font-semibold text-sm">Marcus K.</p>
              <p className="text-xs text-muted-foreground">BMW M4 Competition</p>
            </div>
          </div>
        </motion.div>
      </section>

      {/* CTA */}
      <section className="pb-24 px-6">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
          className="max-w-4xl mx-auto glass rounded-3xl p-12 md:p-16 text-center relative overflow-hidden"
        >
          <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-primary/5" />
          <div className="absolute -top-32 left-1/2 -translate-x-1/2 w-96 h-96 bg-primary/20 rounded-full blur-3xl" />
          <div className="relative">
            <h2 className="text-3xl md:text-5xl font-bold mb-4 tracking-tight">Ready for your transformation?</h2>
            <p className="text-muted-foreground text-lg mb-8 max-w-xl mx-auto">
              Book a slot in under 60 seconds. Mobile and in-studio service available across the Sault Ste. Marie area.
            </p>
            <Link
              to="/book"
              className="inline-flex items-center gap-2 px-8 py-4 rounded-full bg-gradient-to-r from-primary to-primary-glow text-primary-foreground font-semibold text-lg animate-pulse-glow hover:scale-[1.03] active:scale-[0.97] transition-all"
            >
              Book now <ArrowRight className="w-5 h-5" />
            </Link>
            <p className="mt-6 text-sm text-muted-foreground">No deposit required · Same-day confirmation</p>
          </div>
        </motion.div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-10">
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
          <p>© {new Date().getFullYear()} Detailed by Nate. All rights reserved.</p>
          <p>Sault Ste. Marie area</p>
        </div>
      </footer>
    </div>
  );
}
