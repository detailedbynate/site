import { motion } from "motion/react";
import { Car, User } from "lucide-react";
import { VEHICLE_COLORS } from "@/lib/services";

export type CustomerInfo = {
  name: string;
  phone: string;
  email: string;
  make: string;
  model: string;
  year: string;
  color: string;
  notes: string;
};

export const emptyCustomer: CustomerInfo = {
  name: "",
  phone: "",
  email: "",
  make: "",
  model: "",
  year: "",
  color: "",
  notes: "",
};

export type CustomerErrors = Partial<Record<keyof CustomerInfo, string>>;

export function validateCustomer(c: CustomerInfo): CustomerErrors {
  const e: CustomerErrors = {};
  if (c.name.trim().length < 2) e.name = "Enter your full name";
  else if (c.name.trim().length > 80) e.name = "Name is too long";
  const digits = c.phone.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) e.phone = "Enter a valid phone number";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(c.email.trim()) || c.email.length > 255)
    e.email = "Enter a valid email";
  if (c.make.trim().length < 2) e.make = "Required";
  if (c.model.trim().length < 1) e.model = "Required";
  const yr = Number(c.year);
  if (!/^\d{4}$/.test(c.year) || yr < 1950 || yr > new Date().getFullYear() + 2)
    e.year = "Enter a valid year";
  if (!c.color) e.color = "Required";
  if (c.notes.length > 500) e.notes = "Keep notes under 500 characters";
  return e;
}

const inputCls =
  "mt-1 w-full rounded-2xl border border-border bg-card px-4 py-2.5 text-sm text-foreground sm:mt-1.5 sm:py-3 outline-none transition placeholder:text-muted-foreground/60 focus:border-primary focus:ring-4 focus:ring-primary/15";

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {children}
      {error && (
        <motion.span
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-1 block text-[11px] font-semibold text-destructive"
        >
          {error}
        </motion.span>
      )}
    </label>
  );
}

type Props = {
  value: CustomerInfo;
  errors: CustomerErrors;
  onChange: (patch: Partial<CustomerInfo>) => void;
};

export function CustomerInfoStep({ value, errors, onChange }: Props) {
  return (
    <div className="grid gap-3.5 sm:gap-5">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass rounded-3xl p-4 sm:p-5"
      >
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary">
          <User className="h-3.5 w-3.5" /> Contact
        </p>
        <div className="mt-3 grid gap-3 sm:mt-4 sm:gap-4 sm:grid-cols-3">
          <Field label="Full name" error={errors.name}>
            <input
              className={inputCls}
              maxLength={80}
              autoComplete="name"
              value={value.name}
              onChange={(e) => onChange({ name: e.target.value })}
              placeholder="Alex Carter"
            />
          </Field>
          <Field label="Phone" error={errors.phone}>
            <input
              className={inputCls}
              maxLength={20}
              inputMode="tel"
              autoComplete="tel"
              value={value.phone}
              onChange={(e) => onChange({ phone: e.target.value })}
              placeholder="(705) 555-0142"
            />
          </Field>
          <Field label="Email" error={errors.email}>
            <input
              className={inputCls}
              maxLength={255}
              inputMode="email"
              autoComplete="email"
              value={value.email}
              onChange={(e) => onChange({ email: e.target.value })}
              placeholder="alex@email.com"
            />
          </Field>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0, transition: { delay: 0.06 } }}
        className="glass rounded-3xl p-4 sm:p-5"
      >
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary">
          <Car className="h-3.5 w-3.5" /> Vehicle
        </p>
        <div className="mt-3 grid gap-3 sm:mt-4 sm:gap-4 sm:grid-cols-4">
          <Field label="Make" error={errors.make}>
            <input
              className={inputCls}
              maxLength={40}
              value={value.make}
              onChange={(e) => onChange({ make: e.target.value })}
              placeholder="BMW"
            />
          </Field>
          <Field label="Model" error={errors.model}>
            <input
              className={inputCls}
              maxLength={40}
              value={value.model}
              onChange={(e) => onChange({ model: e.target.value })}
              placeholder="M340i"
            />
          </Field>
          <Field label="Year" error={errors.year}>
            <input
              className={inputCls}
              maxLength={4}
              inputMode="numeric"
              value={value.year}
              onChange={(e) => onChange({ year: e.target.value.replace(/\D/g, "") })}
              placeholder="2021"
            />
          </Field>
          <Field label="Color" error={errors.color}>
            <select
              className={inputCls}
              value={value.color}
              onChange={(e) => onChange({ color: e.target.value })}
            >
              <option value="">Select…</option>
              {VEHICLE_COLORS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="mt-4">
          <Field label="Notes (optional)" error={errors.notes}>
            <textarea
              className={`${inputCls} min-h-[88px] resize-y`}
              maxLength={500}
              value={value.notes}
              onChange={(e) => onChange({ notes: e.target.value })}
              placeholder="Gate code, pet hair, heavy brake dust…"
            />
          </Field>
        </div>
      </motion.div>
    </div>
  );
}
