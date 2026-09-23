'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  useContracts, usePublishedVersions, loadContractPrintDocs,
  useExternalDocs, useSignedReviews, signedCopyUrl, reviewFileUrl,
} from '@/hooks/use-legal';
import {
  kindLabel, contractStatusLabel, contractStatusBadge, CONTRACT_STATUSES,
  contractsPrintHTML, DOC_KINDS,
} from '@/lib/legal';
import {
  registerRows, printableIds, sortRegister, filterRegister, registerTally,
  registerNote, registerSummary, cannotReviewHere, canReview,
  type RegisterRow, type SourceFilter,
} from '@/lib/legal-register';
import {
  reviewLabel, reviewBadge, reviewState,
  reasonError, normaliseReason, REJECT_REASONS, REASON_MAX,
} from '@/lib/legal-review';
import {
  externalState, externalBadge, externalLabel, externalNote,
  validateExternalDoc, validateExternalFile, EXTERNAL_EXTENSIONS,
  filingDeleteWarning,
} from '@/lib/legal-external';
import type { WorkspaceRole } from '@/hooks/use-workflow';
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
import { UndoBar, ConfirmDelete } from '@/components/workflow/campaign/ui';
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

export function LegalRegister({ workspaceId, role, initialSource }: {
  workspaceId?: string;
  role?: WorkspaceRole | null;
  /** Where the screen opens, when somebody arrived from a number on
   *  Signatures. Only the starting value - changing the dropdown here wins
   *  from then on, which is why it is not kept in sync. */
  initialSource?: SourceFilter;
}) {
  const { contracts, loading, error, create, remove } = useContracts(workspaceId ?? null);
  const pub = usePublishedVersions(workspaceId ?? null);
  // The other half of the register. 118 created external_doc "so the register
  // is complete" and then it was built onto Signatures, so the register was
  // never complete - this is that sentence honoured.
  const ext = useExternalDocs(workspaceId ?? null);
  // And the signed copies people have sent back, so a filed document can say
  // one is waiting on the row it belongs to.
  const rev = useSignedReviews(workspaceId ?? null);

  const [openId, setOpenId] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [versionId, setVersionId] = useState('');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState('');

  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [source, setSource] = useState<SourceFilter>(initialSource ?? '');
  /** The filed document opened for a look. A generated contract opens
   *  ContractFill instead; the two are different enough that one panel
   *  serving both would be a panel with half its fields blank. */
  const [openDocId, setOpenDocId] = useState<string | null>(null);
  const [filing, setFiling] = useState(false);
  const [confirmId, setConfirmId] = useState('');

  // Today as an ISO date, once, so every row on this render is judged against
  // the same day - and set in an effect rather than read during render, or
  // the server and the browser disagree across midnight and React reports a
  // hydration mismatch on a badge somebody can see.
  const [today, setToday] = useState('');
  useEffect(() => { setToday(new Date().toISOString().slice(0, 10)); }, []);
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

    // ONE list, built once. Every number on this screen and every row in it
    // come from here, so the heading cannot disagree with what is under it.
    const all = sortRegister(registerRows(live as any[], ext.docs as any[], rev.uploads as any[]));
    const rows = filterRegister(all, q, source, status);
    return {
      all,
      rows,
      shown: rows.slice(0, SHOW_MAX),
      hidden: Math.max(0, rows.length - SHOW_MAX),
      tally: registerTally(all),
      summary: registerSummary(all),
      // What Select all may take. A filed document is somebody else's PDF
      // with no template version to rebuild it from - see printableOnly.
      printable: printableIds(rows),
    };
  }, [contracts, ext.docs, rev.uploads, q, status, source, pendingKey]);

  // The selection is contract rows, in register order, and can only ever hold
  // printable ones: the checkbox is not drawn on a filed row, and Select all
  // goes through printableIds.
  const picked = useMemo(
    () => selectedInOrder(view.rows.filter((r) => r.source === 'generated').map((r) => r.row), sel),
    [view.rows, sel],
  );

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

  // Against the PRINTABLE rows, not every row. With filed documents in the
  // list this was the line that would quietly have lied: "Select all 40" on a
  // view of 40 where 12 cannot be printed would never read as all-selected,
  // so the box could never be ticked off again.
  const allPicked = view.printable.length > 0 && picked.length === view.printable.length;
  const warn = bulkPrintNote(picked.length);

  return (
    <div className="aq-view" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* The search box grows and the dropdown does not. .aq-input and
          .aq-select both carry width:100% in globals.css, so in a flex row
          the select claims the line and the input is squeezed to nothing
          unless it is told min-width:0. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <input className="aq-input" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Search by number, title, template, kind or the other side"
          style={{ flex: '1 1 auto', minWidth: 0 }} />
        {/* One control for both questions. "Show me the filed ones" and "show
            me what is waiting" are the same kind of question, and two
            dropdowns to answer them is one too many. */}
        <select className="aq-select" value={source}
          onChange={(e) => setSource(e.target.value as SourceFilter)}
          style={{ flex: '0 0 auto', width: 'auto', minWidth: 150 }}>
          <option value="">Everything</option>
          <option value="generated">Generated here</option>
          <option value="filed">Filed from outside</option>
          <option value="review">
            Waiting to be looked at{view.tally.awaitingReview ? ` (${view.tally.awaitingReview})` : ''}
          </option>
        </select>
        <select className="aq-select" value={status} onChange={(e) => setStatus(e.target.value)}
          style={{ flex: '0 0 auto', width: 'auto', minWidth: 130 }}>
          <option value="">All statuses</option>
          {CONTRACT_STATUSES.map((s) => (
            <option key={s.key} value={s.key}>{s.label}</option>
          ))}
        </select>
        <button className="aq-btn aq-btn-ghost" style={{ flex: '0 0 auto' }}
          onClick={() => { setFiling(true); setNote(''); }}>
          File an agreement
        </button>
        <button className="aq-btn aq-btn-primary" onClick={() => { setPicking(true); setFormErr(''); }}
          disabled={pub.loading} style={{ flex: '0 0 auto' }}>
          New contract
        </button>
      </div>

      {/* Signed contracts, at a glance. Clicking a number filters to it, so
          the checklist is the register rather than a second screen showing
          the same rows a different way. */}
      {!loading && view.all.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
          fontSize: 13, color: 'var(--aq-text-secondary)' }}>
          {/* What is in the register, in one line, before anybody scrolls. */}
          <span style={{ flexBasis: '100%', color: 'var(--aq-text-muted)' }}>{view.summary}</span>
          {view.tally.awaitingReview > 0 && (
            <span role="button" tabIndex={0} style={{ cursor: 'pointer' }}
              onClick={() => setSource('review')}
              onKeyDown={(e) => { if (e.key === 'Enter') setSource('review'); }}>
              <b style={{ fontSize: 15, color: 'var(--aq-warning, #a86200)' }}>
                {view.tally.awaitingReview}
              </b> signed {view.tally.awaitingReview === 1 ? 'copy' : 'copies'} to look at
            </span>
          )}
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
          {(status || source) ? (
            <button className="aq-btn aq-btn-ghost" style={{ padding: '2px 8px', fontSize: 12 }}
              onClick={() => { setStatus(''); setSource(''); }}>Show all</button>
          ) : null}
        </div>
      )}

      {(error || ext.error || rev.error) && (
        <div role="alert" style={{
          background: 'var(--aq-red-bg)', border: '1px solid var(--aq-red-border)',
          color: 'var(--aq-red-strong)', padding: '10px 12px',
          borderRadius: 'var(--aq-radius)', fontSize: 12.5,
        }}>{error || ext.error || rev.error}</div>
      )}

      {(loading || ext.loading) ? (
        <div className="aq-card" style={{ padding: 8 }}><AqDrawingBlock label={'Loading the register\u2026'} /></div>
      ) : view.all.length === 0 ? (
        <div className="aq-card" style={{ padding: 28, textAlign: 'center' }}>
          <p style={{ color: 'var(--aq-text-secondary)', fontSize: 14 }}>Nothing in the register yet.</p>
          <p style={{ color: 'var(--aq-text-muted)', fontSize: 13, marginTop: 6 }}>
            Create a contract from a published template - it stays stamped to that exact
            version - or file an agreement somebody else drafted.
          </p>
        </div>
      ) : view.rows.length === 0 ? (
        <div className="aq-card" style={{ padding: 28, textAlign: 'center' }}>
          <p style={{ color: 'var(--aq-text-secondary)', fontSize: 14 }}>
            Nothing matches that.
          </p>
        </div>
      ) : (
        <section className="aq-card" style={{ padding: 18 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
            paddingBottom: 12, borderBottom: '1px solid var(--aq-border-light)',
          }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
              <input type="checkbox" checked={allPicked} disabled={!view.printable.length}
                onChange={() => setSel(allPicked ? [] : view.printable)} />
              <span>
                {allPicked ? 'Clear' : `Select all ${view.printable.length}`}
                {view.hidden > 0 && !allPicked ? ' matching' : ''}
              </span>
            </label>
            <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: 'var(--aq-text-muted)' }}>
              {picked.length > 0
                ? `${picked.length} selected`
                : `${view.rows.length} row${view.rows.length === 1 ? '' : 's'}`}
              {/* Said out loud rather than left as a missing checkbox. */}
              {view.rows.length > view.printable.length && (
                <> {'\u00b7'} {view.rows.length - view.printable.length} filed from outside,
                  {' '}which cannot be printed as a stack</>
              )}
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
            {view.shown.map((r, i) => {
              const c = r.row;
              const filed = r.source === 'filed';
              const st = filed ? externalState(c, today) : null;
              return (
              <li key={r.id} style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '10px 4px', flexWrap: 'wrap',
                borderTop: i === 0 ? 'none' : '1px solid var(--aq-border-light)',
              }}>
                {/* Only a generated contract gets a box. A filed document
                    cannot go in a print stack, and a checkbox that does
                    nothing is worse than none. */}
                {filed ? (
                  <span aria-hidden style={{ flex: '0 0 auto', width: 13 }} />
                ) : (
                  <input type="checkbox" checked={sel.includes(r.id)}
                    onChange={() => setSel((x) => toggleId(x, r.id))}
                    aria-label={`Select ${r.title}`}
                    style={{ flex: '0 0 auto', cursor: 'pointer' }} />
                )}
                <span role="button" tabIndex={0}
                  onClick={() => (filed ? setOpenDocId(r.id) : setOpenId(r.id))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      if (filed) setOpenDocId(r.id); else setOpenId(r.id);
                    }
                  }}
                  style={{ flex: 1, minWidth: 180, cursor: 'pointer' }}>
                  <span dir="auto" style={{ fontSize: 14, fontWeight: 600, display: 'block' }}>{r.title}</span>
                  <span dir="auto" style={{ fontSize: 12, color: 'var(--aq-text-muted)' }}>
                    {r.reference ? <><code style={{ direction: 'ltr' }}>{r.reference}</code> {'\u00b7'} </> : null}
                    {filed
                      ? <>filed from outside {'\u00b7'} {kindLabel(r.kind)}{r.party ? ` \u00b7 ${r.party}` : ''}</>
                      : <>{c.template_name} {'\u00b7'} {kindLabel(r.kind)}</>}
                  </span>
                </span>

                {/* The thing to act on, said on the row it belongs to. */}
                {r.review && (
                  <span className={`aq-badge ${reviewBadge(r.review)}`}
                    title="A signed copy was sent back from outside">
                    {r.review === 'pending' ? 'Signed copy waiting' : reviewLabel(r.review)}
                  </span>
                )}

                {!filed && hasSignedCopy(c as any) && (
                  <span title="The signed copy is on file"
                    style={{ flex: '0 0 auto', color: 'var(--aq-success, #1a7f37)', fontWeight: 700 }}>
                    {'\u2713'}
                  </span>
                )}
                {!filed && (() => {
                  const sup = supersedeState(c, links);
                  return sup === 'none' ? null : (
                    <span className={`aq-badge ${supersedeBadge(sup)}`}>{supersedeLabel(sup)}</span>
                  );
                })()}
                {filed
                  ? <span className={`aq-badge ${externalBadge(st!)}`}>{externalLabel(st!)}</span>
                  : <span className={`aq-badge ${contractStatusBadge(r.status)}`}>{contractStatusLabel(r.status)}</span>}

                {!filed && r.status === 'draft' && (
                  <button className="aq-btn aq-btn-ghost" title="Delete draft" style={{ padding: '4px 8px' }}
                    onClick={() => { setPending((l) => startPending(l, r.id, r.title)); }}>
                    &times;
                  </button>
                )}
                <span role="button" tabIndex={0}
                  onClick={() => (filed ? setOpenDocId(r.id) : setOpenId(r.id))}
                  style={{ fontSize: 14, color: 'var(--aq-text-muted)', cursor: 'pointer' }}>&rsaquo;</span>

                {/* Opened in place, under its own row, rather than on a screen
                    of its own: the point of the move is that the decision and
                    the document are in the same place, and a full-page detour
                    would put them back on two screens with a Back button
                    between them. */}
                {filed && openDocId === r.id && (
                  <div style={{ flexBasis: '100%' }}>
                    <FiledDocument
                      row={r}
                      state={st!}
                      role={role ?? null}
                      onClose={() => setOpenDocId(null)}
                      onDecided={async () => { await rev.reload(); }}
                      accept={rev.accept}
                      reject={rev.reject}
                      onRemove={() => setConfirmId(r.id)}
                    />
                    {confirmId === r.id && (
                      <div style={{ marginTop: 8 }}>
                        <ConfirmDelete message={filingDeleteWarning(c)} confirmLabel="Yes, remove it"
                          onCancel={() => setConfirmId('')}
                          onConfirm={async () => {
                            setConfirmId(''); setOpenDocId(null);
                            try { await ext.remove(c); }
                            catch (e: any) { setNote(e?.message ?? 'Could not remove it.'); }
                          }} />
                      </div>
                    )}
                  </div>
                )}
              </li>
              );
            })}
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

      {filing && (
        <FileAgreement
          onCancel={() => setFiling(false)}
          onFile={async (v) => { await ext.file(v); setFiling(false); }} />
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

/**
 * A document filed from outside, opened in the register - and the decision on
 * the signed copy somebody sent back against it.
 *
 * Siraj: *"you cant check the contract / contract details and id rather it be
 * in the register rather than its own place"*.
 *
 * -- EVERYTHING THE IMPORT KEPT IS ON SCREEN ------------------------
 *
 * Migration 123 put the contract app's type, amount, generation date and
 * generator into `notes` rather than inventing columns for them, so `notes`
 * is shown in full and not truncated. It is the only place those four facts
 * survive, and a decision made without them is a decision made on a title.
 *
 * -- TWO FILES, AND THEY ARE NOT THE SAME FILE ----------------------
 *
 * The DOCUMENT is what went out, in the legal-signed bucket. The SIGNED COPY
 * is what came back, in the contract app's own bucket (which is why migration
 * 124 had to exist at all). Reviewing means comparing the two, so both are
 * openable from here, labelled for which is which - a single "Open" button
 * would be the most confusing control on the screen.
 */
function FiledDocument({
  row, state, role, onClose, onDecided, accept, reject, onRemove,
}: {
  row: RegisterRow;
  state: ReturnType<typeof externalState>;
  role: WorkspaceRole | null;
  onClose: () => void;
  onDecided: () => Promise<void> | void;
  accept: (id: string) => Promise<void>;
  reject: (id: string, reason: string) => Promise<void>;
  onRemove: () => void;
}) {
  const d = row.row;
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');

  const blocked = cannotReviewHere(row, role);
  const badReason = reason ? reasonError(reason) : null;

  const openDoc = async () => {
    setMsg('');
    const url = await signedCopyUrl(String(d?.file_path ?? ''), d?.file_name);
    if (url) window.open(url, '_blank');
    else setMsg('Could not open that document.');
  };

  const openScan = async () => {
    setMsg('');
    const u = row.upload;
    const url = await reviewFileUrl(String(u?.storage_path ?? ''), u?.original_filename);
    if (url) window.open(url, '_blank');
    else {
      setMsg('This app cannot open that signed copy - it is in the contract app\u2019s'
        + ' storage. If migration 124 has not been run, that is why.');
    }
  };

  const field = (k: string, v: any) => (v ? (
    <div style={{ minWidth: 160 }}>
      <span style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--aq-text-muted)' }}>{k}</span>
      <span dir="auto" style={{ fontSize: 13 }}>{v}</span>
    </div>
  ) : null);

  const asDate = (v: any) => (v ? new Date(`${String(v)}T00:00:00`).toLocaleDateString() : '');

  return (
    <div style={{ background: 'var(--aq-bg-sunken)', borderRadius: 'var(--aq-radius)',
      padding: 14, marginTop: 8 }}>
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 10 }}>
        {field('Kind', kindLabel(row.kind))}
        {field('Other side', row.party)}
        {field('Their reference', row.reference)}
        {field('Signed on', asDate(d?.signed_on) || 'not recorded')}
        {field('Expires', asDate(d?.expires_on) || 'no end date')}
        {field('State', externalLabel(state))}
        {field('File', externalNote(d))}
      </div>

      {d?.notes && (
        <p dir="auto" style={{ fontSize: 12.5, color: 'var(--aq-text-secondary)',
          marginBottom: 10, whiteSpace: 'pre-wrap' }}>{d.notes}</p>
      )}

      {msg && (
        <div role="alert" style={{
          background: 'var(--aq-amber-bg)', border: '1px solid var(--aq-amber-border)',
          color: 'var(--aq-amber-deep)', padding: '8px 10px',
          borderRadius: 'var(--aq-radius)', fontSize: 12.5, marginBottom: 10,
        }}>{msg}</div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button className="aq-btn aq-btn-ghost" style={{ padding: '4px 10px' }}
          onClick={openDoc}>Open the document</button>
        {row.uploadId && (
          <button className="aq-btn aq-btn-ghost" style={{ padding: '4px 10px' }}
            onClick={openScan}>Open the signed copy</button>
        )}
        <span style={{ flex: 1, minWidth: 0 }} />
        <button className="aq-btn aq-btn-ghost" style={{ padding: '4px 10px' }}
          onClick={onRemove} title="Remove this filing and its document">Remove</button>
        <button className="aq-btn aq-btn-ghost" style={{ padding: '4px 10px' }}
          onClick={onClose}>Close</button>
      </div>

      {/* The decision, under the thing being decided about. */}
      {row.uploadId && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--aq-border-light)' }}>
          <p style={{ fontSize: 12.5, marginBottom: 8 }}>
            <span className={`aq-badge ${reviewBadge(row.review!)}`} style={{ marginRight: 6 }}>
              {reviewLabel(row.review!)}
            </span>
            A signed copy was sent back for this one.
          </p>

          {blocked ? (
            <p style={{ fontSize: 12.5, color: 'var(--aq-text-muted)' }}>{blocked}</p>
          ) : rejecting ? (
            <div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                {REJECT_REASONS.map((x) => (
                  <button key={x} type="button" className="aq-btn aq-btn-ghost"
                    style={{ padding: '3px 9px', fontSize: 11.5 }}
                    onClick={() => setReason(x)}>{x}</button>
                ))}
              </div>
              <textarea dir="auto" className="aq-input" rows={2} value={reason} autoFocus
                maxLength={REASON_MAX + 50}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Or say it in your own words - they read this in their portal"
                style={{ width: '100%', resize: 'vertical' }} />
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
                <span style={{ flex: 1, minWidth: 0, fontSize: 11.5,
                  color: badReason ? 'var(--aq-error)' : 'var(--aq-text-muted)' }}>
                  {badReason || 'They see this next to their upload.'}
                </span>
                <button className="aq-btn aq-btn-ghost" disabled={busy}
                  onClick={() => { setRejecting(false); setReason(''); }}>Cancel</button>
                <button className="aq-btn aq-btn-primary"
                  disabled={busy || !!reasonError(reason)}
                  onClick={async () => {
                    setBusy(true); setMsg('');
                    try {
                      await reject(row.uploadId!, normaliseReason(reason));
                      setRejecting(false); setReason('');
                      await onDecided();
                    } catch (e: any) { setMsg(e?.message ?? 'That did not go through.'); }
                    finally { setBusy(false); }
                  }}>
                  {busy ? 'Sending\u2026' : 'Send it back'}
                </button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="aq-btn aq-btn-primary" style={{ padding: '4px 12px' }}
                disabled={busy || reviewState({ status: row.review } as any) === 'accepted'}
                onClick={async () => {
                  setBusy(true); setMsg('');
                  try { await accept(row.uploadId!); await onDecided(); }
                  catch (e: any) { setMsg(e?.message ?? 'That did not go through.'); }
                  finally { setBusy(false); }
                }}>
                {busy ? '\u2026' : 'Accept'}
              </button>
              <button className="aq-btn aq-btn-ghost" style={{ padding: '4px 12px' }}
                disabled={busy || row.review === 'rejected'}
                onClick={() => { setMsg(''); setRejecting(true); }}>
                {row.review === 'accepted' ? 'Send it back' : 'Reject'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The filing form, moved here from Signatures with the documents it makes.
 *
 * Migration 118's own sentence: an outside agreement is filed "so the
 * register is complete". The form that files one belongs beside the register
 * it completes.
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
