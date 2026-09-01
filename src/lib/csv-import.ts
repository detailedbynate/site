// CSV parsing for the appointment importer.
//
// Pure and dependency-free on purpose: this is the part most likely to meet
// a file shaped in a way nobody predicted, so it needs to be testable on its
// own against real exports rather than only through the UI.

export const COLUMNS = [
  ["date", "required · YYYY-MM-DD"],
  ["time", "24h, e.g. 14:30 — defaults to 09:00"],
  ["name", "required · customer name"],
  ["email", "matched against existing customers"],
  ["phone", ""],
  ["service", "package name, e.g. Diamond"],
  ["addons", "separated by ; or |"],
  ["location", "mobile or shop"],
  ["address", "for mobile jobs"],
  ["vehicle", "e.g. 2019 Honda Civic"],
  ["total", "what you charged"],
  ["tip", ""],
  ["status", "completed, cancelled or confirmed"],
  ["notes", ""],
] as const;

/** Minimal RFC-4180 parser: handles quoted fields, escaped quotes, CRLF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v.trim()));
}

export const norm = (s: string) => s.trim().toLowerCase().replace(/[^a-z]/g, "");

/** Map whatever the file calls a column onto ours. */
export const ALIASES: Record<string, string> = {
  // Separate date and time columns.
  date: "date",
  jobdate: "date",
  appointmentdate: "date",
  time: "time",
  starttime: "time",
  // A single combined column, e.g. "September 2, 09:30am". Very common in
  // booking-system exports, and often missing the year entirely.
  startdatetime: "datetime",
  datetime: "datetime",
  startdate: "datetime",
  appointmentdatetime: "datetime",
  when: "datetime",
  // When the booking was MADE. Not imported, but it carries the year that a
  // combined date column usually leaves out.
  bookedon: "bookedon",
  createdon: "bookedon",
  createdat: "bookedon",
  bookeddate: "bookedon",

  name: "name",
  customer: "name",
  customername: "name",
  client: "name",
  clientname: "name",
  email: "email",
  emailaddress: "email",
  customeremail: "email",
  clientemail: "email",
  phone: "phone",
  phonenumber: "phone",
  mobile: "phone",
  customerphone: "phone",
  clientphone: "phone",

  service: "service",
  package: "service",
  servicename: "service",
  addons: "addons",
  extras: "addons",
  serviceextras: "addons",
  addon: "addons",

  location: "location",
  address: "address",
  whatisyouraddress: "address",
  serviceaddress: "address",
  vehicle: "vehicle",
  car: "vehicle",
  whatisyourvehiclemakemodel: "vehicle",
  vehiclemakemodel: "vehicle",
  makemodel: "vehicle",

  total: "total",
  price: "total",
  amount: "total",
  totalprice: "total",
  tip: "tip",
  gratuity: "tip",
  coupondiscount: "discount",
  discount: "discount",
  duration: "duration",
  durationminutes: "duration",
  status: "status",
  bookingstatus: "status",
  notes: "notes",
  note: "notes",
  comments: "notes",
};

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** Pull a 4-digit year out of a "Booked On" style value. */
function yearFrom(text: string): number | null {
  const m = text.match(/(20\d{2})/);
  return m ? Number(m[1]) : null;
}

/** "Aug 31, 2026 9:53 am" -> a comparable YYYY-MM-DD, or null. */
function parseBookedOn(text: string): string | null {
  const m = text.trim().match(/^([A-Za-z]{3,})\s+(\d{1,2}),?\s*(20\d{2})/);
  if (!m) return null;
  const month = MONTHS[m[1].slice(0, 3).toLowerCase()];
  if (!month) return null;
  return `${m[3]}-${String(month).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

/**
 * Parse a combined date/time cell.
 *
 * Exports frequently write "September 2, 09:30am" with no year at all. The
 * year is taken from the row's "Booked On" column, and rolled forward when
 * the result would land before the booking was made — which is what a
 * December booking for January looks like.
 */
export function parseDateTime(
  value: string,
  bookedOn: string,
): { date: string; time: string } | null {
  const text = value.trim();
  if (!text) return null;

  // Already ISO?
  const iso = text.match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{1,2}):(\d{2}))?/);
  if (iso) {
    return {
      date: iso[1],
      time: iso[2] ? `${iso[2].padStart(2, "0")}:${iso[3]}` : "09:00",
    };
  }

  const m = text.match(
    /^([A-Za-z]{3,})\s+(\d{1,2})(?:,?\s*(20\d{2}))?(?:,?\s*(\d{1,2}):(\d{2})\s*([ap]m)?)?/i,
  );
  if (!m) return null;

  const month = MONTHS[m[1].slice(0, 3).toLowerCase()];
  if (!month) return null;
  const day = Number(m[2]);

  let hour = m[4] ? Number(m[4]) : 9;
  const minute = m[5] ?? "00";
  const ampm = m[6]?.toLowerCase();
  if (ampm === "pm" && hour < 12) hour += 12;
  if (ampm === "am" && hour === 12) hour = 0;

  const bookedDate = parseBookedOn(bookedOn);
  let year = m[3] ? Number(m[3]) : (yearFrom(bookedOn) ?? new Date().getFullYear());

  const build = (y: number) =>
    `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  // No explicit year: a job dated before it was booked means the booking
  // rolled into the following year.
  if (!m[3] && bookedDate && build(year) < bookedDate) year += 1;

  return { date: build(year), time: `${String(hour).padStart(2, "0")}:${minute}` };
}

/** Excel writes phone numbers as '+1705... to stop them becoming numbers. */
export const cleanPhone = (v: string) => v.replace(/^['’]/, "").trim();

/** "$110.00", "1,234.50" -> 110 / 1234.5 */
export const cleanMoney = (v: string) => Number((v ?? "").replace(/[^0-9.-]/g, "")) || 0;

/** Extras columns carry noise like "None" and location markers. */
export function cleanExtras(v: string): string {
  return (v ?? "")
    .split(/[;|,]/)
    .map((x) => x.trim())
    .filter(
      (x) =>
        x &&
        x.toLowerCase() !== "none" &&
        // "Mobile Detail (select if you picked Mobile Location)" is a
        // location flag, not something that was actually done to the car.
        !/^mobile detail/i.test(x),
    )
    .join("; ");
}

export type ImportRow = {
  date: string;
  startTime: string;
  name: string;
  email: string;
  phone: string;
  service: string;
  addOns: string;
  location: string;
  address: string;
  vehicle: string;
  total: number;
  tip: number;
  discount: number;
  durationMinutes: number;
  status: string;
  notes: string;
};

/**
 * Turn one mapped CSV row into what the server expects. Returns null when
 * the date can't be read at all, so a single unreadable row is skipped
 * rather than failing the whole file.
 */
export function toImportRow(r: Record<string, string>): ImportRow | null {
  // Either a combined "September 2, 09:30am" cell, or separate columns.
  const combined = r.datetime ? parseDateTime(r.datetime, r.bookedon ?? "") : null;
  const date = combined?.date ?? (r.date ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

  const rawTime = (r.time ?? "").trim();
  const startTime =
    combined?.time ??
    (/^\d{1,2}:\d{2}$/.test(rawTime) ? rawTime.padStart(5, "0") : "09:00");

  // Location can be a plain word or a descriptive label like
  // "Mobile Detail ($15 Upcharge)" / "Nate's Shop".
  const locationText = (r.location ?? "").toLowerCase();
  const location = /mobile|on-?site|onsite|travel/.test(locationText) ? "mobile" : "shop";

  // Map whatever the source calls a status onto ours. Anything approved but
  // still in the future is upcoming work, not history.
  const rawStatus = (r.status ?? "").trim().toLowerCase();
  const today = new Date().toISOString().slice(0, 10);
  let status: string;
  if (/cancel|declin|reject|no.?show/.test(rawStatus)) status = "cancelled";
  else if (/pending|await|unconfirm/.test(rawStatus)) status = "confirmed";
  else status = date > today ? "confirmed" : "completed";

  return {
    date,
    startTime,
    name: (r.name ?? "").trim(),
    email: (r.email ?? "").trim(),
    phone: cleanPhone(r.phone ?? ""),
    service: (r.service ?? "").trim(),
    addOns: cleanExtras(r.addons ?? ""),
    location,
    address: (r.address ?? "").trim(),
    vehicle: (r.vehicle ?? "").trim(),
    total: cleanMoney(r.total ?? ""),
    tip: cleanMoney(r.tip ?? ""),
    discount: cleanMoney(r.discount ?? ""),
    durationMinutes: Math.min(1440, Math.max(0, Math.round(cleanMoney(r.duration ?? "")))),
    status,
    notes: (r.notes ?? "").trim(),
  };
}


/** One row of a parsed file, keyed by our canonical column names. */
export type MappedRow = Record<string, string>;

export type ParsedFile = {
  rows: MappedRow[];
  headers: string[];
  unmapped: string[];
};

/**
 * Read a CSV into rows keyed by our column names. Throws with a readable
 * message when the file is missing something we can't work without.
 */
export function readAppointmentCsv(text: string): ParsedFile {
  const grid = parseCsv(text);
  if (grid.length < 2) throw new Error("That file has no data rows.");

  const headers = grid[0].map(norm);
  const mapped = headers.map((h) => ALIASES[h] ?? "");
  const hasDate = mapped.includes("date") || mapped.includes("datetime");
  if (!hasDate || !mapped.includes("name")) {
    throw new Error(
      "The file needs a date column (or a combined date/time column) and a customer name column. " +
        `Found: ${grid[0].filter(Boolean).join(", ")}`,
    );
  }

  const rows = grid.slice(1).map((cells) => {
    const out: MappedRow = {};
    mapped.forEach((key, i) => {
      if (key) out[key] = (cells[i] ?? "").trim();
    });
    return out;
  });

  return { rows, headers: grid[0], unmapped: grid[0].filter((_, i) => !mapped[i]) };
}
