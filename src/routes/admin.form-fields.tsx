import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { FileInput, GripVertical, Pencil, Plus, Trash2, X } from "lucide-react";

import {
  listAdminFormFields,
  removeFormField,
  saveFormField,
} from "@/lib/api/admin.functions";
import {
  Button,
  EmptyState,
  ErrorNote,
  Field,
  PageHeader,
  Portal,
  Spinner,
  SuccessNote,
  ToggleChip,
  inputCls,
} from "@/components/admin/ui";

export const Route = createFileRoute("/admin/form-fields")({
  component: FormFields,
});

type Data = Awaited<ReturnType<typeof listAdminFormFields>>;
type FieldDef = Data["fields"][number];

const TYPES: { value: FieldDef["type"]; label: string; hint: string }[] = [
  { value: "text", label: "Short text", hint: "One line" },
  { value: "textarea", label: "Long text", hint: "Multi-line" },
  { value: "select", label: "Dropdown", hint: "Pick one option" },
  { value: "checkbox", label: "Yes / no", hint: "A single tickbox" },
  { value: "number", label: "Number", hint: "Numeric only" },
  { value: "date", label: "Date", hint: "Date picker" },
];

const blank = (sortOrder: number): FieldDef => ({
  id: "",
  label: "",
  type: "text",
  required: false,
  placeholder: "",
  helpText: "",
  options: [],
  onlyForServices: [],
  active: true,
  sortOrder,
});

function FormFields() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [draft, setDraft] = useState<FieldDef | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      setData(await listAdminFormFields());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load.");
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const flash = (m: string) => {
    setOk(m);
    setTimeout(() => setOk(null), 3500);
  };

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      await saveFormField({
        data: {
          id: draft.id || undefined,
          label: draft.label.trim(),
          type: draft.type,
          required: draft.required,
          placeholder: draft.placeholder?.trim() || undefined,
          helpText: draft.helpText?.trim() || undefined,
          options: draft.options.filter((o) => o.trim()),
          onlyForServices: draft.onlyForServices,
          active: draft.active,
          sortOrder: draft.sortOrder,
        },
      });
      setDraft(null);
      flash("Saved. The booking form is updated.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (f: FieldDef) => {
    try {
      await saveFormField({ data: { ...f, id: f.id, active: !f.active } });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't update.");
    }
  };

  if (!data && !error) return <Spinner label="Loading form fields…" />;
  if (!data) return <ErrorNote>{error}</ErrorNote>;

  return (
    <>
      <PageHeader
        title="Form Fields"
        subtitle="Extra questions on the booking form. Answers are saved on the booking and can be included in emails and calendar events."
        actions={
          <Button variant="primary" onClick={() => setDraft(blank(data.fields.length))}>
            <Plus className="h-3.5 w-3.5" /> Add field
          </Button>
        }
      />

      <AnimatePresence>
        {error && <ErrorNote>{error}</ErrorNote>}
        {ok && <SuccessNote>{ok}</SuccessNote>}
      </AnimatePresence>

      {data.fields.length === 0 ? (
        <div className="mt-5">
          <EmptyState
            icon={FileInput}
            title="No custom fields"
            body="The booking form already collects name, contact, vehicle and notes. Add a field here for anything else you need to ask."
            action={
              <Button variant="primary" onClick={() => setDraft(blank(0))}>
                <Plus className="h-3.5 w-3.5" /> Add your first field
              </Button>
            }
          />
        </div>
      ) : (
        <div className="mt-5 space-y-2">
          <AnimatePresence initial={false}>
            {data.fields.map((f, i) => (
              <motion.div
                key={f.id}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0, transition: { delay: i * 0.04 } }}
                exit={{ opacity: 0 }}
                className={`flex flex-wrap items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 ${
                  f.active ? "" : "opacity-55"
                }`}
              >
                <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground/40" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-semibold text-foreground">
                    {f.label}
                    {f.required && <span className="ml-1 text-destructive">*</span>}
                  </p>
                  <p className="truncate text-[12px] text-muted-foreground">
                    {TYPES.find((t) => t.value === f.type)?.label}
                    {f.type === "select" && f.options.length > 0 && ` · ${f.options.join(", ")}`}
                    {f.onlyForServices.length > 0 &&
                      ` · only for ${f.onlyForServices
                        .map((id) => data.services.find((s) => s.id === id)?.title ?? id)
                        .join(", ")}`}
                  </p>
                </div>
                <ToggleChip on={f.active} labels={["Shown", "Hidden"]} onChange={() => toggle(f)} />
                <Button size="sm" onClick={() => setDraft(f)}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    if (!confirm(`Delete "${f.label}"? Past answers stay on their bookings.`))
                      return;
                    await removeFormField({ data: { id: f.id } });
                    await load();
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      <AnimatePresence>
        {draft && (
          <Portal>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setDraft(null)}
              className="admin-theme fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-[3px]"
            >
              <motion.div
                initial={{ scale: 0.96, y: 16 }}
                animate={{ scale: 1, y: 0 }}
                exit={{ scale: 0.98, y: 8 }}
                onClick={(e) => e.stopPropagation()}
                className="max-h-[88vh] w-full max-w-lg overflow-y-auto overscroll-contain rounded-2xl border border-white/[0.08] bg-[var(--card)] p-6"
              >
                <div className="flex items-start justify-between">
                  <h2 className="text-lg font-bold tracking-tight text-foreground">
                    {draft.id ? "Edit field" : "New field"}
                  </h2>
                  <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>

                <div className="mt-5 space-y-4">
                  <Field label="Question / label">
                    <input
                      className={inputCls}
                      value={draft.label}
                      maxLength={80}
                      placeholder="e.g. Is there a gate code?"
                      onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                    />
                  </Field>

                  <Field label="Field type">
                    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                      {TYPES.map((t) => (
                        <button
                          key={t.value}
                          type="button"
                          onClick={() => setDraft({ ...draft, type: t.value })}
                          className={`rounded-lg px-2.5 py-2 text-left ring-1 ring-inset transition ${
                            draft.type === t.value
                              ? "bg-primary/12 text-primary ring-primary/30"
                              : "bg-white/[0.03] text-foreground ring-white/[0.08] hover:bg-white/[0.07]"
                          }`}
                        >
                          <span className="block text-[12px] font-semibold">{t.label}</span>
                          <span className="block text-[10.5px] text-muted-foreground">
                            {t.hint}
                          </span>
                        </button>
                      ))}
                    </div>
                  </Field>

                  {draft.type === "select" && (
                    <Field label="Options" hint="One per line.">
                      <textarea
                        className={`${inputCls} min-h-[90px] resize-y`}
                        value={draft.options.join("\n")}
                        placeholder={"Small\nMedium\nLarge"}
                        onChange={(e) =>
                          setDraft({ ...draft, options: e.target.value.split("\n") })
                        }
                      />
                    </Field>
                  )}

                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field
                      label={draft.type === "checkbox" ? "Tickbox text" : "Placeholder"}
                    >
                      <input
                        className={inputCls}
                        value={draft.placeholder ?? ""}
                        maxLength={120}
                        onChange={(e) => setDraft({ ...draft, placeholder: e.target.value })}
                      />
                    </Field>
                    <Field label="Help text" hint="Small note under the field.">
                      <input
                        className={inputCls}
                        value={draft.helpText ?? ""}
                        maxLength={200}
                        onChange={(e) => setDraft({ ...draft, helpText: e.target.value })}
                      />
                    </Field>
                  </div>

                  <Field
                    label="Show only for certain packages"
                    hint="Leave all unticked to ask on every booking."
                  >
                    <div className="flex flex-wrap gap-1.5">
                      {data.services.map((s) => {
                        const on = draft.onlyForServices.includes(s.id);
                        return (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() =>
                              setDraft({
                                ...draft,
                                onlyForServices: on
                                  ? draft.onlyForServices.filter((x) => x !== s.id)
                                  : [...draft.onlyForServices, s.id],
                              })
                            }
                            className={`rounded-lg px-3 py-1.5 text-[12px] font-semibold ring-1 ring-inset transition ${
                              on
                                ? "bg-primary/12 text-primary ring-primary/30"
                                : "bg-white/[0.03] text-muted-foreground ring-white/[0.08] hover:bg-white/[0.07]"
                            }`}
                          >
                            {s.title}
                          </button>
                        );
                      })}
                    </div>
                  </Field>

                  <div className="flex flex-wrap gap-5">
                    <label className="flex items-center gap-2.5 text-[13px] text-foreground">
                      <input
                        type="checkbox"
                        checked={draft.required}
                        onChange={(e) => setDraft({ ...draft, required: e.target.checked })}
                        className="h-4 w-4 rounded border-border accent-[var(--primary)]"
                      />
                      Required
                    </label>
                    <label className="flex items-center gap-2.5 text-[13px] text-foreground">
                      <input
                        type="checkbox"
                        checked={draft.active}
                        onChange={(e) => setDraft({ ...draft, active: e.target.checked })}
                        className="h-4 w-4 rounded border-border accent-[var(--primary)]"
                      />
                      Show on the booking form
                    </label>
                  </div>
                </div>

                <div className="mt-6 flex justify-end gap-2">
                  <Button onClick={() => setDraft(null)}>Cancel</Button>
                  <Button
                    variant="primary"
                    loading={busy}
                    disabled={!draft.label.trim()}
                    onClick={save}
                  >
                    Save field
                  </Button>
                </div>
              </motion.div>
            </motion.div>
          </Portal>
        )}
      </AnimatePresence>
    </>
  );
}
