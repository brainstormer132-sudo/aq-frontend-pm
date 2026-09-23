'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  useContracts, useExternalDocs, useSignedReviews, signedCopyUrl, reviewFileUrl,
} from '@/hooks/use-legal';
import { DOC_KINDS } from '@/lib/legal';
import { signedTally, awaitingSignature } from '@/lib/legal-signed';
import {
  reviewState, reviewLabel, reviewBadge, uploaderLabel,
  cannotAccept, cannotReject, reasonError, normaliseReason, reviewNote,
  reviewTally, pendingReview, decidedReview, filterReview, queueSummary,
  REJECT_REASONS, REASON_MAX,
} from '@/lib/legal-review';
import {
  externalState, externalBadge, externalLabel, externalNote,
  filterExternal, sortExternal, externalTally, validateExternalDoc,
  validateExternalFile, EXTERNAL_EXTENSIONS,
  filingDeleteWarning,
} from '@/lib/legal-external';
import { AqDrawingBlock } from '@/components/AQLoading';
import { ConfirmDelete } from '@/components/workflow/campaign/ui';

/**
 * Signatures: what is out, what came back, and what was filed from outside.
 *
 * This tab has been a placeholder since the section was built - "what is out
 * for signature, what is signed, and what is expiring" - and this is that.
 * It answers the first of the three checklists Siraj wrote out:
 *
 *   1. signed contracts     <- here
 *   2. legal cases          <- the Cases screen
 *   3. collection           <- the Cases screen
 *
 * TWO LISTS, ONE SCREEN, because they answer one question from two sides.
 * WAITING is contracts this app issued that have not come back; FILED is
 * agreements it never made - an office lease, an NDA somebody else drafted, a
 * client MSA that predates all of this. Keeping them on separate screens
 * would mean "is this signed?" had two places to look and no place that
 * knew both.
 *
 * They stay separate TABLES though (118 says why), so nothing here pretends
 * a lease has a contract number.
 */

/** Rendered rows, per the rule every list in this app now follows. */
const SHOW_MAX = 200;

export function LegalSignatures({ workspaceId }: { workspaceId?: string }) {
  const { contracts, loading: cLoading } = useContracts(workspaceId ?? null);
  const ext = useExternalDocs(workspaceId ?? null);

  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState('');
  // Was a window.confirm that named the filing but said nothing about the
  // FILE - and the uploaded document is the part that cannot be recovered.
  // Keyed by id, because this is a list: one panel, under the row it belongs
  // to. See filingDeleteWarning.
  const [confirmId, setConfirmId] = useState('');

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
  const filed = useMemo(
    () => sortExternal(filterExternal(ext.docs, q, kind), today),
    [ext.docs, q, kind, today],
  );
  const filedTally = useMemo(() => externalTally(ext.docs, today), [ext.docs, today]);

  const open = async (path: string, name?: string | null) => {
    setErr('');
    const url = await signedCopyUrl(path, name);
    if (url) window.open(url, '_blank');
    else setErr('Could not open that document.');
  };

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
        <span><b style={{ fontSize: 16 }}>{filedTally.filed}</b> filed from outside</span>
        {filedTally.expired > 0 && (
          <span className="aq-badge aq-badge-error">{filedTally.expired} expired</span>
        )}
        {filedTally.expiring > 0 && (
          <span className="aq-badge aq-badge-warning">{filedTally.expiring} expiring soon</span>
        )}
      </div>

      {/* A sentence, so a <div role="alert"> and not an `aq-badge`: the badge
          class uppercases its contents, which turns "Could not open that
          document." into shouting. Badges are for one or two words - the
          "3 expired" chips above are what they are for. */}
      {(err || ext.error) && (
        <div role="alert" style={{
          background: 'var(--aq-red-bg)', border: '1px solid var(--aq-red-border)',
          color: 'var(--aq-red-strong)', padding: '10px 12px',
          borderRadius: 'var(--aq-radius)', fontSize: 12.5,
        }}>{err || ext.error}</div>
      )}

      {/* -- sent back from outside, awaiting a decision --------------- */}
      <SentBack workspaceId={workspaceId} />


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

      {/* -- filed from outside --------------------------------------- */}
      <section className="aq-card" style={{ padding: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 4 }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, flex: '0 0 auto' }}>Filed from outside</h3>
          <span style={{ flex: 1, minWidth: 0 }} />
          <button className="aq-btn aq-btn-primary" style={{ flex: '0 0 auto' }}
            onClick={() => { setErr(''); setAdding(true); }}>
            File an agreement
          </button>
        </div>
        <p style={{ fontSize: 12.5, color: 'var(--aq-text-muted)', marginBottom: 12 }}>
          Anything this app did not generate - a lease, an NDA somebody else drafted, a client
          MSA signed before any of this. No number and no fingerprint, because we did not draft it.
        </p>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
          <input className="aq-input" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name, other side or reference"
            style={{ flex: '1 1 auto', minWidth: 0 }} />
          <select className="aq-select" value={kind} onChange={(e) => setKind(e.target.value)}
            style={{ flex: '0 0 auto', width: 'auto', minWidth: 150 }}>
            <option value="">All kinds</option>
            {DOC_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
          </select>
        </div>

        {ext.loading ? (
          <AqDrawingBlock label={'Loading filed agreements\u2026'} />
        ) : filed.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--aq-text-secondary)' }}>
            {ext.docs.length ? 'Nothing matches that.' : 'Nothing filed from outside yet.'}
          </p>
        ) : (
          <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column' }}>
            {filed.slice(0, SHOW_MAX).map((d, i) => {
              const st = externalState(d, today);
              // flexWrap so the confirm panel below can take a line of its
              // own rather than being squeezed into the row.
              return (
                <li key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
                  padding: '9px 2px', borderTop: i === 0 ? 'none' : '1px solid var(--aq-border-light)' }}>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span dir="auto" style={{ fontSize: 13.5, fontWeight: 600, display: 'block' }}>
                      {d.title}
                    </span>
                    <span dir="auto" style={{ fontSize: 12, color: 'var(--aq-text-muted)' }}>
                      {externalNote(d)}
                      {d.expires_on ? ` \u00b7 expires ${new Date(`${d.expires_on}T00:00:00`).toLocaleDateString()}` : ''}
                    </span>
                  </span>
                  <span className={`aq-badge ${externalBadge(st)}`}>{externalLabel(st)}</span>
                  <button className="aq-btn aq-btn-ghost" style={{ padding: '4px 10px' }}
                    onClick={() => open(String(d.file_path), d.file_name)}>Open</button>
                  <button className="aq-btn aq-btn-ghost" style={{ padding: '4px 8px' }}
                    title="Remove this filing and its document"
                    onClick={() => setConfirmId(d.id)}>&times;</button>
                  {confirmId === d.id && (
                    <div style={{ flexBasis: '100%' }}>
                      <ConfirmDelete message={filingDeleteWarning(d)} confirmLabel="Yes, remove it"
                        onCancel={() => setConfirmId('')}
                        onConfirm={async () => {
                          setConfirmId('');
                          setErr('');
                          try { await ext.remove(d); }
                          catch (e: any) { setErr(e?.message ?? 'Could not remove it.'); }
                        }} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {filed.length > SHOW_MAX && (
          <p style={{ fontSize: 12.5, color: 'var(--aq-text-muted)', marginTop: 10 }}>
            Showing {SHOW_MAX} of {filed.length}. Search to narrow it.
          </p>
        )}
      </section>

      {adding && (
        <FileAgreement
          onCancel={() => setAdding(false)}
          onFile={async (v) => { await ext.file(v); setAdding(false); }} />
      )}
    </div>
  );
}

/**
 * The filing form.
 *
 * The file is required and is picked LAST, because choosing it is the
 * commitment: everything above it can be typed and retyped, and a form that
 * uploads the moment a file is chosen has no cancel.
 */
function FileAgreement({ onCancel, onFile }: {
  onCancel: () => void;
  onFile: (v: {
    title: string; doc_kind: string; party_name: string; reference: string;
    signed_on: string | null; expires_on: string | null; notes: string; fileObj: File;
  }) => Promise<void>;
}) {
  const [title, setTitle] = useState('');
  const [docKind, setDocKind] = useState('other');
  const [party, setParty] = useState('');
  const [reference, setReference] = useState('');
  const [signedOn, setSignedOn] = useState('');
  const [expiresOn, setExpiresOn] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const formErr = validateExternalDoc({
    title, doc_kind: docKind, signed_on: signedOn || null, expires_on: expiresOn || null,
  });

  const label = { display: 'block', fontSize: 12, fontWeight: 600,
    color: 'var(--aq-text-muted)', marginBottom: 4 } as const;

  return (
    <div role="dialog" aria-modal="true" style={{
      position: 'fixed', inset: 0, background: 'var(--aq-backdrop, rgba(0,0,0,0.4))',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16,
      overflowY: 'auto',
    }} onClick={() => !busy && onCancel()}>
      <div className="aq-card" style={{ padding: 22, width: 'min(560px, 100%)' }}
        onClick={(e) => e.stopPropagation()}>
        <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>File an agreement</h3>

        <label style={label}>What is it?</label>
        <input dir="auto" className="aq-input" value={title} autoFocus
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Adex Tower office lease" style={{ width: '100%' }} />

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
          <div style={{ flex: '1 1 200px', minWidth: 0 }}>
            <label style={label}>Kind</label>
            <select className="aq-select" value={docKind}
              onChange={(e) => setDocKind(e.target.value)} style={{ width: '100%' }}>
              {DOC_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
            </select>
          </div>
          <div style={{ flex: '1 1 200px', minWidth: 0 }}>
            <label style={label}>Other side</label>
            <input dir="auto" className="aq-input" value={party}
              onChange={(e) => setParty(e.target.value)}
              placeholder="Who it is with" style={{ width: '100%' }} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
          <div style={{ flex: '1 1 150px', minWidth: 0 }}>
            <label style={label}>Signed on</label>
            <input className="aq-input" type="date" value={signedOn}
              onChange={(e) => setSignedOn(e.target.value)}
              title="Leave it empty if it is on file but not signed" style={{ width: '100%' }} />
          </div>
          <div style={{ flex: '1 1 150px', minWidth: 0 }}>
            <label style={label}>Expires</label>
            <input className="aq-input" type="date" value={expiresOn}
              onChange={(e) => setExpiresOn(e.target.value)}
              title="So it shows up before it runs out" style={{ width: '100%' }} />
          </div>
          <div style={{ flex: '1 1 150px', minWidth: 0 }}>
            <label style={label}>Their reference</label>
            <input dir="auto" className="aq-input" value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="If it has one" style={{ width: '100%' }} />
          </div>
        </div>

        <label style={{ ...label, marginTop: 12 }}>Notes</label>
        <textarea dir="auto" className="aq-input" rows={2} value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Anything the next person should know"
          style={{ width: '100%', resize: 'vertical' }} />

        {(err || (title.trim() && formErr)) && (
          <div className="aq-badge aq-badge-warning" style={{ display: 'block', marginTop: 12, padding: 8 }}>
            {err || formErr}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center', marginTop: 18 }}>
          <span style={{ flex: 1, minWidth: 0, fontSize: 11.5, color: 'var(--aq-text-muted)' }}>
            PDF, Word or a photo.
          </span>
          <button className="aq-btn aq-btn-ghost" disabled={busy} onClick={onCancel}>Cancel</button>
          {/* Picking the file IS the save - see the header. */}
          <label className="aq-btn aq-btn-primary"
            style={{ cursor: busy || formErr ? 'default' : 'pointer', opacity: busy || formErr ? 0.55 : 1 }}>
            {busy ? 'Filing\u2026' : 'Choose the file and save'}
            <input type="file" hidden disabled={busy || !!formErr}
              accept={EXTERNAL_EXTENSIONS.map((x) => `.${x}`).join(',')}
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.currentTarget.value = '';
                if (!f) return;
                const bad = validateExternalFile({ name: f.name, size: f.size });
                if (bad) { setErr(bad); return; }
                setBusy(true); setErr('');
                try {
                  await onFile({
                    title, doc_kind: docKind, party_name: party, reference,
                    signed_on: signedOn || null, expires_on: expiresOn || null,
                    notes, fileObj: f,
                  });
                } catch (e2: any) {
                  setErr(e2?.message ?? 'Could not file it.');
                } finally { setBusy(false); }
              }} />
          </label>
        </div>
      </div>
    </div>
  );
}

/**
 * The signed copies vendors and clients have sent back, and the decision on
 * each.
 *
 * Siraj: "add to the signiture a reject and accept based if a vendor or
 * client uploaded a contract signed and if rejected states why".
 *
 * -- WHY THIS IS A THIRD LIST AND NOT PART OF THE FIRST --------------
 *
 * "Waiting to come back" above is about contracts THIS app issued and has
 * heard nothing about. This is the opposite end: something has come back and
 * nobody here has looked at it. They are different jobs - one is chasing,
 * one is reviewing - and putting them in one list would mean the twenty
 * contracts nobody has to do anything about hid the two that need a decision
 * today.
 *
 * -- THE REASON IS THE POINT OF THE REJECTION ------------------------
 *
 * "Rejected" on its own sends somebody back to the beginning with no idea
 * what to change, and they upload the same file again. So the reason is
 * required, has a floor under it, and is what the sender reads in their
 * portal. The one-tap reasons are what make that floor painless - they are
 * what people actually mean, and without them a minimum length is a rule
 * that only ever bites the person trying to do the right thing.
 */
function SentBack({ workspaceId }: { workspaceId?: string }) {
  const { uploads, loading, error, accept, reject } = useSignedReviews(workspaceId ?? null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState('');
  const [rejecting, setRejecting] = useState('');
  const [rowErr, setRowErr] = useState<{ id: string; msg: string } | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  // ONE memo, and the subtree is keyed on which list is showing - the rule
  // this app learned from the ledger. Every number and every row on screen
  // comes from this one derivation, so the heading cannot disagree with what
  // is under it.
  const view = useMemo(() => {
    const tally = reviewTally(uploads as any);
    const queue = pendingReview(uploads as any);
    const history = filterReview(decidedReview(uploads as any), q);
    return { tally, queue, history, summary: queueSummary(uploads as any) };
  }, [uploads, q]);

  const fmt = (v: any) => (v ? new Date(v).toLocaleDateString() : '');

  const open = async (u: any) => {
    setRowErr(null);
    const url = await reviewFileUrl(String(u.storage_path ?? ''), u.original_filename);
    if (url) { window.open(url, '_blank'); return; }
    // Not a shrug. The contract app's bucket is service-role only, so this
    // is the expected answer there and the sentence has to say what to do.
    setRowErr({ id: u.id, msg: 'This app cannot open that file - it is in the contract app\u2019s'
      + ' storage, which only the backend can read. The decision below still records here.' });
  };

  const decide = async (u: any, fn: () => Promise<void>) => {
    setBusy(u.id); setRowErr(null);
    try { await fn(); setRejecting(''); }
    catch (e: any) { setRowErr({ id: u.id, msg: e?.message ?? 'That did not go through.' }); }
    finally { setBusy(''); }
  };

  const rowNote = (u: any) => reviewNote(u as any, {
    sent: fmt(u.created_at), decided: fmt(u.reviewed_at),
  });

  return (
    <section className="aq-card" style={{ padding: 18 }}>
      <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Sent back for review</h3>
      <p style={{ fontSize: 12.5, color: 'var(--aq-text-muted)', marginBottom: 12 }}>
        {loading ? 'Looking\u2026' : view.summary}
        {' '}Accepting one files it as the signed copy. Rejecting sends it back with your
        reason, which is what they read in their portal.
      </p>

      {error && (
        <div role="alert" style={{
          background: 'var(--aq-red-bg)', border: '1px solid var(--aq-red-border)',
          color: 'var(--aq-red-strong)', padding: '10px 12px',
          borderRadius: 'var(--aq-radius)', fontSize: 12.5, marginBottom: 10,
        }}>{error}</div>
      )}

      {loading ? (
        <AqDrawingBlock label={'Loading signed copies\u2026'} />
      ) : view.queue.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--aq-text-secondary)' }}>
          {view.tally.accepted + view.tally.rejected
            ? 'Everything that came back has been looked at.'
            : 'Nobody has sent a signed copy back yet.'}
        </p>
      ) : (
        <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column' }}>
          {view.queue.slice(0, SHOW_MAX).map((u: any, i: number) => (
            <li key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
              padding: '10px 2px', borderTop: i === 0 ? 'none' : '1px solid var(--aq-border-light)' }}>
              <span style={{ flex: 1, minWidth: 180 }}>
                <span dir="auto" style={{ fontSize: 13.5, fontWeight: 600, display: 'block' }}>
                  {u.contract_title || u.contract_id || '(no contract)'}
                </span>
                <span dir="auto" style={{ fontSize: 12, color: 'var(--aq-text-muted)' }}>
                  {u.contract_title && u.contract_id
                    ? <><code style={{ direction: 'ltr' }}>{u.contract_id}</code>{' \u00b7 '}</>
                    : null}
                  {rowNote(u)}
                </span>
              </span>
              <span className={`aq-badge ${reviewBadge(reviewState(u as any))}`}>
                {reviewLabel(reviewState(u as any))}
              </span>
              <button className="aq-btn aq-btn-ghost" style={{ padding: '4px 10px' }}
                onClick={() => open(u)}>Open</button>
              <button className="aq-btn aq-btn-primary" style={{ padding: '4px 12px' }}
                disabled={!!busy || !!cannotAccept(u as any)}
                title={cannotAccept(u as any) ?? 'File this as the signed copy'}
                onClick={() => decide(u, () => accept(u.id))}>
                {busy === u.id ? '\u2026' : 'Accept'}
              </button>
              <button className="aq-btn aq-btn-ghost" style={{ padding: '4px 12px' }}
                disabled={!!busy || !!cannotReject(u as any)}
                title={cannotReject(u as any) ?? 'Send it back with a reason'}
                onClick={() => { setRowErr(null); setRejecting(rejecting === u.id ? '' : u.id); }}>
                Reject
              </button>
              {rowErr && rowErr.id === u.id && (
                <div role="alert" style={{
                  flexBasis: '100%', background: 'var(--aq-amber-bg)',
                  border: '1px solid var(--aq-amber-border)', color: 'var(--aq-amber-deep)',
                  padding: '8px 10px', borderRadius: 'var(--aq-radius)',
                  fontSize: 12.5, marginTop: 2,
                }}>
                  {rowErr.msg}
                </div>
              )}
              {rejecting === u.id && (
                <div style={{ flexBasis: '100%' }}>
                  <RejectPanel who={uploaderLabel(u.uploader_role)} busy={busy === u.id}
                    onCancel={() => setRejecting('')}
                    onSend={(reason) => decide(u, () => reject(u.id, reason))} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {view.queue.length > SHOW_MAX && (
        <p style={{ fontSize: 12.5, color: 'var(--aq-text-muted)', marginTop: 10 }}>
          Showing the oldest {SHOW_MAX} of {view.queue.length}.
        </p>
      )}

      {/* The history is behind a click. It only grows - a rejected attempt is
          kept forever as the record of what was sent and why it came back -
          so it is the part of this screen that gets long, and it is never
          the reason somebody opened the page. */}
      {(view.tally.accepted + view.tally.rejected) > 0 && (
        <div style={{ marginTop: 14, borderTop: '1px solid var(--aq-border-light)', paddingTop: 12 }}>
          <button className="aq-btn aq-btn-ghost" style={{ padding: '4px 0', fontSize: 12.5 }}
            onClick={() => setShowHistory((v) => !v)}>
            {showHistory ? '\u25be' : '\u25b8'} {view.tally.accepted} accepted, {view.tally.rejected} sent back
          </button>
          {showHistory && (
            <div style={{ marginTop: 10 }}>
              <input className="aq-input" value={q} onChange={(e) => setQ(e.target.value)}
                placeholder="Search by contract, sender, file or reason"
                style={{ width: '100%', marginBottom: 10 }} />
              {view.history.length === 0 ? (
                <p style={{ fontSize: 13, color: 'var(--aq-text-secondary)' }}>Nothing matches that.</p>
              ) : (
                <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column' }}>
                  {view.history.slice(0, SHOW_MAX).map((u: any, i: number) => (
                    <li key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                      padding: '8px 2px', borderTop: i === 0 ? 'none' : '1px solid var(--aq-border-light)' }}>
                      <span style={{ flex: 1, minWidth: 180 }}>
                        <span dir="auto" style={{ fontSize: 13, fontWeight: 600, display: 'block' }}>
                          {u.contract_title || u.contract_id || '(no contract)'}
                        </span>
                        <span dir="auto" style={{ fontSize: 12, color: 'var(--aq-text-muted)' }}>
                          {rowNote(u)}
                        </span>
                        {u.rejection_reason && (
                          <span dir="auto" style={{ fontSize: 12, color: 'var(--aq-text-secondary)',
                            display: 'block', marginTop: 2 }}>
                            {'\u201c'}{u.rejection_reason}{'\u201d'}
                          </span>
                        )}
                      </span>
                      <span className={`aq-badge ${reviewBadge(reviewState(u as any))}`}>
                        {reviewLabel(reviewState(u as any))}
                      </span>
                      <button className="aq-btn aq-btn-ghost" style={{ padding: '4px 10px' }}
                        onClick={() => open(u)}>Open</button>
                      {/* An acceptance CAN be undone, with a reason, because
                          accepting is what marks a contract signed and "we
                          accepted the wrong scan" has to have a way out. */}
                      {reviewState(u as any) === 'accepted' && (
                        <button className="aq-btn aq-btn-ghost" style={{ padding: '4px 10px' }}
                          disabled={!!busy}
                          title="Take it back and tell them why"
                          onClick={() => { setRowErr(null); setRejecting(rejecting === u.id ? '' : u.id); }}>
                          Send it back
                        </button>
                      )}
                      {rowErr && rowErr.id === u.id && (
                        <div role="alert" style={{
                          flexBasis: '100%', background: 'var(--aq-amber-bg)',
                          border: '1px solid var(--aq-amber-border)', color: 'var(--aq-amber-deep)',
                          padding: '8px 10px', borderRadius: 'var(--aq-radius)',
                          fontSize: 12.5, marginTop: 2,
                        }}>
                          {rowErr.msg}
                        </div>
                      )}
                      {rejecting === u.id && (
                        <div style={{ flexBasis: '100%' }}>
                          <RejectPanel who={uploaderLabel(u.uploader_role)} busy={busy === u.id}
                            onCancel={() => setRejecting('')}
                            onSend={(reason) => decide(u, () => reject(u.id, reason))} />
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {view.history.length > SHOW_MAX && (
                <p style={{ fontSize: 12.5, color: 'var(--aq-text-muted)', marginTop: 10 }}>
                  Showing {SHOW_MAX} of {view.history.length}. Search to narrow it.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * Why it is going back.
 *
 * The one-tap reasons come first and the box comes second, because the
 * common case is one of six sentences and typing it out every time is how a
 * required field turns into "asdf". Tapping one fills the box rather than
 * submitting, so it can still be edited - "The scan is unreadable - page 3
 * especially" is a better reason than either half.
 */
function RejectPanel({ who, busy, onCancel, onSend }: {
  who: string; busy: boolean;
  onCancel: () => void;
  onSend: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  const bad = reasonError(reason);
  const clean = normaliseReason(reason);

  return (
    <div style={{ background: 'var(--aq-bg-sunken)', borderRadius: 'var(--aq-radius)',
      padding: 12, marginTop: 8 }}>
      <p style={{ fontSize: 12.5, color: 'var(--aq-text-secondary)', marginBottom: 8 }}>
        What should {who} fix? They read this.
      </p>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
        {REJECT_REASONS.map((r) => (
          <button key={r} type="button" className="aq-btn aq-btn-ghost"
            style={{ padding: '3px 9px', fontSize: 11.5 }}
            onClick={() => setReason(r)}>{r}</button>
        ))}
      </div>
      <textarea dir="auto" className="aq-input" rows={2} value={reason} autoFocus
        maxLength={REASON_MAX + 50}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Or say it in your own words"
        style={{ width: '100%', resize: 'vertical' }} />
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
        <span style={{ flex: 1, minWidth: 0, fontSize: 11.5,
          color: reason.trim() && bad ? 'var(--aq-error)' : 'var(--aq-text-muted)' }}>
          {reason.trim() && bad ? bad : 'They see this in their portal, next to the upload.'}
        </span>
        <button className="aq-btn aq-btn-ghost" disabled={busy} onClick={onCancel}>Cancel</button>
        <button className="aq-btn aq-btn-primary" disabled={busy || !!bad}
          onClick={() => onSend(clean)}>
          {busy ? 'Sending\u2026' : 'Send it back'}
        </button>
      </div>
    </div>
  );
}
