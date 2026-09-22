'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  confirmView, confirmAutoFocus, type ConfirmRequest, type ConfirmView,
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

export function useConfirm() {
  const [view, setView] = useState<ConfirmView | null>(null);
  const decide = useRef<((ok: boolean) => void) | null>(null);

  /** Answer whatever is open, once, and forget it. */
  const settle = useCallback((ok: boolean) => {
    const d = decide.current;
    decide.current = null;
    d?.(ok);
  }, []);

  const ask = useCallback((req: ConfirmRequest | string): Promise<boolean> => {
    const r: ConfirmRequest = typeof req === 'string' ? { message: req } : req;
    // 1. A second question answers the first rather than orphaning it.
    settle(false);
    setView(confirmView(r));
    return new Promise<boolean>((resolve) => { decide.current = resolve; });
  }, [settle]);

  const tell = useCallback(
    (message: string) => ask({ message, tell: true }).then(() => undefined),
    [ask],
  );

  const answer = useCallback((ok: boolean) => { setView(null); settle(ok); }, [settle]);

  // 1, again: unmounting with a question open answers it. Without this the
  // caller's `await` never returns and its `finally` never runs.
  useEffect(() => () => { settle(false); }, [settle]);

  return {
    ask,
    tell,
    dialog: view ? <ConfirmDialog view={view} onAnswer={answer} /> : null,
  };
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
