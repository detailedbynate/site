import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Upload } from "lucide-react";

import { importAppointments } from "@/lib/api/appointments.functions";
import { EditorModal } from "./EditorModal";
import { Button, ErrorNote, inputCls } from "./ui";
import {
  COLUMNS,
  readAppointmentCsv,
  toImportRow,
  type ImportRow,
  type ParsedFile,
} from "@/lib/csv-import";

/**
 * Bring past jobs in from a CSV export.
 *
 * Parsing happens in the browser so the file itself never leaves the machine;
 * only the parsed rows are sent. Every import is previewed first (a dry run
 * that writes nothing), because a bad column mapping across 500 rows is far
 * easier to prevent than to unpick.
 */

type Parsed = ParsedFile;

export function AppointmentImport({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => Promise<void> | void;
}) {
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    created: number;
    skipped: number;
    problems: string[];
    dryRun: boolean;
  } | null>(null);

  const reset = () => {
    setParsed(null);
    setError(null);
    setResult(null);
  };

  const onFile = async (file: File) => {
    reset();
    try {
      setParsed(readAppointmentCsv(await file.text()));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read that file.");
    }
  };

  const send = async (dryRun: boolean) => {
    if (!parsed) return;
    setBusy(true);
    setError(null);
    try {
      const rows = parsed.rows.map(toImportRow).filter((r): r is ImportRow => r !== null);
      if (rows.length === 0) {
        throw new Error("No rows had a date that could be read.");
      }
      const res = await importAppointments({ data: { dryRun, rows } });
      setResult(res);
      if (!dryRun) await onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The import failed.");
    } finally {
      setBusy(false);
    }
  };

  const downloadTemplate = () => {
    const header = COLUMNS.map(([c]) => c).join(",");
    const example =
      "2026-07-14,10:00,Jane Doe,jane@example.com,705-555-0100,Diamond,Pet hair removal;Hand carnauba wax,mobile,12 Example St,2019 Honda Civic,190,20,completed,Repeat customer";
    const url = URL.createObjectURL(
      new Blob([`${header}\n${example}\n`], { type: "text/csv" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "appointment-import-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <EditorModal
      open={open}
      width="lg"
      onClose={() => {
        reset();
        onClose();
      }}
      title="Import past jobs"
      footer={
        <>
          <Button
            onClick={() => {
              reset();
              onClose();
            }}
          >
            Close
          </Button>
          {parsed && !result?.created && (
            <Button loading={busy} onClick={() => send(true)}>
              Preview
            </Button>
          )}
          {parsed && (
            <Button variant="primary" loading={busy} onClick={() => send(false)}>
              <Upload className="h-3.5 w-3.5" /> Import {parsed.rows.length} rows
            </Button>
          )}
        </>
      }
    >
      <p className="text-[12.5px] leading-relaxed text-muted-foreground">
        Bring in history from a spreadsheet or another booking system. Column names are matched
        automatically, so an export that calls it "Customer" or "Price" still works. Rows land as
        completed and paid, and they occupy their slot so old dates don't look free.
      </p>

      <div className="flex flex-wrap gap-2">
        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-[var(--line-2)] bg-[var(--fill-1)] px-4 py-2 text-[13px] font-semibold text-foreground transition hover:bg-[var(--fill-3)]">
          <FileSpreadsheet className="h-3.5 w-3.5" />
          Choose a CSV
          <input
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onFile(f);
              e.target.value = "";
            }}
          />
        </label>
        <Button onClick={downloadTemplate}>Download template</Button>
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}

      <AnimatePresence mode="wait">
        {parsed && !result && (
          <motion.div
            key="preview"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="rounded-xl bg-[var(--fill-1)] p-3.5 ring-1 ring-inset ring-[var(--line-1)]"
          >
            <p className="text-[13px] font-semibold text-foreground">
              {parsed.rows.length} row{parsed.rows.length === 1 ? "" : "s"} read
            </p>
            {parsed.unmapped.length > 0 && (
              <p className="mt-1 text-[11.5px] text-muted-foreground">
                Ignored columns: {parsed.unmapped.join(", ")}
              </p>
            )}
            <div className="mt-3 max-h-44 overflow-auto rounded-lg bg-[var(--fill-1)]">
              <table className="w-full text-left text-[11.5px]">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="px-2 py-1.5 font-medium">Date</th>
                    <th className="px-2 py-1.5 font-medium">Name</th>
                    <th className="px-2 py-1.5 font-medium">Service</th>
                    <th className="px-2 py-1.5 font-medium">Total</th>
                  </tr>
                </thead>
                <tbody className="text-foreground">
                  {parsed.rows.slice(0, 6).map((r, i) => (
                    <tr key={i} className="border-t border-[var(--line-1)]">
                      <td className="px-2 py-1.5">{r.date}</td>
                      <td className="px-2 py-1.5">{r.name}</td>
                      <td className="px-2 py-1.5">{r.service || "—"}</td>
                      <td className="px-2 py-1.5">{r.total || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {parsed.rows.length > 6 && (
              <p className="mt-2 text-[11px] text-muted-foreground">
                …and {parsed.rows.length - 6} more.
              </p>
            )}
          </motion.div>
        )}

        {result && (
          <motion.div
            key="result"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="rounded-xl bg-[var(--fill-1)] p-3.5 ring-1 ring-inset ring-[var(--line-1)]"
          >
            <p className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
              {result.problems.length ? (
                <AlertTriangle className="h-4 w-4 text-amber-300" />
              ) : (
                <CheckCircle2 className="h-4 w-4 text-emerald-300" />
              )}
              {result.dryRun
                ? `Preview: ${result.created} row${result.created === 1 ? "" : "s"} would import`
                : `Imported ${result.created} job${result.created === 1 ? "" : "s"}`}
              {result.skipped > 0 && ` · ${result.skipped} already existed`}
            </p>
            {result.problems.length > 0 && (
              <ul className="mt-2 space-y-1">
                {result.problems.map((p) => (
                  <li key={p} className="text-[11.5px] text-amber-200">
                    {p}
                  </li>
                ))}
              </ul>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <details className="rounded-lg bg-[var(--fill-1)] px-3.5 py-2.5 ring-1 ring-inset ring-[var(--line-1)]">
        <summary className="cursor-pointer text-[12px] font-semibold text-foreground">
          Which columns are understood?
        </summary>
        <ul className="mt-2 space-y-1">
          {COLUMNS.map(([name, note]) => (
            <li key={name} className="text-[11.5px] text-muted-foreground">
              <span className="font-mono text-foreground">{name}</span>
              {note && ` — ${note}`}
            </li>
          ))}
        </ul>
      </details>
    </EditorModal>
  );
}
