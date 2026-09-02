import { createFileRoute, Link } from "@tanstack/react-router";
import { motion } from "motion/react";
import { ArrowLeft, Phone, Mail, MapPin, Clock, Calendar, CheckCircle2 } from "lucide-react";
import { BookingWizard } from "@/components/booking/BookingWizard";
import { getCatalog } from "@/lib/api/booking.functions";

export const Route = createFileRoute("/book")({
  loader: async () => {
    try {
      return { business: (await getCatalog()).business };
    } catch {
      return { business: null };
    }
  },
  // Built from the loader, not hardcoded: the business name and service area
  // are editable in Settings, and a title that still said "Detailed by Nate,
  // Sault Ste. Marie" after either changed would be wrong in the one place
  // customers and crawlers actually read.
  head: ({ loaderData }) => {
    const name = loaderData?.business?.name || "Detailed by Nate";
    const area = loaderData?.business?.serviceArea;
    const title = `Book Now — ${name}`;
    const description = `Book your detailing appointment with ${name}.${
      area ? ` Serving ${area}.` : ""
    }`;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
      ],
    };
  },
  component: BookPage,
});

const steps = [
  "Choose your package (Diamond, Gold, or Silver)",
  "Pick a date and time that works for you",
  "Drop off or request mobile service",
  "Drive away showroom-ready",
];

function BookPage() {
  const { business } = Route.useLoaderData();
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
      <section className="relative min-h-[65vh] flex items-center pt-32 pb-16">
        <div className="absolute inset-0 -z-10 overflow-hidden">
          <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[800px] h-[800px] bg-primary/10 rounded-full blur-[120px]" />
          <div className="absolute top-1/2 right-0 w-[500px] h-[500px] bg-primary/5 rounded-full blur-[100px]" />
        </div>

        <div className="max-w-7xl mx-auto px-6 w-full">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.2 }}
            className="max-w-3xl mx-auto text-center"
          >
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full glass mb-8 text-xs tracking-wide">
              <Calendar className="w-3.5 h-3.5 text-primary" />
              Now booking — Summer detail season
            </div>
            <h1 className="font-helvetica font-bold tracking-[-0.04em] leading-[0.95] text-[clamp(2.75rem,7vw,6rem)] mb-6">
              <span className="block text-foreground">Book your</span>
              <span className="block text-primary glow-text">detail today.</span>
            </h1>
            <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-10">
              I use my own booking system to keep everything simple. Tap the button below to choose your package and lock in a time.
            </p>
            <motion.a
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              href="#booking-widget"
              className="inline-flex items-center gap-2 px-10 py-4 rounded-full bg-gradient-to-r from-primary to-primary-glow text-primary-foreground font-semibold text-lg animate-pulse-glow"
            >
              <Calendar className="w-5 h-5" /> Open Booking System
            </motion.a>
            <p className="mt-6 text-sm text-muted-foreground">No deposit required · Same-day confirmation</p>
          </motion.div>
        </div>
      </section>

      {/* Live booking wizard — same component the Book Now modal renders. */}
      <section id="booking-widget" className="pb-24 px-6 scroll-mt-24">
        <div className="max-w-3xl mx-auto">
          <BookingWizard />
        </div>
      </section>

      {/* How it works */}
      <section className="pb-24 px-6">
        <div className="max-w-4xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-14"
          >
            <p className="text-primary uppercase tracking-widest text-sm mb-3">How it works</p>
            <h2 className="text-3xl md:text-5xl font-bold tracking-tight">Four steps to showroom clean.</h2>
          </motion.div>

          <div className="grid sm:grid-cols-2 gap-5">
            {steps.map((step, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className="glass rounded-2xl p-6 flex items-start gap-4"
              >
                <div className="shrink-0 w-10 h-10 rounded-full bg-primary/15 text-primary flex items-center justify-center font-bold text-sm">
                  0{i + 1}
                </div>
                <p className="text-foreground/90 leading-relaxed pt-2">{step}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Contact / Info */}
      <section className="pb-24 px-6">
        <div className="max-w-5xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="glass rounded-3xl p-10 md:p-14 relative overflow-hidden"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-primary/5" />
            <div className="absolute -top-32 left-1/2 -translate-x-1/2 w-96 h-96 bg-primary/20 rounded-full blur-3xl" />
            <div className="relative grid md:grid-cols-2 gap-10 items-center">
              <div>
                <h2 className="text-3xl md:text-4xl font-bold mb-4 tracking-tight">Questions before booking?</h2>
                <p className="text-muted-foreground leading-relaxed mb-6">
                  If you are not sure which package fits your car, shoot me a message. I will recommend the right service and give you an honest timeframe.
                </p>
                <div className="space-y-3">
                  {[
                    { icon: Phone, text: business?.phone ?? "(555) 123-4567" },
                    { icon: Mail, text: business?.email ?? "book@detailedbynate.com" },
                    { icon: MapPin, text: `${business?.serviceArea ?? "Sault Ste. Marie area"} — mobile & in-studio` },
                    { icon: Clock, text: "Mon–Sat, 8am–6pm" },
                  ].map((item, i) => (
                    <div key={i} className="flex items-center gap-3 text-sm text-muted-foreground">
                      <item.icon className="w-4 h-4 text-primary shrink-0" />
                      {item.text}
                    </div>
                  ))}
                </div>
              </div>
              <div className="space-y-4">
                {[
                  "All packages include a pre-detail inspection",
                  `Mobile service available across the ${business?.serviceArea ?? "Sault Ste. Marie area"}`,
                  "Ceramic coatings require a 24-hour cure window",
                  "Gift cards available — ask when booking",
                ].map((item, i) => (
                  <div key={i} className="flex items-start gap-3 text-sm text-foreground/80">
                    <CheckCircle2 className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                    {item}
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* CTA */}
      <section className="pb-24 px-6">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
          className="max-w-3xl mx-auto text-center"
        >
          <h2 className="text-3xl md:text-5xl font-bold mb-4 tracking-tight">Ready when you are.</h2>
          <p className="text-muted-foreground text-lg mb-8 max-w-xl mx-auto">
            Summer slots fill up fast. Lock in your appointment today.
          </p>
          <motion.a
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            href="#booking-widget"
            className="inline-flex items-center gap-2 px-10 py-4 rounded-full bg-foreground text-background font-semibold text-lg hover:scale-[1.02] active:scale-[0.98] transition-all shadow-lg"
          >
            <Calendar className="w-5 h-5" /> Book Now
          </motion.a>
        </motion.div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-10">
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
          <p>© {new Date().getFullYear()} Detailed by Nate. All rights reserved.</p>
          <p>{business?.serviceArea ?? "Sault Ste. Marie area"}</p>
        </div>
      </footer>
    </div>
  );
}
