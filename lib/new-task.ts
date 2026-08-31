/**
 * The New Task form, as three steps.
 *
 * Sales fill this in and marketing pick it up, so the two failure modes are
 * a campaign that arrives missing something marketing needs, and a form
 * long enough that people put off filling it in. Three short steps — who it
 * is for, what it is, the brief — answers both: nothing is asked before it
 * can be answered, and each step is small enough to finish.
 *
 * All the deciding lives here, pure and tested: which step you are on, what
 * is still missing, and whether a file can be attached. None of it touches
 * React or Supabase, and none of it reads the clock.
 */

export type StepKey = 'who' | 'what' | 'brief';

export interface Draft {
  clientId: string;
  brandId: string;
  taskName: string;
  salesCloser: string;
  budget: string;
  details: string;
}

export const EMPTY_DRAFT: Draft = {
  clientId: '', brandId: '', taskName: '', salesCloser: '', budget: '', details: '',
};

/** A brief is a deck or a PDF. Anything bigger is a misunderstanding. */
export const MAX_BRIEF_FILES = 5;
export const MAX_BRIEF_FILE_BYTES = 10 * 1024 * 1024;

function txt(v: string | null | undefined): string {
  return (v ?? '').trim();
}

/* ── Steps ──────────────────────────────────────────────────────── */

export interface StepStatus {
  key: StepKey;
  title: string;
  /** Everything this step needs is answered. */
  done: boolean;
  /** What is missing, in words, for the step's own error line. */
  missing: string[];
}

/**
 * Only the client and the brand are genuinely required — they are what
 * everything downstream keys on. The task name is required too, because a
 * campaign with no name is unfindable the moment there are two of them.
 *
 * Budget and closer are NOT required. Sales often submit before the number
 * is agreed, and refusing the whole form over a figure nobody has yet is
 * how things end up being sent by WhatsApp instead.
 */
export function stepStatuses(draft: Draft): StepStatus[] {
  const whoMissing: string[] = [];
  if (!txt(draft.clientId)) whoMissing.push('Pick the client.');
  else if (!txt(draft.brandId)) whoMissing.push('Pick the brand.');

  const whatMissing: string[] = [];
  if (!txt(draft.taskName)) whatMissing.push('Give the campaign a name.');
  else if (txt(draft.taskName).length < 3) whatMissing.push('That name is too short to find later.');

  return [
    // Named for the ANSWER, not the question. "Who is it for" and "What is
    // it" read as an interview; "Client" and "Data" read as the two things
    // a person is filling in, and match how the rest of the app labels a
    // section.
    { key: 'who',   title: 'Client', done: whoMissing.length === 0,  missing: whoMissing },
    { key: 'what',  title: 'Data',   done: whatMissing.length === 0, missing: whatMissing },
    // The brief is optional, so this step is never "incomplete" — it is
    // done the moment you get to it.
    { key: 'brief', title: 'The brief',     done: true,                     missing: [] },
  ];
}

/**
 * The step to open when the form first appears.
 *
 * The first one that is not finished — which means a form prefilled from a
 * won deal opens on what is left to answer rather than on a question that
 * already has its answer.
 */
export function firstOpenStep(draft: Draft): StepKey {
  const s = stepStatuses(draft);
  return (s.find((x) => !x.done) ?? s[s.length - 1]).key;
}

/** Can this step be opened yet? You cannot pick a brand with no client. */
export function stepReachable(step: StepKey, draft: Draft): boolean {
  if (step === 'who') return true;
  return stepStatuses(draft)[0].done;
}

/** Everything needed to submit, or the reasons why not. */
export function submitProblems(draft: Draft): string[] {
  return stepStatuses(draft).flatMap((s) => s.missing);
}

/* ── The collapsed summary ──────────────────────────────────────── */

export interface DraftLabels {
  clientName?: string | null;
  brandName?: string | null;
  signatory?: string | null;
  closerLabel?: string | null;
}

/**
 * What a finished step reads as once it is folded away.
 *
 * Empty string means "nothing worth showing yet" — the caller shows the
 * prompt instead. A summary that says "—  ·  —  ·  —" is worse than none.
 */
export function stepSummary(step: StepKey, draft: Draft, labels: DraftLabels = {}): string {
  if (step === 'who') {
    return [labels.clientName, labels.brandName, labels.signatory && `Signatory ${labels.signatory}`]
      .filter(Boolean).join(' · ');
  }
  if (step === 'what') {
    const budget = money(draft.budget);
    return [txt(draft.taskName), budget, labels.closerLabel]
      .filter(Boolean).join(' · ');
  }
  const words = txt(draft.details).split(/\s+/).filter(Boolean).length;
  return words ? `${words} word${words === 1 ? '' : 's'}` : '';
}

function money(raw: string): string {
  const n = Number(txt(raw).replace(/,/g, ''));
  if (!txt(raw) || !Number.isFinite(n) || n === 0) return '';
  return `SAR ${Math.round(n).toLocaleString('en-US')}`;
}

/** The budget as a number, or null. Commas and spaces are people typing. */
export function budgetValue(raw: string): number | null {
  const cleaned = txt(raw).replace(/,/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/* ── Files on the brief ─────────────────────────────────────────── */

export interface PickedFile { name: string; size: number; type?: string }

/**
 * What is wrong with the files somebody just picked.
 *
 * Checked before anything is created. A brief that is refused by storage
 * AFTER the campaign has been made leaves a campaign with no brief and a
 * person who thinks they attached one.
 */
export function attachmentProblems(existing: PickedFile[], incoming: PickedFile[]): string[] {
  const out: string[] = [];
  const all = [...(existing || []), ...(incoming || [])];

  if (all.length > MAX_BRIEF_FILES) {
    out.push(`Up to ${MAX_BRIEF_FILES} files. Put the rest on the campaign once it exists.`);
  }
  for (const f of incoming || []) {
    if (f.size === 0) out.push(`${f.name} is empty.`);
    else if (f.size > MAX_BRIEF_FILE_BYTES) {
      out.push(`${f.name} is ${mb(f.size)}MB — the limit here is ${mb(MAX_BRIEF_FILE_BYTES)}MB.`);
    }
  }
  // Same file twice is nearly always a double-click, not a decision.
  const names = new Set((existing || []).map((f) => f.name.toLowerCase()));
  for (const f of incoming || []) {
    if (names.has(f.name.toLowerCase())) out.push(`${f.name} is already attached.`);
    names.add(f.name.toLowerCase());
  }
  return out;
}

/** Files that survive the check, ready to be added to the list. */
export function acceptableFiles<T extends PickedFile>(existing: T[], incoming: T[]): T[] {
  const names = new Set((existing || []).map((f) => f.name.toLowerCase()));
  const room = MAX_BRIEF_FILES - (existing || []).length;
  const out: T[] = [];
  for (const f of incoming || []) {
    if (out.length >= room) break;
    if (f.size === 0 || f.size > MAX_BRIEF_FILE_BYTES) continue;
    if (names.has(f.name.toLowerCase())) continue;
    names.add(f.name.toLowerCase());
    out.push(f);
  }
  return out;
}

export function fileSizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${mb(bytes)} MB`;
}

function mb(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1).replace(/\.0$/, '');
}

/**
 * What to say after the task is made but some of the files did not upload.
 *
 * The campaign exists either way — refusing to admit the difference is how
 * somebody discovers three weeks later that the brief was never there.
 */
export function uploadOutcome(total: number, failed: number): string {
  if (total === 0) return 'Sent to marketing.';
  if (failed === 0) {
    return `Sent to marketing with ${total} file${total === 1 ? '' : 's'}.`;
  }
  if (failed === total) {
    return `Sent to marketing — but no files uploaded. Open the campaign and attach them there.`;
  }
  return `Sent to marketing. ${failed} of ${total} files did not upload — attach them on the campaign.`;
}
