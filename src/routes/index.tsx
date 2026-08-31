import { createFileRoute, Link } from "@tanstack/react-router";
import { motion, useInView, useMotionValue, useTransform, animate } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Sparkles, Star, ChevronDown, Calendar, Phone, MapPin, Mail, ArrowRight, ArrowUpRight } from "lucide-react";
import heroCar from "@/assets/hero-car.jpg";
import serviceDiamond from "@/assets/service-diamond.jpg";
import serviceGold from "@/assets/service-gold.jpg";
import serviceSilver from "@/assets/service-silver.jpg";
import before1 from "@/assets/before-1.jpg";
import after1 from "@/assets/after-1.jpg";
import before2 from "@/assets/before-2.jpg";
import after2 from "@/assets/after-2.jpg";
import { BeforeAfter } from "@/components/BeforeAfter";
import { useBookingModal } from "@/components/booking/BookingModal";
import type { ServiceId } from "@/lib/services";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Detailed by Nate — Premium Auto Detailing" },
      { name: "description", content: "Hand-detailed perfection. Ceramic coating, paint correction, full interior. Book your slot today." },
    ],
  }),
  component: Index,
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

const services = [
  {
    tier: "01",
    image: serviceDiamond,
    title: "Diamond",
    subtitle: "Interior & Exterior",
    price: "From $399",
    desc: "The full obsession. Two-bucket exterior decon wash, clay bar and seal, plus a complete interior reset — steam, leather conditioning, and every vent detailed.",
    features: ["Full exterior decon + wax", "Complete interior deep clean", "Tire & trim dressing", "Glass + jambs"],
    popular: true,
  },
  {
    tier: "02",
    image: serviceGold,
    title: "Gold",
    subtitle: "Interior",
    price: "From $199",
    desc: "Cabin restored to factory-fresh. Steam extraction on carpets and seats, leather conditioned, every crevice, vent and stitch line touched by hand.",
    features: ["Steam extraction", "Leather condition", "Vents + crevices", "Glass interior"],
    popular: false,
  },
  {
    tier: "03",
    image: serviceSilver,
    title: "Silver",
    subtitle: "Exterior",
    price: "From $149",
    desc: "A proper hand wash that protects your paint. Foam pre-soak, two-bucket method, wheels degreased, and a sealant for that deep wet shine.",
    features: ["Foam pre-soak", "Two-bucket hand wash", "Wheels + tires", "Spray sealant"],
    popular: false,
  },
];

const reviews = [
  { name: "Marcus T.", car: "BMW M4 Competition", rating: 5, text: "Nate transformed my M4. Paint correction was flawless — looks better than the day I drove it off the lot. Genuine craftsman." },
  { name: "Sofia R.", car: "Tesla Model 3", rating: 5, text: "Booked the ceramic coating package. Water beads off like magic and the interior smells brand new. Worth every dollar." },
  { name: "Devon K.", car: "Ford F-150 Raptor", rating: 5, text: "Truck was a mud-caked disaster after a weekend in Moab. Came back showroom clean inside and out. Insane attention to detail." },
  { name: "Aisha P.", car: "Porsche 911 Carrera", rating: 5, text: "I'm picky about who touches my 911. Nate is the only detailer I trust now. Hand wash, no swirl marks, perfect every visit." },
  { name: "Jordan L.", car: "Audi RS5", rating: 5, text: "On-time, professional, and the results speak for themselves. The deep interior clean pulled stains I thought were permanent." },
  { name: "Riley M.", car: "Jeep Wrangler", rating: 5, text: "Got the full detail before selling — sold it for $2k over asking. Buyers couldn't believe the condition. Thanks Nate." },
];

const faqs = [
  { q: "How long does a full detail take?", a: "A standard full detail runs 3–5 hours depending on vehicle size and condition. Ceramic coatings require an additional cure day." },
  { q: "Do you come to me?", a: "Yes — mobile service is available throughout the metro area. I bring water, power, and every product needed." },
  { q: "What's included in the ceramic coating package?", a: "Full decontamination wash, clay bar, single-stage paint correction, panel wipe, and a professional 9H ceramic coating with warranty." },
  { q: "How should I prepare my vehicle?", a: "Just remove personal belongings. I handle everything else — from cup-holder gunk to dog hair embedded in the seats." },
  { q: "Do you offer maintenance packages?", a: "Absolutely. Monthly and bi-weekly maintenance plans keep your finish protected and save you money long-term." },
];

function Index() {
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const booking = useBookingModal();

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
          <a href="#top" className="font-display font-bold text-lg tracking-tight">
            Detailed <span className="text-primary glow-text">by Nate</span>
          </a>
          <div className="hidden md:flex items-center gap-8 text-sm text-muted-foreground">
            <a href="#services" className="hover:text-primary transition-colors">Services</a>
            <Link to="/results" className="hover:text-primary transition-colors">Results</Link>
            <Link to="/book" className="hover:text-primary transition-colors">Book</Link>
            <a href="#faq" className="hover:text-primary transition-colors">FAQ</a>
          </div>
          <button
            type="button"
            onClick={() => booking.open()}
            className="px-5 py-2 rounded-full bg-primary text-primary-foreground text-sm font-semibold hover:scale-105 transition-transform animate-pulse-glow"
          >
            Book Now
          </button>
        </div>
      </motion.nav>

      {/* Hero */}
      <section id="top" className="relative min-h-screen flex items-center pt-24 pb-16">
        <div className="absolute inset-0 -z-10">
          <motion.img
            src={heroCar}
            alt="Freshly detailed glossy black sports car under studio lighting"
            width={1920}
            height={1080}
            initial={{ scale: 1.1, opacity: 0 }}
            animate={{ scale: 1, opacity: 0.55 }}
            transition={{ duration: 1.6, ease: "easeOut" }}
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-background/60 via-background/40 to-background" />
        </div>

        <div className="max-w-7xl mx-auto px-6 w-full">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.3 }}
            className="mx-auto max-w-5xl text-center"
          >
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full glass mb-8 text-xs tracking-wide text-foreground/90">
              <span className="w-1.5 h-1.5 rounded-full bg-primary shadow-[0_0_10px_var(--primary)]" />
              Now booking — Summer detail season
            </div>
            <h1 className="font-helvetica font-bold tracking-[-0.04em] leading-[0.92] text-[clamp(3rem,9vw,8.5rem)] mb-8">
              <span className="block text-foreground">Make your car</span>
              <span className="block text-primary glow-text">look untouchable.</span>
            </h1>
            <p className="text-base md:text-xl text-muted-foreground max-w-2xl mx-auto mb-10">
              Concours-grade paint correction, ceramic coatings and interior restoration — done in-studio with obsessive attention to every reflection.
            </p>
            <div className="flex flex-wrap gap-3 justify-center">
              <motion.button
                type="button"
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.97 }}
                onClick={() => booking.open()}
                className="btn-liquid inline-flex items-center gap-2 px-8 py-4 rounded-full bg-gradient-to-r from-primary to-primary-glow text-primary-foreground font-semibold shadow-[0_10px_40px_-10px_var(--primary)]"
              >
                Book Now <ArrowRight className="w-4 h-4" />
              </motion.button>
              <motion.a
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.97 }}
                href="#services"
                className="liquid-glass inline-flex items-center gap-2 px-8 py-4 rounded-full text-foreground font-semibold hover:border-primary/50 transition-colors"
              >
                See services
              </motion.a>
            </div>

            {/* Stat pills */}
            <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
              {[
                { value: 150, suffix: "+", label: "clients served" },
                { value: 5, suffix: ".0", label: "star rating", stars: true },
                { value: 1200, suffix: "+", label: "vehicles detailed" },
              ].map((s, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 14, filter: "blur(6px)" }}
                  animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                  transition={{ duration: 0.6, delay: 0.7 + i * 0.12 }}
                  whileHover={{ y: -3, scale: 1.04 }}
                  className="liquid-glass rounded-full px-5 py-2.5 flex items-center gap-2.5"
                >
                  <span className="text-lg font-bold text-primary glow-text">
                    <Counter to={s.value} suffix={s.suffix} />
                  </span>
                  {s.stars && (
                    <span className="flex gap-0.5">
                      {[...Array(5)].map((_, j) => (
                        <Star key={j} className="w-3 h-3 fill-primary text-primary" />
                      ))}
                    </span>
                  )}
                  <span className="text-xs uppercase tracking-widest text-muted-foreground">{s.label}</span>
                </motion.div>
              ))}
              <motion.div
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 1.06 }}
                whileHover={{ y: -3, scale: 1.04 }}
                className="liquid-glass rounded-full px-5 py-2.5 text-[11px] tracking-[0.2em] uppercase text-muted-foreground"
              >
                No deposit required · Mobile & in-studio
              </motion.div>
            </div>

          </motion.div>
        </div>

        <motion.div
          animate={{ y: [0, 10, 0] }}
          transition={{ duration: 2, repeat: Infinity }}
          className="absolute bottom-8 left-1/2 -translate-x-1/2 text-muted-foreground"
        >
          <ChevronDown className="w-6 h-6" />
        </motion.div>
      </section>

      {/* Ambient aurora */}
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="animate-aurora absolute top-1/4 -left-40 w-[36rem] h-[36rem] rounded-full bg-primary/10 blur-[140px]" />
        <div className="animate-aurora absolute bottom-0 -right-40 w-[32rem] h-[32rem] rounded-full bg-primary/[0.07] blur-[130px]" style={{ animationDelay: "-6s" }} />
      </div>



      {/* Services */}
      <section id="services" className="py-24 relative">
        <div className="max-w-7xl mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-16"
          >
            <p className="text-primary uppercase tracking-widest text-sm mb-3">Packages</p>
            <h2 className="text-4xl md:text-6xl font-bold tracking-tight">Built for the obsessed.</h2>
          </motion.div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {services.map((s, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 50, filter: "blur(8px)" }}
                whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                viewport={{ once: true, margin: "-50px" }}
                transition={{ duration: 0.7, delay: i * 0.12, ease: [0.16, 1, 0.3, 1] }}
                whileHover={{ y: -10 }}
                className={
                  s.popular
                    ? "group relative rounded-3xl liquid-glass flex flex-col min-h-[640px] shadow-[0_0_50px_-10px_var(--primary)] hover:border-primary/60 transition-colors animate-pulse-glow"
                    : "group relative rounded-3xl liquid-glass flex flex-col min-h-[640px] hover:border-primary/40 transition-colors"
                }
              >
                {s.popular && (
                  <div className="absolute top-4 right-4 z-10 px-3 py-1 rounded-full bg-gradient-to-r from-primary to-primary-glow text-primary-foreground text-[10px] font-bold uppercase tracking-widest shadow-[0_0_20px_var(--primary)]">
                    Most Popular
                  </div>
                )}
                <div className="relative h-[340px] overflow-hidden">
                  <img
                    src={s.image}
                    alt={`${s.title} detailing package`}
                    loading="lazy"
                    width={1024}
                    height={1024}
                    className="w-full h-full object-cover transition-transform duration-[900ms] ease-out group-hover:scale-110"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-card via-card/25 to-transparent" />
                  <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 bg-gradient-to-tr from-primary/20 via-transparent to-transparent" />
                  <span className="absolute top-4 left-4 font-mono text-xs text-primary tracking-wider">{s.tier}</span>
                </div>
                <div className="flex flex-col flex-1 p-8">
                  <div className="flex items-baseline justify-between gap-4 mb-1">
                    <h3 className="text-2xl font-bold tracking-tight">{s.title}</h3>
                    <span className="font-mono text-xs text-muted-foreground whitespace-nowrap">{s.price}</span>
                  </div>
                  <p className="text-sm text-primary/80 uppercase tracking-widest mb-5">{s.subtitle}</p>
                  <p className="text-muted-foreground leading-relaxed mb-6">{s.desc}</p>
                  <ul className="space-y-2 mb-8">
                    {s.features.map((f) => (
                      <li key={f} className="flex items-center gap-2 text-sm text-foreground/80">
                        <span className="w-1 h-1 rounded-full bg-primary shadow-[0_0_8px_var(--primary)]" />
                        {f}
                      </li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    onClick={() => booking.open(s.title.toLowerCase() as ServiceId)}
                    className="btn-liquid mt-auto w-full inline-flex items-center justify-center gap-2 px-6 py-4 rounded-2xl bg-gradient-to-r from-primary to-primary-glow text-primary-foreground font-semibold text-sm shadow-[0_10px_30px_-10px_var(--primary)] hover:shadow-[0_16px_44px_-10px_var(--primary)]"
                  >
                    Book {s.title} <ArrowUpRight className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                  </button>
                </div>
              </motion.div>

            ))}
          </div>
        </div>
      </section>

      {/* Reviews */}
      <section id="reviews" className="py-24 relative">
        <div className="max-w-7xl mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-16"
          >
            <p className="text-primary uppercase tracking-widest text-sm mb-3">Loved by Drivers</p>
            <h2 className="text-4xl md:text-6xl font-bold mb-4">5 stars, every time.</h2>
            <div className="flex justify-center gap-1">
              {[...Array(5)].map((_, i) => (
                <Star key={i} className="w-6 h-6 fill-primary text-primary" />
              ))}
            </div>
          </motion.div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {reviews.map((r, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 48, rotateX: 8, filter: "blur(8px)" }}
                whileInView={{ opacity: 1, y: 0, rotateX: 0, filter: "blur(0px)" }}
                viewport={{ once: true, margin: "-50px" }}
                transition={{ duration: 0.7, delay: (i % 3) * 0.14, ease: [0.16, 1, 0.3, 1] }}
                whileHover={{ y: -10, scale: 1.02, transition: { type: "spring", stiffness: 260, damping: 18 } }}
                className="group liquid-glass rounded-3xl p-7 relative hover:border-primary/45 transition-colors"
              >
                <div className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 bg-gradient-to-br from-primary/12 via-transparent to-transparent" />
                <div className="relative">
                  <div className="flex gap-0.5 mb-4">
                    {[...Array(r.rating)].map((_, j) => (
                      <motion.div
                        key={j}
                        initial={{ opacity: 0, scale: 0, rotate: -30 }}
                        whileInView={{ opacity: 1, scale: 1, rotate: 0 }}
                        viewport={{ once: true }}
                        transition={{ delay: 0.25 + j * 0.07, type: "spring", stiffness: 300, damping: 14 }}
                      >
                        <Star className="w-4 h-4 fill-primary text-primary drop-shadow-[0_0_6px_var(--primary)]" />
                      </motion.div>
                    ))}
                  </div>
                  <p className="text-foreground/90 leading-relaxed mb-5">"{r.text}"</p>
                  <div className="pt-4 border-t border-white/10 flex items-center gap-3">
                    <span className="w-9 h-9 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs font-bold">
                      {r.name.split(" ").map((n) => n[0]).join("")}
                    </span>
                    <div>
                      <p className="font-semibold text-sm">{r.name}</p>
                      <p className="text-xs text-muted-foreground">{r.car}</p>
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}

          </div>
        </div>
      </section>

      {/* Book / CTA */}
      <section id="book" className="py-24 relative">
        <div className="max-w-5xl mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            className="liquid-glass rounded-3xl p-10 md:p-16 text-center relative"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-primary/5" />
            <div className="absolute -top-32 left-1/2 -translate-x-1/2 w-96 h-96 bg-primary/20 rounded-full blur-3xl animate-aurora" />
            <div className="relative">
              <h2 className="text-4xl md:text-6xl font-bold mb-4">Ready to look brand new?</h2>
              <p className="text-muted-foreground text-lg mb-8 max-w-xl mx-auto">
                Book a slot in under 60 seconds. I'll confirm same day.
              </p>
              <button
                type="button"
                onClick={() => booking.open()}
                className="btn-liquid inline-flex items-center gap-2 px-8 py-4 rounded-full bg-gradient-to-r from-primary to-primary-glow text-primary-foreground font-semibold text-lg animate-pulse-glow"
              >
                <Calendar className="w-5 h-5" /> Book Now
              </button>

              <div className="mt-10 flex flex-wrap justify-center gap-x-8 gap-y-3 text-sm text-muted-foreground">
                <span className="inline-flex items-center gap-2"><Phone className="w-4 h-4 text-primary" /> (555) 123-4567</span>
                <span className="inline-flex items-center gap-2"><Mail className="w-4 h-4 text-primary" /> book@detailedbynate.com</span>
                <span className="inline-flex items-center gap-2"><MapPin className="w-4 h-4 text-primary" /> Sault Ste. Marie area</span>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Before & After preview */}
      <section id="results" className="py-24 relative">
        <div className="max-w-7xl mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="flex flex-col md:flex-row md:items-end md:justify-between gap-6 mb-12"
          >
            <div>
              <p className="text-primary uppercase tracking-widest text-sm mb-3">Before · After</p>
              <h2 className="text-4xl md:text-6xl font-bold tracking-tight">Drag. See the difference.</h2>
            </div>
            <Link
              to="/results"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full border border-border hover:border-primary/60 transition-colors text-sm font-semibold whitespace-nowrap"
            >
              See full gallery <ArrowUpRight className="w-4 h-4" />
            </Link>
          </motion.div>

          <div className="grid md:grid-cols-2 gap-6">
            <BeforeAfter before={before1} after={after1} label="Paint correction" />
            <BeforeAfter before={before2} after={after2} label="Interior reset" />
          </div>
        </div>
      </section>


      {/* FAQ */}
      <section id="faq" className="py-24 relative">
        <div className="max-w-3xl mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-12"
          >
            <p className="text-primary uppercase tracking-widest text-sm mb-3">FAQ</p>
            <h2 className="text-4xl md:text-5xl font-bold">Common questions.</h2>
          </motion.div>

          <div className="space-y-3">
            {faqs.map((f, i) => {
              const open = openFaq === i;
              return (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 10 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.05 }}
                  className="glass rounded-xl overflow-hidden"
                >
                  <button
                    onClick={() => setOpenFaq(open ? null : i)}
                    className="w-full px-6 py-5 flex items-center justify-between text-left hover:bg-primary/5 transition-colors"
                  >
                    <span className="font-semibold pr-4">{f.q}</span>
                    <motion.span animate={{ rotate: open ? 180 : 0 }} className="text-primary shrink-0">
                      <ChevronDown className="w-5 h-5" />
                    </motion.span>
                  </button>
                  <motion.div
                    initial={false}
                    animate={{ height: open ? "auto" : 0, opacity: open ? 1 : 0 }}
                    transition={{ duration: 0.3 }}
                    className="overflow-hidden"
                  >
                    <p className="px-6 pb-5 text-muted-foreground leading-relaxed">{f.a}</p>
                  </motion.div>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-10 mt-10">
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
          <p>© {new Date().getFullYear()} Detailed by Nate. All rights reserved.</p>
          <p>Crafted with obsession in the metro area.</p>
        </div>
      </footer>
    </div>
  );
}
