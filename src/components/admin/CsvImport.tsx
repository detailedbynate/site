import { useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, FileUp, Upload, X } from "lucide-react";

import { importCustomers } from "@/lib/api/admin.functions";
import {
  Portal, Button, ErrorNote, Field, SuccessNote, inputCls } from "./ui";

/**
 * Minimal RFC-4180 CSV parser — handles quoted fields, escaped quotes and
 * embedded commas/newlines. Written inline rather than pulling in a
 * dependency for one screen.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((v) => v.trim() !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((v) => v.trim() !== "")) rows.push(row);
  return rows;
}

/** Guess which column is which, so most exports need no mapping at all. */
function guessColumn(headers: string[], candidates: string[]): number {
  const norm = headers.map((h) => h.toLowerCase().replace(/[^a-z]/g, ""));
  for (const cand of candidates) {
    const i = norm.findIndex((h) => h === cand);
    if (i >= 0) return i;
  }
  for (const cand of candidates) {
    const i = norm.findIndex((h) => h.includes(cand));
    if (i >= 0) return i;
  }
  return -1;
}

type Mapping = { name: number; email: number; phone: number; notes: number };

export function CsvImport({ onDone }: { onDone: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<string[][] | null>(null);
  const [hasHeader, setHasHeader] = useState(true);
  const [map, setMap] = useState<Mapping>({ name: -1, email: -1, phone: -1, notes: -1 });
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setRows(null);
    setError(null);
    setResult(null);
    setMap({ name: -1, email: -1, phone: -1, notes: -1 });
    if (inputRef.current) inputRef.current.value = "";
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setResult(null);
    try {
      const text = await file.text();
      const parsed = parseCsv(text);
      if (parsed.length === 0) throw new Error("That file looks empty.");
      setRows(parsed);
      const headers = parsed[0];
      setMap({
        name: guessColumn(headers, ["name", "fullname", "customer", "client"]),
        email: guessColumn(headers, ["email", "emailaddress", "mail"]),
        phone: guessColumn(headers, ["phone", "mobile", "cell", "telephone"]),
        notes: guessColumn(headers, ["notes", "note", "comment", "comments"]),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read that file.");
    }
  };

  const headers = rows?.[0] ?? [];
  const dataRows = rows ? (hasHeader ? rows.slice(1) : rows) : [];

  const buildRows = () =>
    dataRows
      .map((r) => ({
        name: (map.name >= 0 ? r[map.name] : "")?.trim() ?? "",
        email: (map.email >= 0 ? r[map.email] : "")?.trim() ?? "",
        phone: (map.phone >= 0 ? r[map.phone] : "")?.trim() ?? "",
        notes: (map.notes >= 0 ? r[map.notes] : "")?.trim() || undefined,
      }))
      // A customer without an email can't be de-duplicated, so skip those
      // rather than creating unmergeable duplicates.
      .filter((r) => r.name && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(r.email));

  const valid = buildRows();
  const skipped = dataRows.length - valid.length;

  const doImport = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await importCustomers({ data: { rows: valid } });
      setResult(`Imported ${res.created} new, updated ${res.updated} existing.`);
      setRows(null);
      await onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed.");
    } finally {
      setBusy(false);
    }
  };

  const selects: { key: keyof Mapping; label: string; required?: boolean }[] = [
    { key: "name", label: "Name", required: true },
    { key: "email", label: "Email", required: true },
    { key: "phone", label: "Phone" },
    { key: "notes", label: "Notes" },
  ];

  return (
    <>
      <Button
        onClick={() => {
          reset();
          setOpen(true);
        }}
      >
        <FileUp className="h-3.5 w-3.5" /> Import CSV
      </Button>

      <Portal><AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpen(false)}
            className="admin-theme fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-[3px]"
          >
            <motion.div
              initial={{ scale: 0.96, y: 16 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.98, y: 8 }}
              onClick={(e) => e.stopPropagation()}
              className="max-h-[88vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-white/[0.08] bg-[var(--card)] p-6"
            >
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-lg font-bold tracking-tight text-foreground">
                    Import customers
                  </h2>
                  <p className="mt-1 text-[12.5px] text-muted-foreground">
                    Upload a CSV from your old system. Matching emails are updated, not duplicated —
                    so re-running the same file is safe.
                  </p>
                </div>
                <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <div className="mt-5">
                <input
                  ref={inputRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(e) => onFile(e.target.files?.[0])}
                />
                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  className="flex w-full flex-col items-center gap-2 rounded-xl border border-dashed border-white/[0.14] bg-white/[0.02] px-6 py-8 transition hover:border-primary/40 hover:bg-white/[0.04]"
                >
                  <Upload className="h-5 w-5 text-primary" />
                  <span className="text-[13px] font-semibold text-foreground">
                    {rows ? "Choose a different file" : "Choose a CSV file"}
                  </span>
                  <span className="text-[11.5px] text-muted-foreground">
                    Works with exports from most booking tools
                  </span>
                </button>
              </div>

              <AnimatePresence>
                {error && (
                  <div className="mt-4">
                    <ErrorNote>{error}</ErrorNote>
                  </div>
                )}
                {result && (
                  <div className="mt-4">
                    <SuccessNote>{result}</SuccessNote>
                  </div>
                )}
              </AnimatePresence>

              {rows && (
                <>
                  <label className="mt-5 flex items-center gap-2.5 text-[13px] text-foreground">
                    <input
                      type="checkbox"
                      checked={hasHeader}
                      onChange={(e) => setHasHeader(e.target.checked)}
                      className="h-4 w-4 rounded border-border accent-[var(--primary)]"
                    />
                    First row is a header
                  </label>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    {selects.map((s) => (
                      <Field
                        key={s.key}
                        label={`${s.label}${s.required ? " *" : ""}`}
                      >
                        <select
                          className={inputCls}
                          value={map[s.key]}
                          onChange={(e) =>
                            setMap({ ...map, [s.key]: Number(e.target.value) })
                          }
                        >
                          <option value={-1}>— none —</option>
                          {headers.map((h, i) => (
                            <option key={i} value={i}>
                              {hasHeader ? h || `Column ${i + 1}` : `Column ${i + 1}`}
                            </option>
                          ))}
                        </select>
                      </Field>
                    ))}
                  </div>

                  <div className="mt-4 rounded-xl bg-white/[0.03] p-3 ring-1 ring-inset ring-white/[0.06]">
                    <p className="text-[12px] font-semibold text-foreground">
                      {valid.length} ready to import
                      {skipped > 0 && (
                        <span className="font-normal text-muted-foreground">
                          {" "}
                          · {skipped} skipped (missing name or valid email)
                        </span>
                      )}
                    </p>
                    {valid.slice(0, 3).map((r, i) => (
                      <p key={i} className="mt-1 truncate text-[11.5px] text-muted-foreground">
                        {r.name} · {r.email} {r.phone && `· ${r.phone}`}
                      </p>
                    ))}
                  </div>

                  <div className="mt-5 flex justify-end gap-2">
                    <Button onClick={() => setOpen(false)}>Cancel</Button>
                    <Button
                      variant="primary"
                      loading={busy}
                      disabled={valid.length === 0}
                      onClick={doImport}
                    >
                      <Check className="h-3.5 w-3.5" /> Import {valid.length}
                    </Button>
                  </div>
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence></Portal>
    </>
  );
}
