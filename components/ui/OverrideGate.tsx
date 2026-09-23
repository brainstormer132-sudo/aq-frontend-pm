'use client';

import { useState } from 'react';
import { useOverrideCode } from '@/hooks/use-overrides';
import { ruleByKey, reasonError, codeShapeError, REASON_MAX } from '@/lib/overrides';

/**
 * The panel a rule puts in front of somebody, and the way past it.
 *
 * Siraj: "every rule can be bypassed but will be documented".
 *
 * -- WHAT IT SAYS, IN ORDER -----------------------------------------
 *
 * What is wrong with THIS thing; why the rule exists; then the two boxes.
 * That order is the point. A gate that opens with "enter the code" teaches
 * people to reach for the code, and the reason box becomes a formality with
 * "asdf" in it. A gate that says what is missing first lets most people go
 * and fix it, which is the outcome the rule actually wants.
 *
 * -- WHY THE REASON COMES BEFORE THE CODE ---------------------------
 *
 * Same reasoning, one level down. Somebody who has typed a real sentence
 * about why they are doing this has already thought about it; somebody who
 * has typed the code has only remembered it.
 *
 * -- A WRONG CODE IS NOT AN ERROR -----------------------------------
 *
 * `pass` returns false, because the attempt has just been written to the log
 * and raising would have rolled that row back (migration 125). So a wrong
 * code says so plainly and says that it was recorded, because it was - and
 * somebody who knows the attempt is on the record behaves differently from
 * somebody who thinks a wrong guess is free.
 */
export function OverrideGate({
  workspaceId, ruleKey, blocked, entityKind, entityId, entityName, onPassed, onCancel,
}: {
  workspaceId: string;
  ruleKey: string;
  /** What is wrong with this particular thing. Falls back to the rule's own
   *  line when the caller has nothing more specific to say. */
  blocked?: string | null;
  entityKind?: string | null;
  entityId?: string | null;
  entityName?: string | null;
  onPassed: () => void | Promise<void>;
  onCancel: () => void;
}) {
  const { hasCode, pass } = useOverrideCode(workspaceId);
  const [reason, setReason] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const rule = ruleByKey(ruleKey);
  const badReason = reason ? reasonError(reason) : null;
  const badCode = code ? codeShapeError(code) : null;
  const ready = !reasonError(reason) && !codeShapeError(code);

  return (
    <div style={{ background: 'var(--aq-bg-sunken)', borderRadius: 'var(--aq-radius)',
      border: '1px solid var(--aq-amber-border, var(--aq-border))', padding: 12, marginTop: 8 }}>
      <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
        {blocked || rule?.blocked || 'A rule is stopping this.'}
      </p>
      {rule?.why && (
        <p style={{ fontSize: 12, color: 'var(--aq-text-muted)', marginBottom: 10, maxWidth: '62ch' }}>
          {rule.why}
        </p>
      )}

      {hasCode === false ? (
        // A different problem from a wrong code, and it sends the reader
        // somewhere useful instead of leaving them guessing at a code that
        // does not exist.
        <p style={{ fontSize: 12.5, color: 'var(--aq-text-secondary)' }}>
          No override code has been set, so this cannot be passed. An owner or
          an admin sets one in <strong>Settings</strong>, under &ldquo;Passing a rule&rdquo;.
        </p>
      ) : (
        <>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600,
            color: 'var(--aq-text-muted)', marginBottom: 4 }}>
            Why are you passing it?
          </label>
          <textarea dir="auto" className="aq-input" rows={2} value={reason} autoFocus
            maxLength={REASON_MAX + 50}
            onChange={(e) => setReason(e.target.value)}
            placeholder="This goes in the log with your name on it"
            style={{ width: '100%', resize: 'vertical' }} />

          <label style={{ display: 'block', fontSize: 12, fontWeight: 600,
            color: 'var(--aq-text-muted)', margin: '10px 0 4px' }}>
            The override code
          </label>
          <input className="aq-input" type="password" autoComplete="off"
            value={code} onChange={(e) => setCode(e.target.value)}
            style={{ width: '100%', maxWidth: 260 }} />

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
            <span style={{ flex: 1, minWidth: 180, fontSize: 11.5,
              color: msg || badReason || badCode ? 'var(--aq-error)' : 'var(--aq-text-muted)' }}>
              {msg || badReason || badCode
                || 'Passing this is recorded: you, the reason, and what it was.'}
            </span>
            <button className="aq-btn aq-btn-ghost" disabled={busy} onClick={onCancel}>Cancel</button>
            <button className="aq-btn aq-btn-primary" disabled={busy || !ready}
              onClick={async () => {
                setBusy(true); setMsg('');
                try {
                  const ok = await pass({
                    workspaceId, code, ruleKey,
                    entityKind: entityKind ?? null,
                    entityId: entityId ?? null,
                    entityName: entityName ?? null,
                    reason,
                  });
                  if (!ok) {
                    // Said plainly, and said that it counted. Somebody who
                    // knows the attempt is on the record behaves differently
                    // from somebody who thinks a wrong guess is free.
                    setMsg('That is not the code. The attempt was recorded.');
                    setCode('');
                    return;
                  }
                  await onPassed();
                } catch (e: any) {
                  // These come straight from the database - not a member, a
                  // reason under the floor, no code set, too many wrong
                  // codes - so the screen cannot drift from the rule.
                  setMsg(e?.message ?? 'That did not go through.');
                } finally { setBusy(false); }
              }}>
              {busy ? 'Checking…' : 'Pass the rule'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
