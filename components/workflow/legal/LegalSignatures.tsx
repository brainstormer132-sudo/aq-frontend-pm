'use client';

import { useEffect, useMemo, useState } from 'react';
import { useContracts, useExternalDocs, useSignedReviews } from '@/hooks/use-legal';
import { signedTally, awaitingSignature } from '@/lib/legal-signed';
import { reviewTally } from '@/lib/legal-review';
import { externalTally } from '@/lib/legal-external';
import { AqDrawingBlock } from '@/components/AQLoading';

/**
 * Signatures: the checklist. What is out, what is waiting to be looked at,
 * and what is about to run out.
 *
 * -- WHAT THIS SCREEN STOPPED BEING ---------------------------------
 *
 * It used to hold the documents themselves: the register of agreements filed
 * from outside, and the queue of signed copies sent back. Siraj, looking at
 * it: *"you cant check the contract / contract details and id rather it be in
 * the register rather than its own place"*.
 *
 * He was right, and migration 118 had said so first - external_doc was
 * created for agreements filed "so the register is complete", and then built
 * onto this screen, so the register was never complete. Deciding whether a
 * signed copy is good also meant looking at the contract it is a copy OF,
 * which was on a different screen entirely.
 *
 * So the documents moved to the Register, where they belong, and the decision
 * went with them onto the row it is about. What is left here is the thing a
 * checklist is for: the NUMBERS, and the one list nothing else shows - what
 * went out and has not come back. Every number links into the Register
 * filtered to itself, so this is a way in rather than a second copy.
 *
 * It answers the first of the three checklists Siraj wrote out:
 *
 *   1. signed contracts     <- here
 *   2. legal cases          <- the Cases screen
 *   3. collection           <- the Cases screen
 */

/** Rendered rows, per the rule every list in this app now follows. */
const SHOW_MAX = 200;

export function LegalSignatures({ workspaceId, onOpenRegister }: {
  workspaceId?: string;
  /** Takes you to the Register, filtered. Every number here is a way in. */
  onOpenRegister?: (filter: 'review' | 'filed' | '') => void;
}) {
  const { contracts, loading: cLoading } = useContracts(workspaceId ?? null);
  const ext = useExternalDocs(workspaceId ?? null);
  const rev = useSignedReviews(workspaceId ?? null);

  // Today as an ISO date, once, so every row on this render is judged against
  // the same day. Reading the clock per row is how a list sorted at midnight
  // ends up with two different todays in it.
  // Set in an effect, not read during render. A useMemo with an empty dep
  // list still runs during the FIRST render, so this is a clock read on the
  // server as well as the browser - and across midnight the two disagree and
  // React reports a hydration mismatch. It decides the "N expired / N
  // expiring soon" badges, so the mismatch is visible.
  const [today, setToday] = useState('');
  useEffect(() => { setToday(new Date().toISOString().slice(0, 10)); }, []);

  const tally = useMemo(() => signedTally(contracts as any), [contracts]);
  const waiting = useMemo(() => awaitingSignature(contracts as any), [contracts]);
  const filedTally = useMemo(() => externalTally(ext.docs, today), [ext.docs, today]);
  // The one number that is not about contracts this app issued: signed copies
  // somebody outside sent back that nobody has decided on.
  const reviewCount = useMemo(() => reviewTally(rev.uploads as any).pending, [rev.uploads]);

  return (
    <div className="aq-view" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* The numbers first. `waiting` is the working one - what went out and
          has not come back - because "issued" says how much was sent, not how
          much is outstanding. */}
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 13,
        color: 'var(--aq-text-secondary)' }}>
        <span><b style={{ fontSize: 16 }}>{tally.signed}</b> contracts signed</span>
        <span>
          <b style={{ fontSize: 16, color: tally.awaiting ? 'var(--aq-warning, #a86200)' : undefined }}>
            {tally.awaiting}
          </b> waiting to come back
        </span>
        {/* Every number is a way into the Register, filtered to itself.
            That is what keeps this a checklist rather than a second copy of
            the register showing the same rows a different way. */}
        <span role="button" tabIndex={0} style={{ cursor: onOpenRegister ? 'pointer' : 'default' }}
          onClick={() => onOpenRegister?.('filed')}
          onKeyDown={(e) => { if (e.key === 'Enter') onOpenRegister?.('filed'); }}>
          <b style={{ fontSize: 16 }}>{filedTally.filed}</b> filed from outside
        </span>
        {reviewCount > 0 && (
          <span role="button" tabIndex={0} style={{ cursor: onOpenRegister ? 'pointer' : 'default' }}
            onClick={() => onOpenRegister?.('review')}
            onKeyDown={(e) => { if (e.key === 'Enter') onOpenRegister?.('review'); }}>
            <b style={{ fontSize: 16, color: 'var(--aq-warning, #a86200)' }}>{reviewCount}</b>
            {' '}signed {reviewCount === 1 ? 'copy' : 'copies'} to look at
          </span>
        )}
        {filedTally.expired > 0 && (
          <span className="aq-badge aq-badge-error">{filedTally.expired} expired</span>
        )}
        {filedTally.expiring > 0 && (
          <span className="aq-badge aq-badge-warning">{filedTally.expiring} expiring soon</span>
        )}
      </div>

      <p style={{ fontSize: 12.5, color: 'var(--aq-text-muted)', marginTop: -6 }}>
        The documents themselves live in the <strong>Register</strong> {'\u2014'} filing one,
        opening one, and accepting or rejecting a signed copy all happen there, beside
        the contract they are about.
      </p>

      {/* A sentence, so a <div role="alert"> and not an `aq-badge`: the badge
          class uppercases its contents, which turns "Could not open that
          document." into shouting. Badges are for one or two words - the
          "3 expired" chips above are what they are for. */}
      {(ext.error || rev.error) && (
        <div role="alert" style={{
          background: 'var(--aq-red-bg)', border: '1px solid var(--aq-red-border)',
          color: 'var(--aq-red-strong)', padding: '10px 12px',
          borderRadius: 'var(--aq-radius)', fontSize: 12.5,
        }}>{ext.error || rev.error}</div>
      )}


      {/* -- out for signature ---------------------------------------- */}
      <section className="aq-card" style={{ padding: 18 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Waiting to come back</h3>
        <p style={{ fontSize: 12.5, color: 'var(--aq-text-muted)', marginBottom: 12 }}>
          Issued and not signed yet, oldest first - the one at the top has been out longest.
        </p>
        {cLoading ? (
          <AqDrawingBlock label={'Loading contracts\u2026'} />
        ) : waiting.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--aq-text-secondary)' }}>
            {tally.issued ? 'Everything issued has come back signed.' : 'Nothing has been issued yet.'}
          </p>
        ) : (
          <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column' }}>
            {waiting.slice(0, SHOW_MAX).map((c: any, i: number) => (
              <li key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 12,
                padding: '8px 2px', borderTop: i === 0 ? 'none' : '1px solid var(--aq-border-light)' }}>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span dir="auto" style={{ fontSize: 13.5, fontWeight: 600, display: 'block' }}>
                    {c.title || '(untitled)'}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--aq-text-muted)' }}>
                    {c.contract_no ? <code style={{ direction: 'ltr' }}>{c.contract_no}</code> : null}
                    {c.created_at ? ` \u00b7 issued ${new Date(c.created_at).toLocaleDateString()}` : ''}
                  </span>
                </span>
                <span className="aq-badge aq-badge-warning">Out</span>
              </li>
            ))}
          </ul>
        )}
        {waiting.length > SHOW_MAX && (
          <p style={{ fontSize: 12.5, color: 'var(--aq-text-muted)', marginTop: 10 }}>
            Showing the oldest {SHOW_MAX} of {waiting.length}.
          </p>
        )}
      </section>

    </div>
  );
}
