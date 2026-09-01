import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { GripVertical, HelpCircle, MessageSquareQuote, Plus, Star, Trash2 } from "lucide-react";

import {
  listAdminFaqs,
  listAdminTestimonials,
  removeFaq,
  removeTestimonial,
  saveFaq,
  saveTestimonial,
} from "@/lib/api/content.functions";
import { EditorModal, FieldRow } from "@/components/admin/EditorModal";
import {
  Button,
  EmptyState,
  ErrorNote,
  Field,
  GlassCard,
  PageHeader,
  Spinner,
  SuccessNote,
  ToggleChip,
  inputCls,
} from "@/components/admin/ui";

export const Route = createFileRoute("/admin/testimonials")({
  component: Testimonials,
});

type Data = Awaited<ReturnType<typeof listAdminTestimonials>>;
type Item = Data["testimonials"][number];

const uid = () =>
  globalThis.crypto?.randomUUID?.() ?? `t-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const blank = (sortOrder: number): Item => ({
  id: uid(),
  name: "",
  vehicle: "",
  rating: 5,
  text: "",
  active: true,
  sortOrder,
  createdAt: new Date().toISOString(),
});

function Testimonials() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [draft, setDraft] = useState<Item | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await listAdminTestimonials());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const flash = (m: string) => {
    setOk(m);
    setTimeout(() => setOk(null), 2600);
  };

  const save = async () => {
    if (!draft) return;
    if (!draft.name.trim()) return setError("Whose review is it?");
    if (!draft.text.trim()) return setError("The review needs some text.");
    setSaving(true);
    setError(null);
    try {
      await saveTestimonial({
        data: {
          id: draft.id,
          name: draft.name.trim(),
          vehicle: draft.vehicle.trim(),
          rating: draft.rating,
          text: draft.text.trim(),
          active: draft.active,
          sortOrder: draft.sortOrder,
        },
      });
      setDraft(null);
      flash(isNew ? "Review added." : "Saved.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save it.");
    } finally {
      setSaving(false);
    }
  };

  const del = async (t: Item) => {
    if (!confirm(`Delete the review from ${t.name}? It comes off the homepage immediately.`)) return;
    try {
      await removeTestimonial({ data: { id: t.id } });
      flash("Deleted.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't delete it.");
    }
  };

  /** Swap sortOrder with the neighbour so the homepage order can be set. */
  const move = async (t: Item, dir: -1 | 1) => {
    if (!data) return;
    const list = [...data.testimonials];
    const i = list.findIndex((x) => x.id === t.id);
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    try {
      await Promise.all([
        saveTestimonial({ data: { ...list[i], sortOrder: j } }),
        saveTestimonial({ data: { ...list[j], sortOrder: i } }),
      ]);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't reorder.");
    }
  };

  if (error && !data) return <ErrorNote>{error}</ErrorNote>;
  if (!data) return <Spinner label="Loading reviews…" />;

  const live = data.testimonials.filter((t) => t.active).length;

  return (
    <>
      <PageHeader
        title="Homepage content"
        subtitle="The reviews and the FAQ your customers read. Add, edit, reorder or hide any of them — the design doesn't change, only the words."
        actions={
          <Button
            variant="primary"
            onClick={() => {
              setDraft(blank(data.testimonials.length));
              setIsNew(true);
            }}
          >
            <Plus className="h-3.5 w-3.5" /> Add review
          </Button>
        }
      />

      <AnimatePresence>{ok && <SuccessNote>{ok}</SuccessNote>}</AnimatePresence>
      {error && (
        <div className="mb-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      <GlassCard className="mb-5 p-4">
        <p className="text-[12.5px] text-muted-foreground">
          <span className="font-semibold text-foreground">{live}</span> showing on the site
          {data.testimonials.length !== live &&
            ` · ${data.testimonials.length - live} hidden`}
          . They appear in the order below.
        </p>
      </GlassCard>

      {data.testimonials.length === 0 ? (
        <EmptyState
          icon={MessageSquareQuote}
          title="No reviews yet"
          body="Add what customers have told you. Real names and the car they drive make these far more convincing."
          action={
            <Button
              variant="primary"
              onClick={() => {
                setDraft(blank(0));
                setIsNew(true);
              }}
            >
              <Plus className="h-3.5 w-3.5" /> Add review
            </Button>
          }
        />
      ) : (
        <div className="space-y-2">
          <AnimatePresence initial={false}>
            {data.testimonials.map((t, i) => (
              <motion.div
                key={t.id}
                layout
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0, transition: { delay: Math.min(i * 0.03, 0.25) } }}
                exit={{ opacity: 0, scale: 0.99 }}
                className={`group flex items-start gap-3 rounded-xl border border-[var(--line-1)] bg-[var(--fill-1)] px-4 py-3.5 ${
                  t.active ? "" : "opacity-55"
                }`}
              >
                <div className="flex flex-col items-center gap-0.5 pt-0.5">
                  <button
                    type="button"
                    onClick={() => move(t, -1)}
                    disabled={i === 0}
                    aria-label={`Move ${t.name} up`}
                    className="rounded p-0.5 text-muted-foreground transition hover:text-foreground disabled:opacity-25"
                  >
                    ▲
                  </button>
                  <GripVertical className="h-3 w-3 text-muted-foreground/40" />
                  <button
                    type="button"
                    onClick={() => move(t, 1)}
                    disabled={i === data.testimonials.length - 1}
                    aria-label={`Move ${t.name} down`}
                    className="rounded p-0.5 text-muted-foreground transition hover:text-foreground disabled:opacity-25"
                  >
                    ▼
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setDraft(t);
                    setIsNew(false);
                  }}
                  className="min-w-0 flex-1 text-left"
                >
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-[13.5px] font-semibold text-foreground">{t.name}</span>
                    {t.vehicle && (
                      <span className="text-[11.5px] text-muted-foreground">{t.vehicle}</span>
                    )}
                    <span className="flex items-center gap-0.5">
                      {Array.from({ length: t.rating }).map((_, s) => (
                        <Star key={s} className="h-3 w-3 fill-primary text-primary" />
                      ))}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-[12.5px] leading-relaxed text-muted-foreground">
                    {t.text}
                  </p>
                </button>

                <div className="flex shrink-0 items-center gap-1.5">
                  <ToggleChip
                    on={t.active}
                    labels={["Live", "Hidden"]}
                    onChange={async (next) => {
                      await saveTestimonial({ data: { ...t, active: next } });
                      await load();
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => del(t)}
                    aria-label={`Delete review from ${t.name}`}
                    className="rounded-md p-1.5 text-muted-foreground opacity-0 transition hover:bg-destructive/15 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      <EditorModal
        open={!!draft}
        onClose={() => setDraft(null)}
        title={isNew ? "Add a review" : `Edit ${draft?.name}'s review`}
        footer={
          <>
            <Button onClick={() => setDraft(null)}>Cancel</Button>
            <Button variant="primary" loading={saving} onClick={save}>
              Save
            </Button>
          </>
        }
      >
        {draft && (
          <>
            <FieldRow>
              <Field label="Name" hint="First name and last initial reads well.">
                <input
                  className={inputCls}
                  value={draft.name}
                  maxLength={80}
                  placeholder="Marcus T."
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </Field>
              <Field label="Vehicle" hint="Optional">
                <input
                  className={inputCls}
                  value={draft.vehicle}
                  maxLength={80}
                  placeholder="BMW M4 Competition"
                  onChange={(e) => setDraft({ ...draft, vehicle: e.target.value })}
                />
              </Field>
            </FieldRow>

            <Field label="Rating">
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    aria-label={`${n} star${n === 1 ? "" : "s"}`}
                    onClick={() => setDraft({ ...draft, rating: n })}
                    className="rounded p-1 transition hover:scale-110"
                  >
                    <Star
                      className={`h-5 w-5 ${
                        n <= draft.rating
                          ? "fill-primary text-primary"
                          : "text-muted-foreground/40"
                      }`}
                    />
                  </button>
                ))}
              </div>
            </Field>

            <Field label="What they said">
              <textarea
                className={`${inputCls} min-h-[120px] resize-y`}
                value={draft.text}
                maxLength={1000}
                onChange={(e) => setDraft({ ...draft, text: e.target.value })}
              />
            </Field>

            <div className="flex items-center justify-between rounded-lg border border-[var(--line-2)] bg-[var(--fill-1)] px-3.5 py-3">
              <span className="text-[12.5px] text-foreground">
                Show on the site
                <span className="block text-[11px] text-muted-foreground">
                  Hidden reviews are kept but don't appear on the homepage.
                </span>
              </span>
              <ToggleChip
                on={draft.active}
                labels={["Live", "Hidden"]}
                onChange={(next) => setDraft({ ...draft, active: next })}
              />
            </div>
          </>
        )}
      </EditorModal>

      <FaqSection onError={setError} onOk={flash} />
    </>
  );
}

// ============================== FAQ =====================================

type FaqItem = Awaited<ReturnType<typeof listAdminFaqs>>["faqs"][number];

const blankFaq = (sortOrder: number): FaqItem => ({
  id: uid(),
  question: "",
  answer: "",
  active: true,
  sortOrder,
  createdAt: new Date().toISOString(),
});

function FaqSection({ onError, onOk }: { onError: (m: string) => void; onOk: (m: string) => void }) {
  const [faqs, setFaqs] = useState<FaqItem[] | null>(null);
  const [draft, setDraft] = useState<FaqItem | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setFaqs((await listAdminFaqs()).faqs);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Couldn't load the FAQ.");
    }
  }, [onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!draft) return;
    if (!draft.question.trim() || !draft.answer.trim()) {
      return onError("A question and an answer are both needed.");
    }
    setSaving(true);
    try {
      await saveFaq({
        data: {
          id: draft.id,
          question: draft.question.trim(),
          answer: draft.answer.trim(),
          active: draft.active,
          sortOrder: draft.sortOrder,
        },
      });
      setDraft(null);
      onOk(isNew ? "Question added." : "Saved.");
      await load();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Couldn't save it.");
    } finally {
      setSaving(false);
    }
  };

  const del = async (f: FaqItem) => {
    if (!confirm(`Delete "${f.question}"? It comes off the homepage immediately.`)) return;
    try {
      await removeFaq({ data: { id: f.id } });
      onOk("Deleted.");
      await load();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Couldn't delete it.");
    }
  };

  /** Swap sortOrder with the neighbour so the homepage order can be set. */
  const move = async (f: FaqItem, dir: -1 | 1) => {
    if (!faqs) return;
    const i = faqs.findIndex((x) => x.id === f.id);
    const j = i + dir;
    if (j < 0 || j >= faqs.length) return;
    try {
      await Promise.all([
        saveFaq({ data: { ...faqs[i], sortOrder: j } }),
        saveFaq({ data: { ...faqs[j], sortOrder: i } }),
      ]);
      await load();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Couldn't reorder.");
    }
  };

  return (
    <>
      <div className="mb-4 mt-10 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[19px] font-bold tracking-tight text-foreground">FAQ</h2>
          <p className="mt-1 text-[13px] text-muted-foreground">
            The questions on your homepage. Same design, your words.
          </p>
        </div>
        <Button
          variant="primary"
          onClick={() => {
            setDraft(blankFaq(faqs?.length ?? 0));
            setIsNew(true);
          }}
        >
          <Plus className="h-3.5 w-3.5" /> Add question
        </Button>
      </div>

      {!faqs ? (
        <p className="text-[13px] text-muted-foreground">Loading…</p>
      ) : faqs.length === 0 ? (
        <EmptyState
          icon={HelpCircle}
          title="No questions yet"
          body="Answer what customers actually ask you and it saves you repeating yourself."
          action={
            <Button
              variant="primary"
              onClick={() => {
                setDraft(blankFaq(0));
                setIsNew(true);
              }}
            >
              <Plus className="h-3.5 w-3.5" /> Add question
            </Button>
          }
        />
      ) : (
        <div className="space-y-2">
          <AnimatePresence initial={false}>
            {faqs.map((f, i) => (
              <motion.div
                key={f.id}
                layout
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0, transition: { delay: Math.min(i * 0.03, 0.25) } }}
                exit={{ opacity: 0, scale: 0.99 }}
                className={`group flex items-start gap-3 rounded-xl border border-[var(--line-1)] bg-[var(--fill-1)] px-4 py-3.5 ${
                  f.active ? "" : "opacity-55"
                }`}
              >
                <div className="flex flex-col items-center gap-0.5 pt-0.5">
                  <button
                    type="button"
                    onClick={() => move(f, -1)}
                    disabled={i === 0}
                    aria-label={`Move "${f.question}" up`}
                    className="rounded p-0.5 text-muted-foreground transition hover:text-foreground disabled:opacity-25"
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    onClick={() => move(f, 1)}
                    disabled={i === faqs.length - 1}
                    aria-label={`Move "${f.question}" down`}
                    className="rounded p-0.5 text-muted-foreground transition hover:text-foreground disabled:opacity-25"
                  >
                    ▼
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setDraft(f);
                    setIsNew(false);
                  }}
                  className="min-w-0 flex-1 text-left"
                >
                  <p className="text-[13.5px] font-semibold text-foreground">{f.question}</p>
                  <p className="mt-1 line-clamp-2 text-[12.5px] leading-relaxed text-muted-foreground">
                    {f.answer}
                  </p>
                </button>

                <div className="flex shrink-0 items-center gap-1.5">
                  <ToggleChip
                    on={f.active}
                    labels={["Live", "Hidden"]}
                    onChange={async (next) => {
                      await saveFaq({ data: { ...f, active: next } });
                      await load();
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => del(f)}
                    aria-label={`Delete "${f.question}"`}
                    className="rounded-md p-1.5 text-muted-foreground opacity-0 transition hover:bg-destructive/15 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      <EditorModal
        open={!!draft}
        onClose={() => setDraft(null)}
        title={isNew ? "Add a question" : "Edit question"}
        footer={
          <>
            <Button onClick={() => setDraft(null)}>Cancel</Button>
            <Button variant="primary" loading={saving} onClick={save}>
              Save
            </Button>
          </>
        }
      >
        {draft && (
          <>
            <Field label="Question">
              <input
                className={inputCls}
                value={draft.question}
                maxLength={200}
                placeholder="How long does a full detail take?"
                onChange={(e) => setDraft({ ...draft, question: e.target.value })}
              />
            </Field>
            <Field label="Answer">
              <textarea
                className={`${inputCls} min-h-[130px] resize-y`}
                value={draft.answer}
                maxLength={2000}
                onChange={(e) => setDraft({ ...draft, answer: e.target.value })}
              />
            </Field>
            <div className="flex items-center justify-between rounded-lg border border-[var(--line-2)] bg-[var(--fill-1)] px-3.5 py-3">
              <span className="text-[12.5px] text-foreground">
                Show on the site
                <span className="block text-[11px] text-muted-foreground">
                  Hidden questions are kept but don't appear on the homepage.
                </span>
              </span>
              <ToggleChip
                on={draft.active}
                labels={["Live", "Hidden"]}
                onChange={(next) => setDraft({ ...draft, active: next })}
              />
            </div>
          </>
        )}
      </EditorModal>
    </>
  );
}
