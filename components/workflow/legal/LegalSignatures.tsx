'use client';

import { useEffect, useMemo, useState } from 'react';
import { useContracts, useExternalDocs, signedCopyUrl } from '@/hooks/use-legal';
import { DOC_KINDS } from '@/lib/legal';
import { signedTally, awaitingSignature } from '@/lib/legal-signed';
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

      {err && <div className="aq-badge aq-badge-error" style={{ display: 'block', padding: 10 }}>{err}</div>}
      {ext.error && <div className="aq-badge aq-badge-error" style={{ display: 'block', padding: 10 }}>{ext.error}</div>}

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
