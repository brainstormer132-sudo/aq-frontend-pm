'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useContracts, usePublishedVersions, loadContractPrintDocs } from '@/hooks/use-legal';
import { kindLabel, contractStatusLabel, contractStatusBadge, CONTRACT_STATUSES, contractsPrintHTML } from '@/lib/legal';
import {
  filterContracts, toggleId, selectedInOrder, skippedNote, bulkPrintNote,
} from '@/lib/legal-bulk';
import {
  supersedeLinks, supersedeState, supersedeBadge, supersedeLabel,
} from '@/lib/legal-supersede';
import { signedTally, hasSignedCopy } from '@/lib/legal-signed';
import { AqDrawingBlock } from '@/components/AQLoading';
import {
  startPending, cancelPending, tickPending, flushPending, removedLabel,
  type Pending,
} from '@/lib/pending-removal';
import { UndoBar } from '@/components/workflow/campaign/ui';
import { ContractFill } from '@/components/workflow/legal/ContractFill';

/**
 * The Register: every contract generated from a template, each stamped to the
 * exact version it was made from. "New contract" starts one from a published
 * version and drops into the fill screen. A contract that is still a draft can
 * be reopened and edited; issued ones are frozen but still open read-only.
 *
 * -- PRINTING A STACK OF THEM --------------------------------------
 *
 * Siraj: "work on getting all pdfs at once also instead of going one by one".
 * Tick the ones you want - or Select all, which takes everything MATCHING the
 * search and status, not only the rows on screen - and they come out as one
 * document, one contract per page, through one Print dialog. The sheets are
 * built by the same function the fill screen's Print button uses; see
 * lib/legal-bulk for why that matters.
 */

/**
 * How many rows are rendered at once.
 *
 * Every screen in this app that broke this week broke the same way: fine with
 * twenty rows, frozen with four thousand. A register with every contract of a
 * year in it is four thousand list items and a browser that stops responding,
 * so the list stops at two hundred and says so. The SELECTION is not capped -
 * Select all takes every matching contract, printed or not shown.
 */
const SHOW_MAX = 200;

export function LegalRegister({ workspaceId }: { workspaceId?: string }) {
  const { contracts, loading, error, create, remove } = useContracts(workspaceId ?? null);
  const pub = usePublishedVersions(workspaceId ?? null);

  const [openId, setOpenId] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [versionId, setVersionId] = useState('');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState('');

  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [sel, setSel] = useState<string[]>([]);
  const [printing, setPrinting] = useState(false);
  const [note, setNote] = useState('');

  /* -- Deleting a draft, with a way back -----------------------------
   *
   * Was `confirm('Delete this draft contract?')`. Siraj: "fix delete showing
   * a popup on google it should be the same thing also as all tasks". The
   * campaign screens have answered this with an undo window for a while - a
   * dialog asks the same question forty times and trains you to click
   * through it. Same machine as the Tasks list; see lib/pending-removal. */
  const [pending, setPending] = useState<Pending[]>([]);
  const commit = useRef<(id: string) => void>(() => {});
  commit.current = (id: string) => { void remove(id); };

  useEffect(() => {
    if (!pending.length) return undefined;
    const t = setInterval(() => {
      setPending((list) => {
        const { next, due } = tickPending(list);
        for (const id of due) commit.current(id);
        return next;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [pending.length]);

  const onUnmount = useRef<() => void>(() => {});
  onUnmount.current = () => {
    const { due } = flushPending(pending);
    for (const id of due) commit.current(id);
  };
  useEffect(() => () => { onUnmount.current(); }, []);

  // The ids in their undo window, as a STABLE string. `pending` gets a new
  // array every second as the countdown ticks, so using it directly as a memo
  // dep would rebuild the whole view once a second.
  const pendingKey = pending.map((p) => p.id).sort().join(',');

  // One memo for the view, everything else derived from it. Two memos that
  // each filter would be two answers to "which contracts are we looking at",
  // and the count beside the button would eventually disagree with the rows.
  // The supersede arrows (116) cost nothing here: this screen already holds
  // every contract in the workspace, so the links are derived rather than
  // read. Outside the filter memo on purpose - they are a fact about the
  // whole register, not about what is currently on screen, and a batch print
  // has to know a contract was replaced even when the correction is filtered
  // out of view.
  const links = useMemo(() => supersedeLinks(contracts), [contracts]);

  // The signed-contracts checklist, as one line. `awaiting` is the working
  // number - what went out and has not come back - because "issued" on its
  // own says how much was sent, not how much is outstanding.
  const tally = useMemo(() => signedTally(contracts as any), [contracts]);

  const view = useMemo(() => {
    // A contract in its undo window is out of the view ENTIRELY, not just out
    // of the rendered slice. Filtering only the slice - which is what this did
    // when the undo window was added - left `view.rows` still holding it, so
    // "Select all 40" counted and selected a draft that was seconds from
    // deletion, Print would have fetched and printed it, "showing the first
    // 200 of N" was off by however many were pending, and deleting one row
    // left 199 on screen instead of pulling row 201 up.
    const gone = new Set(pendingKey ? pendingKey.split(',') : []);
    const live = gone.size ? contracts.filter((c: any) => !gone.has(c.id)) : contracts;
    const rows = filterContracts(live, q, status);
    return { rows, shown: rows.slice(0, SHOW_MAX), hidden: Math.max(0, rows.length - SHOW_MAX) };
  }, [contracts, q, status, pendingKey]);

  const picked = useMemo(() => selectedInOrder(view.rows, sel), [view.rows, sel]);

  if (openId) {
    return (
      // key={openId}: raising a correction swaps contractId on the SAME
      // mounted ContractFill, so its own state came with it - the correction
      // reason just typed, a signing date meant for the previous contract, a
      // "Saved." banner, and a dateStamped flag that stopped the new draft
      // being dated at all. Keying it remounts instead.
      <ContractFill key={openId} workspaceId={workspaceId} contractId={openId}
        onBack={() => setOpenId(null)} onOpen={(id) => setOpenId(id)} />
    );
  }

  const startNew = async () => {
    const v = pub.versions.find((x) => x.version_id === versionId);
    if (!v) { setFormErr('Pick a template.'); return; }
    if (!title.trim()) { setFormErr('Give the contract a title.'); return; }
    setBusy(true); setFormErr('');
    try {
      const id = await create(v.version_id, v.template_id, title);
      setPicking(false); setTitle(''); setVersionId('');
      setOpenId(id);
    } catch (e: any) {
      setFormErr(e?.message ?? 'Could not create the contract.');
    } finally { setBusy(false); }
  };

  /**
   * Every ticked contract as one printable document, handed to the browser's
   * Print / Save as PDF. Two reads however many contracts - see
   * loadContractPrintDocs - then one window.
   *
   * A contract whose version has no content is LEFT OUT and named. The
   * alternative is a blank page with a letterhead on it going out as an
   * agreement, which is the sort of thing nobody notices until a vendor asks
   * what they are supposed to sign.
   */
  const printPicked = async () => {
    if (!picked.length || printing) return;
    setPrinting(true); setNote('');
    try {
      const built = await loadContractPrintDocs(picked, (m) => setNote(m), links);
      const left = skippedNote(built.skipped);
      if (!built.docs.length) {
        setNote(left ?? 'Nothing in the selection could be printed.');
        return;
      }
      const w = window.open('', '_blank');
      if (!w) { setNote('Allow pop-ups for this site to print.'); return; }
      w.document.open();
      w.document.write(contractsPrintHTML(built.docs));
      w.document.close();
      w.focus();
      setTimeout(() => { try { w.print(); } catch { /* the user can print from the window */ } }, 400);
      setNote(left ?? '');
    } catch (e: any) {
      setNote(e?.message ?? 'Could not build the print.');
    } finally { setPrinting(false); }
  };

  const allPicked = view.rows.length > 0 && picked.length === view.rows.length;
  const warn = bulkPrintNote(picked.length);

  return (
    <div className="aq-view" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* The search box grows and the dropdown does not. .aq-input and
          .aq-select both carry width:100% in globals.css, so in a flex row
          the select claims the line and the input is squeezed to nothing
          unless it is told min-width:0. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <input className="aq-input" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Search by number, title, template or kind"
          style={{ flex: '1 1 auto', minWidth: 0 }} />
        <select className="aq-select" value={status} onChange={(e) => setStatus(e.target.value)}
          style={{ flex: '0 0 auto', width: 'auto', minWidth: 130 }}>
          <option value="">All statuses</option>
          {CONTRACT_STATUSES.map((s) => (
            <option key={s.key} value={s.key}>{s.label}</option>
          ))}
        </select>
        <button className="aq-btn aq-btn-primary" onClick={() => { setPicking(true); setFormErr(''); }}
          disabled={pub.loading} style={{ flex: '0 0 auto' }}>
          New contract
        </button>
      </div>

      {/* Signed contracts, at a glance. Clicking a number filters to it, so
          the checklist is the register rather than a second screen showing
          the same rows a different way. */}
      {!loading && contracts.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
          fontSize: 13, color: 'var(--aq-text-secondary)' }}>
          <span role="button" tabIndex={0} style={{ cursor: 'pointer' }}
            onClick={() => setStatus('signed')}
            onKeyDown={(e) => { if (e.key === 'Enter') setStatus('signed'); }}>
            <b style={{ fontSize: 15 }}>{tally.signed}</b> signed
          </span>
          <span role="button" tabIndex={0} style={{ cursor: 'pointer' }}
            onClick={() => setStatus('issued')}
            onKeyDown={(e) => { if (e.key === 'Enter') setStatus('issued'); }}
            title="Issued and not signed yet - what is outstanding">
            <b style={{ fontSize: 15, color: tally.awaiting ? 'var(--aq-warning, #a86200)' : undefined }}>
              {tally.awaiting}
            </b> waiting to come back
          </span>
          <span style={{ color: 'var(--aq-text-muted)' }}>
            {tally.issued} issued in total
          </span>
          {status ? (
            <button className="aq-btn aq-btn-ghost" style={{ padding: '2px 8px', fontSize: 12 }}
              onClick={() => setStatus('')}>Show all</button>
          ) : null}
        </div>
      )}

      {error && <div className="aq-badge aq-badge-error" style={{ display: 'block', padding: 10 }}>{error}</div>}

      {loading ? (
        <div className="aq-card" style={{ padding: 8 }}><AqDrawingBlock label={'Loading contracts\u2026'} /></div>
      ) : contracts.length === 0 ? (
        <div className="aq-card" style={{ padding: 28, textAlign: 'center' }}>
          <p style={{ color: 'var(--aq-text-secondary)', fontSize: 14 }}>No contracts yet.</p>
          <p style={{ color: 'var(--aq-text-muted)', fontSize: 13, marginTop: 6 }}>
            Create one from a published template - it stays stamped to that exact version.
          </p>
        </div>
      ) : view.rows.length === 0 ? (
        <div className="aq-card" style={{ padding: 28, textAlign: 'center' }}>
          <p style={{ color: 'var(--aq-text-secondary)', fontSize: 14 }}>
            No contract matches that.
          </p>
        </div>
      ) : (
        <section className="aq-card" style={{ padding: 18 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
            paddingBottom: 12, borderBottom: '1px solid var(--aq-border-light)',
          }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
              <input type="checkbox" checked={allPicked}
                onChange={() => setSel(allPicked ? [] : view.rows.map((r) => r.id))} />
              <span>
                {allPicked ? 'Clear' : `Select all ${view.rows.length}`}
                {view.hidden > 0 && !allPicked ? ' matching' : ''}
              </span>
            </label>
            <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: 'var(--aq-text-muted)' }}>
              {picked.length > 0
                ? `${picked.length} selected`
                : `${view.rows.length} contract${view.rows.length === 1 ? '' : 's'}`}
            </span>
            <button className="aq-btn aq-btn-ghost" disabled={!picked.length || printing}
              onClick={printPicked}
              title="Open every selected contract as one document to print or save as a single PDF">
              {printing ? 'Preparing\u2026' : `Print / Save as PDF${picked.length ? ` (${picked.length})` : ''}`}
            </button>
          </div>

          {warn && (
            <p style={{ fontSize: 12.5, color: 'var(--aq-text-muted)', marginTop: 10 }}>{warn}</p>
          )}
          {note && (
            <div className="aq-badge aq-badge-warning" style={{ display: 'block', padding: 9, marginTop: 10 }}>{note}</div>
          )}

          {pending.map((p) => (
            <div key={p.id} style={{ marginTop: 10 }}>
              <UndoBar label={removedLabel(p.title, 'draft')} seconds={p.left}
                onUndo={() => setPending((l) => cancelPending(l, p.id))}
                onNow={() => {
                  setPending((l) => cancelPending(l, p.id));
                  commit.current(p.id);
                }} />
            </div>
          ))}

          <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column' }}>
            {view.shown.map((c, i) => (
              <li key={c.id} style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '10px 4px',
                borderTop: i === 0 ? 'none' : '1px solid var(--aq-border-light)',
              }}>
                <input type="checkbox" checked={sel.includes(c.id)}
                  onChange={() => setSel((s) => toggleId(s, c.id))}
                  aria-label={`Select ${c.title || 'contract'}`}
                  style={{ flex: '0 0 auto', cursor: 'pointer' }} />
                <span role="button" tabIndex={0} onClick={() => setOpenId(c.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenId(c.id); } }}
                  style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}>
                  <span style={{ fontSize: 14, fontWeight: 600, display: 'block' }}>{c.title || '(untitled)'}</span>
                  <span style={{ fontSize: 12, color: 'var(--aq-text-muted)' }}>
                    {c.contract_no ? <><code style={{ direction: 'ltr' }}>{c.contract_no}</code> {'\u00b7'} </> : null}
                    {c.template_name} {'\u00b7'} {kindLabel(c.doc_kind)}
                  </span>
                </span>
                {hasSignedCopy(c as any) && (
                  <span title="The signed copy is on file"
                    style={{ flex: '0 0 auto', color: 'var(--aq-success, #1a7f37)', fontWeight: 700 }}>
                    {'\u2713'}
                  </span>
                )}
                {(() => {
                  const st = supersedeState(c, links);
                  return st === 'none' ? null : (
                    <span className={`aq-badge ${supersedeBadge(st)}`}>{supersedeLabel(st)}</span>
                  );
                })()}
                <span className={`aq-badge ${contractStatusBadge(c.status)}`}>{contractStatusLabel(c.status)}</span>
                {c.status === 'draft' && (
                  <button className="aq-btn aq-btn-ghost" title="Delete draft" style={{ padding: '4px 8px' }}
                    onClick={() => { setPending((l) => startPending(l, c.id, c.title ?? '')); }}>
                    &times;
                  </button>
                )}
                <span role="button" tabIndex={0} onClick={() => setOpenId(c.id)}
                  style={{ fontSize: 14, color: 'var(--aq-text-muted)', cursor: 'pointer' }}>&rsaquo;</span>
              </li>
            ))}
          </ul>

          {view.hidden > 0 && (
            <p style={{
              fontSize: 12.5, color: 'var(--aq-text-muted)', marginTop: 12, paddingTop: 12,
              borderTop: '1px solid var(--aq-border-light)',
            }}>
              Showing the first {SHOW_MAX} of {view.rows.length}. Search or filter to reach the rest
              {' '}{'\u2014'} Select all still takes all {view.rows.length}.
            </p>
          )}
        </section>
      )}

      {picking && (
        <div role="dialog" aria-modal="true" style={{
          position: 'fixed', inset: 0, background: 'var(--aq-backdrop, rgba(0,0,0,0.4))',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16,
        }} onClick={() => !busy && setPicking(false)}>
          <div className="aq-card" style={{ padding: 22, width: 'min(480px, 100%)' }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 14 }}>New contract</h3>
            {pub.versions.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--aq-text-muted)' }}>
                No published templates yet. Publish a template version first, then a contract can be made from it.
              </p>
            ) : (
              <>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--aq-text-muted)', marginBottom: 4 }}>Template</label>
                <select className="aq-select" value={versionId} onChange={(e) => setVersionId(e.target.value)} style={{ width: '100%' }} autoFocus>
                  <option value="">{'-- choose a published template --'}</option>
                  {pub.versions.map((v) => (
                    <option key={v.version_id} value={v.version_id}>
                      {v.template_name} (v{v.version}) {'\u2014'} {kindLabel(v.doc_kind)}
                    </option>
                  ))}
                </select>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--aq-text-muted)', margin: '14px 0 4px' }}>Title</label>
                <input className="aq-input" value={title} onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Vendor agreement - Rawad Media" style={{ width: '100%' }} />
              </>
            )}
            {formErr && <div className="aq-badge aq-badge-error" style={{ display: 'block', marginTop: 12, padding: 8 }}>{formErr}</div>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18 }}>
              <button className="aq-btn aq-btn-ghost" onClick={() => setPicking(false)} disabled={busy}>Cancel</button>
              {pub.versions.length > 0 && (
                <button className="aq-btn aq-btn-primary" onClick={startNew} disabled={busy || !versionId || !title.trim()}>
                  {busy ? 'Creating\u2026' : 'Create'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
