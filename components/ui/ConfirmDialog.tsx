'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  confirmView, confirmAutoFocus, promptView, promptError, promptCanSubmit, promptAnswer,
  type ConfirmRequest, type ConfirmView, type PromptRequest, type PromptView,
} from '@/lib/confirm';

/**
 * The app's own "are you sure?", in place of the browser's.
 *
 * Siraj, at the template editor: "fix this add an actual thing" - with the
 * Chrome dialog on screen, the one headed "aq-frontend-pm-kt6t.vercel.app
 * says" with an unlabelled OK under a careful three-sentence warning.
 *
 * -- HOW A CALL SITE CHANGES ------------------------------------------
 *
 *   const { ask, tell, dialog } = useConfirm();
 *   ...
 *   const doPublish = async () => {
 *     if (!await ask({ message: publishWarning(v, n), confirmLabel: 'Publish' })) return;
 *     ed.publish();
 *   };
 *   ...
 *   return (<div>{dialog}...</div>);
 *
 * The shape is the same `if (!...) return;` it replaces, one `await` longer,
 * so nothing about the surrounding logic has to be rethought. `dialog` is
 * rendered once anywhere in the component; it is null while nothing is being
 * asked.
 *
 * `tell(msg)` is what alert() was: one button, nothing to decide.
 * `prompt(req)` is what window.prompt was: a field, and a Save that stays
 * dead until the answer is usable.
 *
 * -- THE THREE THINGS THAT GO WRONG WITH A HAND-ROLLED CONFIRM --------
 *
 *   1. A PROMISE THAT NEVER SETTLES. If the dialog can leave the screen by
 *      any route that does not answer it - a second question, the component
 *      unmounting mid-question - the awaiting caller stops there for good,
 *      with no error and nothing on screen. Both routes answer `false` here.
 *   2. ENTER DELETING SOMETHING. Handled in lib/confirm's confirmAutoFocus
 *      and asserted there: a dangerous dialog opens focused on Cancel.
 *   3. THE WARNING BECOMING A WALL. The question is the heading and the rest
 *      is the body - lib/confirm again, where it is tested against every
 *      real message in the app.
 *
 * The shell is the house modal: role=dialog, a backdrop that closes, an
 * .aq-card inside. Same as ManagedListsModal and the rest.
 */

type Open =
  | { kind: 'confirm'; view: ConfirmView }
  | { kind: 'prompt'; view: PromptView; req: PromptRequest };

export function useConfirm() {
  const [open, setOpen] = useState<Open | null>(null);
  // One ref for both shapes: a confirm resolves false, a prompt resolves null,
  // and `empty` is what each of them calls "no".
  const decide = useRef<((v: any) => void) | null>(null);
  const empty = useRef<any>(false);

  /** Answer whatever is open, once, and forget it. */
  const settle = useCallback((v: any) => {
    const d = decide.current;
    decide.current = null;
    d?.(v);
  }, []);

  /** Close whatever is open the way a cancel would. */
  const settleEmpty = useCallback(() => { settle(empty.current); }, [settle]);

  const ask = useCallback((req: ConfirmRequest | string): Promise<boolean> => {
    const r: ConfirmRequest = typeof req === 'string' ? { message: req } : req;
    // 1. A second question answers the first rather than orphaning it.
    settleEmpty();
    empty.current = false;
    setOpen({ kind: 'confirm', view: confirmView(r) });
    return new Promise<boolean>((resolve) => { decide.current = resolve; });
  }, [settleEmpty]);

  const tell = useCallback(
    (message: string) => ask({ message, tell: true }).then(() => undefined),
    [ask],
  );

  /**
   * Ask for a word. Resolves the trimmed answer, or null for cancel AND for
   * "they typed what was already there", which is not a change - see
   * promptAnswer. So a caller can do `const name = await prompt(...); if
   * (!name) return;` and have both cases covered by one line.
   */
  const prompt = useCallback((req: PromptRequest): Promise<string | null> => {
    settleEmpty();
    empty.current = null;
    setOpen({ kind: 'prompt', view: promptView(req), req });
    return new Promise<string | null>((resolve) => { decide.current = resolve; });
  }, [settleEmpty]);

  const answer = useCallback((v: any) => { setOpen(null); settle(v); }, [settle]);

  // 1, again: unmounting with a question open answers it. Without this the
  // caller's `await` never returns and its `finally` never runs.
  useEffect(() => () => { settleEmpty(); }, [settleEmpty]);

  const dialog = !open ? null
    : open.kind === 'prompt'
      ? <PromptDialog view={open.view} req={open.req} onAnswer={answer} />
      : <ConfirmDialog view={open.view} onAnswer={answer} />;

  return { ask, tell, prompt, dialog };
}

export function ConfirmDialog({
  view, onAnswer,
}: { view: ConfirmView; onAnswer: (ok: boolean) => void }) {
  const focusOn = confirmAutoFocus(view);
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const el = focusOn === 'cancel' ? cancelRef.current : confirmRef.current;
    el?.focus();
  }, [focusOn]);

  // Escape answers no, wherever the focus is. Enter is left to the browser:
  // it presses the focused button, which is the one confirmAutoFocus chose.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onAnswer(false); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onAnswer]);

  return (
    <div role="dialog" aria-modal="true" aria-label={view.title} style={{
      position: 'fixed', inset: 0, background: 'var(--aq-backdrop, rgba(0,0,0,0.4))',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: 16,
    }} onClick={() => onAnswer(false)}>
      <div className="aq-card" onClick={(e) => e.stopPropagation()}
        style={{ padding: 22, width: 'min(460px, 100%)', display: 'flex',
          flexDirection: 'column', gap: 12 }}>
        <h3 dir="auto" style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.35 }}>{view.title}</h3>
        {view.body && (
          <p dir="auto" style={{ fontSize: 13.5, lineHeight: 1.55, color: 'var(--aq-text-secondary)' }}>
            {view.body}
          </p>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          {view.cancelLabel && (
            <button ref={cancelRef} className="aq-btn aq-btn-ghost"
              onClick={() => onAnswer(false)}>{view.cancelLabel}</button>
          )}
          <button ref={confirmRef}
            className={`aq-btn ${view.tone === 'danger' ? 'aq-btn-danger' : 'aq-btn-primary'}`}
            onClick={() => onAnswer(true)}>{view.confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

/**
 * The same dialog with a field in it, in place of window.prompt.
 *
 * What the native one could not do, and this is the only reason it is worth
 * replacing:
 *
 *   * SAY WHAT IS WRONG BEFORE THE BUTTON IS PRESSED. An empty answer came
 *     back as an empty string and each caller decided silently what to do
 *     with it. Here Save is dead and the reason is on screen while they type.
 *   * NAME ITS OWN BUTTON. "Save", or whatever the caller calls it.
 *   * SELECT WHAT IS THERE. Renaming is usually replacing, so the existing
 *     value opens selected and typing over it just works.
 *
 * Enter submits when the answer is usable, Escape cancels. The rules are all
 * in lib/confirm (promptError / promptCanSubmit / promptAnswer) where they
 * are asserted; this decides what it looks like and nothing else.
 */
export function PromptDialog({
  view, req, onAnswer,
}: {
  view: PromptView;
  req: PromptRequest;
  onAnswer: (v: string | null) => void;
}) {
  const [value, setValue] = useState(view.initial);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    // Selected, not just focused: the field usually opens holding the thing
    // being replaced.
    el.select();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onAnswer(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onAnswer]);

  const err = promptError(value, req);
  const canSave = promptCanSubmit(value, req);
  // promptAnswer returns null for "what was already there", so retyping the
  // same name closes the box without a write.
  const save = () => { if (canSave) onAnswer(promptAnswer(value, view.initial)); };

  return (
    <div role="dialog" aria-modal="true" aria-label={view.title} style={{
      position: 'fixed', inset: 0, background: 'var(--aq-backdrop, rgba(0,0,0,0.4))',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: 16,
    }} onClick={() => onAnswer(null)}>
      <div className="aq-card" onClick={(e) => e.stopPropagation()}
        style={{ padding: 22, width: 'min(460px, 100%)', display: 'flex',
          flexDirection: 'column', gap: 12 }}>
        <h3 dir="auto" style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.35 }}>{view.title}</h3>
        {view.body && (
          <p dir="auto" style={{ fontSize: 13.5, lineHeight: 1.55, color: 'var(--aq-text-secondary)' }}>
            {view.body}
          </p>
        )}
        <label style={{ display: 'block' }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 4 }}>{view.label}</div>
          <input ref={inputRef} dir="auto" className="aq-input" value={value}
            placeholder={view.placeholder} style={{ width: '100%' }}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } }} />
        </label>
        {/* The reason Save is dead, while they type - not after they click. */}
        <div style={{ fontSize: 11.5, minHeight: 15,
          color: err ? 'var(--aq-error, #c0392b)' : 'var(--aq-text-muted)' }}>{err}</div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="aq-btn aq-btn-ghost"
            onClick={() => onAnswer(null)}>{view.cancelLabel}</button>
          <button className="aq-btn aq-btn-primary" disabled={!canSave}
            onClick={save}>{view.confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
