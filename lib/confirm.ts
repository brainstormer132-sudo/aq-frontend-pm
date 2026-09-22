/**
 * What an "are you sure?" looks like when it is part of the app.
 *
 * Siraj, at the template editor, on Chrome's own dialog: "fix this add an
 * actual thing".
 *
 * -- WHAT WAS WRONG ---------------------------------------------------
 *
 * `confirm()` draws the BROWSER's dialog, not ours. It says
 * "aq-frontend-pm-kt6t.vercel.app says" above the text, in a grey box pinned
 * to the top of the window, with an OK that is not labelled with what it will
 * do. The careful sentence we wrote - three facts about what publishing
 * freezes - arrives as one undifferentiated paragraph under a URL. On a
 * screen that is otherwise the company's, that reads as a browser error.
 *
 * It is also a blocking call, which is why every one of these call sites is
 * shaped `if (!confirm(...)) return;` - and why nothing can animate, nothing
 * can be styled, and the buttons cannot be named.
 *
 * -- WHAT IS HERE -----------------------------------------------------
 *
 * The rules that decide how the dialog READS, with nothing about how it
 * looks. Two of them:
 *
 *   1. THE QUESTION BECOMES THE HEADING. Every one of these messages already
 *      opens with the question - "Publish version 6?", "Delete this line?" -
 *      and the rest explains it. So the first sentence is the title and the
 *      remainder is the body, which is the difference between a wall of text
 *      and a dialog.
 *
 *   2. NOTHING THE CALLER WROTE IS DROPPED. A confirm box that quietly loses
 *      half its warning is worse than the browser's, which at least showed
 *      all of it. `confirmShownText` recomposes what the dialog displays and
 *      the suite asserts it against the message, for every real message in
 *      the app.
 *
 * Pure. The component in components/ui/ConfirmDialog.tsx draws it.
 */

export type ConfirmTone = 'primary' | 'danger';

export interface ConfirmRequest {
  /** The whole thing, question first. Split into a heading and a body. */
  message: string;
  /** What the confirming button says. A verb, not "OK". */
  confirmLabel?: string;
  cancelLabel?: string;
  /** 'danger' for anything that destroys or freezes. Default 'primary'. */
  tone?: ConfirmTone;
  /** No cancel button: a message with nothing to decide (what alert() was). */
  tell?: boolean;
}

export interface ConfirmView {
  title: string;
  /** May be empty - "Delete this line?" is a whole question and no more. */
  body: string;
  confirmLabel: string;
  /** Empty when there is nothing to cancel. */
  cancelLabel: string;
  tone: ConfirmTone;
}

/** Used when the message asks no question we can lift out of it. */
export const DEFAULT_TITLE = 'Are you sure?';

/**
 * A question longer than this is a paragraph wearing a question mark, and
 * promoting it to a heading makes the dialog worse, not better.
 */
export const TITLE_MAX = 90;

function firstQuestion(msg: string): string {
  const i = msg.indexOf('?');
  if (i < 0) return '';
  const q = msg.slice(0, i + 1).trim();
  return q.length <= TITLE_MAX ? q : '';
}

/** How one request reads. Pure. */
export function confirmView(req: ConfirmRequest | null | undefined): ConfirmView {
  const msg = String(req?.message ?? '').trim();
  const tone: ConfirmTone = req?.tone === 'danger' ? 'danger' : 'primary';
  const q = firstQuestion(msg);
  const fallback = String(req?.confirmLabel ?? '').trim()
    || (req?.tell ? 'Close' : tone === 'danger' ? 'Delete' : 'Continue');
  return {
    title: q || DEFAULT_TITLE,
    body: (q ? msg.slice(q.length) : msg).trim(),
    confirmLabel: fallback,
    // A tell has one button, and it is the one that closes it. Offering
    // "Cancel" beside "Close" would be two words for the same click.
    cancelLabel: req?.tell ? '' : (String(req?.cancelLabel ?? '').trim() || 'Cancel'),
    tone,
  };
}

/**
 * Which button opens focused - which is to say, which one Enter presses.
 *
 * NEVER the destructive one. A dialog that appears under the cursor with
 * "Delete" pre-armed turns a stray Enter into a deletion, and the whole
 * point of asking was to put a step between the two. Dangerous questions
 * open on Cancel; ordinary ones open on the verb, because there the extra
 * keystroke is just friction.
 *
 * A message with nothing to decide has one button and it takes the focus
 * whatever the tone - there is nothing else to land on. Pure.
 */
export function confirmAutoFocus(v: ConfirmView): 'confirm' | 'cancel' {
  if (!v.cancelLabel) return 'confirm';
  return v.tone === 'danger' ? 'cancel' : 'confirm';
}

/**
 * Everything the dialog puts on screen, normalised. Exists so the suite can
 * assert guarantee 2 - that the split never drops a word - rather than
 * trusting the reading of it.
 */
export function confirmShownText(v: ConfirmView): string {
  const head = v.title === DEFAULT_TITLE ? '' : v.title;
  return `${head} ${v.body}`.replace(/\s+/g, ' ').trim();
}

/** The same normalisation, for the message side of that assertion. */
export function normaliseMessage(msg: string | null | undefined): string {
  return String(msg ?? '').replace(/\s+/g, ' ').trim();
}

// ---- asking for a word, not a yes ---------------------------------------
//
// window.prompt is the last native dialog in the app. It is the same grey box
// as confirm(), with an unlabelled text field, an OK that does not say what it
// will do, and no way to tell somebody their answer is empty or too long
// before they press it. "Rename brand" deserves better than that.
//
// Everything about how it READS lives here, next to confirmView, so a prompt
// and a confirm cannot come to look like two different products.

export interface PromptRequest extends ConfirmRequest {
  /** The word above the field. Falls back to the title's question. */
  label?: string;
  /** What the field starts with. */
  initial?: string;
  placeholder?: string;
  /** Empty is refused. Default true - a prompt with no answer is a cancel. */
  required?: boolean;
  /** Refused past this. 0 or absent means no limit. */
  maxLength?: number;
}

export interface PromptView extends ConfirmView {
  label: string;
  initial: string;
  placeholder: string;
}

export function promptView(req: PromptRequest | null | undefined): PromptView {
  const base = confirmView({ ...(req ?? { message: '' }), tell: false });
  return {
    ...base,
    // A prompt's verb is never "Continue" - it is doing something to a name.
    confirmLabel: String(req?.confirmLabel ?? '').trim() || 'Save',
    label: String(req?.label ?? '').trim() || base.title,
    initial: String(req?.initial ?? ''),
    placeholder: String(req?.placeholder ?? ''),
  };
}

/**
 * What is wrong with what has been typed, in words, or '' when nothing is.
 *
 * Checked as they type rather than after they press the button, which is the
 * thing window.prompt could not do at all: its only answer to an empty string
 * was to hand it back to the caller and let the caller decide, silently.
 * Pure.
 */
export function promptError(value: string, req?: PromptRequest | null): string {
  const v = String(value ?? '').trim();
  const required = req?.required !== false;
  if (required && !v) return 'Type something first.';
  const max = Math.trunc(Number(req?.maxLength ?? 0));
  if (max > 0 && v.length > max) {
    return `${max} characters at most - that is ${v.length - max} too many.`;
  }
  return '';
}

/**
 * Whether Save is live. Separate from promptError so the button and the
 * message cannot disagree about it: one of them saying yes while the other
 * says no is the bug this exists to make impossible.
 */
export function promptCanSubmit(value: string, req?: PromptRequest | null): boolean {
  return promptError(value, req) === '';
}

/**
 * The answer, or null for "nothing changed - treat it as a cancel".
 *
 * Renaming a brand to the name it already has is not a rename, and the old
 * call site said so itself (`next.trim() === b.brand_name` fell through to a
 * return). Putting it here means every caller gets it, and the trimming
 * happens once rather than at each of them. Pure.
 */
export function promptAnswer(value: string, initial?: string | null): string | null {
  const v = String(value ?? '').trim();
  if (!v) return null;
  return v === String(initial ?? '').trim() ? null : v;
}
