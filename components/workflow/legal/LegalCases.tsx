'use client';

import { useEffect, useMemo, useState } from 'react';
import { useClients, useVendorNames } from '@/hooks/use-workflow';
import { useDashboardRows } from '@/hooks/use-dashboard';
import { useMatters, useMatterEvents, useContractStatuses, type MatterRow } from '@/hooks/use-legal';
import { scopeRows, ALL_TIME } from '@/lib/dashboard-data';
import { clientLedger, vendorLedger, money, type TermSet } from '@/lib/money-ledger';
import {
  MATTER_STATUSES, MATTER_KINDS, EVENT_KINDS,
  matterStatusLabel, matterStatusBadge, matterClosed, matterKindLabel, eventKindLabel,
  matterWarnings, warningsLine, sortMatters, mattersLine, searchMatters,
  partySearch, newMatterProblems, parseMatterAmount, defaultMatterTitle,
  legalKpis, kpiBadge, unhandledCount, splitMatters,
  type MatterSide, type MatterWarning, type PartyOption, type NewMatterDraft,
  matterDeleteWarning,
} from '@/lib/legal-matters';
import { AqDrawingBlock } from '@/components/AQLoading';
import { ConfirmDelete } from '@/components/workflow/campaign/ui';

/**
 * The Legal Registry - Cases.
 *
 * Siraj: "I need the legal registry to keep law suits and cases and problems
 * that could arise and become law suits from the app in one place and statuses
 * and a log", and "make sure they can log any actions law suits problems in
 * vendors not being paid and clients who have not paid with warnings".
 *
 * -- TWO HALVES, AND ONLY ONE OF THEM IS STORED ----------------------
 *
 * The top half is what the app NOTICED: overdue money on completed campaigns,
 * read live from lib/money-ledger on every load. Nothing here is a row. The
 * bottom half is what somebody DECIDED to do about it: legal.matter, with a
 * status and a log, which exists only once it is raised.
 *
 * That split is the whole design. See the header of lib/legal-matters.ts for
 * why the warnings are not materialised, and 113_legal_matters.sql for what a
 * matter is.
 *
 * -- ONE MEMO, KEYED ON THE SIDE -------------------------------------
 *
 * The side, its warnings and its header line come out of ONE useMemo, and
 * that section is keyed on the side so switching rebuilds it rather than
 * patching it. This is the Collection-header-over-Liability-rows bug from the
 * Data view, and it would be worse here: a client's name over a vendor's
 * debt, on the screen that decides who gets a lawyer's letter.
 *
 * -- THE TWO CHECKLISTS DO NOT MOVE WITH THE TAB ---------------------
 *
 * Siraj's checklists, written out with the job description:
 *
 *   1. signed contracts   -> the Signatures screen
 *   2. legal cases        -> here
 *   3. collection         -> here
 *
 * Those are two topics, not two sides of the money, so the matter lists below
 * span BOTH sides and do not change when the tab does. A vendor chasing us is
 * a case; a client who has not paid is collection; the tab decides which
 * ledger to read for the warnings and nothing else. Same reasoning as the KPI
 * strip - a list that changes when you press a tab is a list nobody trusts
 * to be the whole of anything.
 */

/** Warnings shown before folding the rest into a counted line. */
const SHOW_WARNINGS = 5;
/** Matters rendered per checklist, per the rule every list here follows. */
const SHOW_MATTERS = 200;

export function LegalCases({ workspaceId }: { workspaceId?: string }) {
  const { rows, loading: rowsLoading } = useDashboardRows(workspaceId ?? null);
  const { clients } = useClients();
  // Names only. useLegacyVendors reads vendors.* for four thousand rows plus
  // every bank account, category and org; this screen uses the id and the
  // name. Siraj: "make it faster its so slow."
  const { vendorNames } = useVendorNames();
  const { statuses } = useContractStatuses(workspaceId ?? null);
  const {
    matters, loading: mattersLoading, error, open, setStatus, remove,
  } = useMatters(workspaceId ?? null);

  const [side, setSide] = useState<MatterSide>('client');
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState('');
  const [formErr, setFormErr] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [raising, setRaising] = useState(false);
  const [q, setQ] = useState('');

  // Today is read after mount, never during render: the server does not know
  // what day it is here, and a date that differs between the two renders is a
  // hydration error. Until it arrives the ledger dates on its own default.
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => { setToday(new Date().toISOString().slice(0, 10)); }, []);

  // The search box is NOT cleared here any more: it filters the two
  // checklists, which span both sides, so clearing it on a tab press would
  // throw away a search that still applies.
  useEffect(() => { setShowAll(false); setFormErr(''); }, [side]);

  /**
   * The parties this side can be against. Built once from the lists already on
   * screen rather than a fresh read, and handed to partySearch, which caps
   * what is offered - there are four thousand vendors and a select with four
   * thousand options is a frozen tab.
   */
  const partyOptions = useMemo<PartyOption[]>(() => (side === 'client'
    ? clients.map((c) => ({ id: String(c.id), name: c.company_name || '' }))
    : [...vendorNames].map(([id, name]) => ({ id, name: name || '' }))
  ).filter((o) => o.name), [side, clients, vendorNames]);

  const clientNames = useMemo(
    () => new Map(clients.map((c) => [c.id, c.company_name])), [clients]);
  const clientTerms = useMemo(
    () => new Map<string, TermSet>(clients
      .filter((c) => c.payment_terms)
      .map((c) => [c.id, {
        terms: c.payment_terms,
        splitPct: c.payment_split_pct,
        netDays: c.payment_net_days,
      }])), [clients]);

  /**
   * Task id -> the party ids on that task, so a matter raised from a warning
   * links to the real client or vendor rather than only carrying their name.
   * One map over every row: a client warning is keyed on the campaign and a
   * vendor warning on the booking, and both are rows here.
   */
  const partyIds = useMemo(() => {
    const m = new Map<string, { clientId?: string | null; vendorId?: number | null }>();
    for (const t of rows) m.set(t.id, { clientId: t.client_id ?? null, vendorId: t.vendor_id ?? null });
    return m;
  }, [rows]);

  const scoped = useMemo(() => scopeRows(rows, null, ALL_TIME), [rows]);

  /**
   * Everything the screen shows, worked out together. The header line, the
   * warnings under it, the matters below them and their own header all come
   * from this one object, so none of them can be about a different side than
   * the others.
   */
  /**
   * What is owed and what is being done about it. Deliberately does NOT
   * depend on the search box: the search box used to be a dependency of this
   * memo, so every keystroke rebuilt the whole ledger over four thousand
   * bookings. Measured at 2.2ms a keystroke against 0.2ms for the filter
   * alone - small on its own, and pure waste on a screen he called slow.
   */
  const base = useMemo(() => {
    const ledger = side === 'client'
      ? clientLedger({
        parents: scoped.parents, subtasks: scoped.allSubtasks,
        clientName: clientNames, clientTerms, today: today ?? undefined,
      })
      : vendorLedger({
        subtasks: scoped.subtasks, parents: scoped.parents,
        vendorName: vendorNames, today: today ?? undefined,
      });
    // Only this side's matters can suppress this side's warnings: the key is
    // `client:<task>` or `vendor:<task>`, so a vendor matter never hides a
    // client warning even when both are about the same campaign.
    const handled = new Set(matters
      .filter((m) => m.party_type === side)
      .map((m) => m.source_key).filter(Boolean) as string[]);
    return {
      side,
      warnings: matterWarnings({ rows: ledger, side, party: partyIds, handled }),
    };
  }, [side, scoped, clientNames, vendorNames, clientTerms, today, matters, partyIds]);

  /**
   * The warnings half. Still ONE object, so the header and the rows under it
   * cannot be about different sides - the split above changed what is
   * recomputed, not that invariant.
   */
  const view = useMemo(() => ({
    side: base.side,
    warnings: base.warnings,
    warningsLine: warningsLine(base.warnings, base.side),
  }), [base]);

  /**
   * The two checklists. Sorted ONCE over everything and split after, so a
   * matter is in exactly one of them and both are in the same order.
   *
   * The header lines count ALL of each list, never the search result: "1
   * open" under a filtered list would be a different number every keystroke
   * and none of them the answer to "how many are open".
   */
  const lists = useMemo(() => {
    const sorted = sortMatters(matters) as MatterRow[];
    const { collection, cases } = splitMatters(sorted);
    return {
      collection, cases,
      collectionLine: mattersLine(collection),
      casesLine: mattersLine(cases),
      total: matters.length,
    };
  }, [matters]);

  /**
   * Searching narrows the lists, it does not re-rank them, so a matter does
   * not jump away from where it just was. Kept out of the memo above so a
   * keystroke filters two arrays instead of re-sorting and re-splitting them.
   */
  const found = useMemo(() => ({
    collection: searchMatters(q, lists.collection),
    cases: searchMatters(q, lists.cases),
  }), [lists, q]);

  /**
   * The strip across the top. Siraj: "you need a dashboard to understand the
   * kpi" and, asked where: "no it should be within the cases log."
   *
   * Counted over BOTH sides, not the one on screen. "Open disputes: 2" has to
   * mean two disputes, not two on the tab you happen to be looking at - a
   * number that changes when you press a tab is a number nobody trusts.
   */
  const kpis = useMemo(() => {
    const unhandled = (['client', 'vendor'] as MatterSide[]).reduce((n, sd) => {
      const mine = matters.filter((m) => m.party_type === sd);
      const handled = new Set(mine.map((m) => m.source_key).filter(Boolean) as string[]);
      const ledger = sd === 'client'
        ? clientLedger({
          parents: scoped.parents, subtasks: scoped.allSubtasks,
          clientName: clientNames, clientTerms, today: today ?? undefined,
        })
        : vendorLedger({
          subtasks: scoped.subtasks, parents: scoped.parents,
          vendorName: vendorNames, today: today ?? undefined,
        });
      return n + unhandledCount(matterWarnings({ rows: ledger, side: sd, handled }));
    }, 0);
    return legalKpis({ contracts: statuses, matters, unhandled });
  }, [statuses, matters, scoped, clientNames, vendorNames, clientTerms, today]);

  const openWarnings = view.warnings.filter((w) => !w.handled);
  const shown = showAll ? openWarnings : openWarnings.slice(0, SHOW_WARNINGS);

  const raise = async (w: MatterWarning) => {
    setBusy(w.sourceKey); setFormErr('');
    try {
      const id = await open({
        title: `${w.party} - ${w.campaign || 'unpaid'}`,
        partyType: w.side,
        partyName: w.party || '(unnamed)',
        clientId: w.side === 'client' ? w.clientId : null,
        vendorId: w.side === 'vendor' ? w.vendorId : null,
        kind: w.side === 'client' ? 'client_unpaid' : 'vendor_unpaid',
        amount: w.amount,
        pmTaskId: w.taskId,
        sourceKey: w.sourceKey,
      });
      setOpenId(id);
    } catch (e: any) {
      setFormErr(e?.message ?? 'Could not open the matter.');
    } finally { setBusy(''); }
  };

  const raiseByHand = async (d: NewMatterDraft) => {
    // No source key. A hand-raised matter was not derived from a warning, so
    // it must never suppress one.
    const id = await open({
      title: d.title,
      partyType: side,
      partyName: d.partyName,
      clientId: side === 'client' ? d.partyId : null,
      vendorId: side === 'vendor' && d.partyId ? Number(d.partyId) : null,
      kind: d.kind,
      amount: parseMatterAmount(d.amount),
    });
    setRaising(false);
    setOpenId(id);
  };

  const loading = rowsLoading || mattersLoading;

  return (
    <div className="aq-view" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button className={`aq-btn ${side === 'client' ? 'aq-btn-primary' : 'aq-btn-ghost'}`}
          onClick={() => setSide('client')}>Clients</button>
        <button className={`aq-btn ${side === 'vendor' ? 'aq-btn-primary' : 'aq-btn-ghost'}`}
          onClick={() => setSide('vendor')}>Vendors</button>
        <span style={{ flex: 1, minWidth: 0 }} />
        {/* Lives up here beside the toggle, because the toggle is what says
            which side the new matter is against - the form's own title says
            it again. The lists below span both sides and so have no side of
            their own to raise one from. */}
        <button className="aq-btn aq-btn-primary"
          onClick={() => { setRaising(true); setFormErr(''); }}>
          New matter
        </button>
      </div>

      {error && <div className="aq-badge aq-badge-error" style={{ display: 'block', padding: 10 }}>{error}</div>}
      {formErr && <div className="aq-badge aq-badge-error" style={{ display: 'block', padding: 10 }}>{formErr}</div>}

      {!loading && (
        <section className="aq-card" style={{ padding: 0, overflow: 'hidden' }}>
          <ul style={{ listStyle: 'none', display: 'flex', flexWrap: 'wrap' }}>
            {kpis.map((k, i) => (
              <li key={k.key} style={{
                flex: '1 1 160px', minWidth: 0, padding: '16px 18px',
                borderInlineStart: i === 0 ? 'none' : '1px solid var(--aq-border-light)',
              }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 26, fontWeight: 800, lineHeight: 1.1 }}>{k.value}</span>
                  {k.unit && (
                    <span style={{ fontSize: 12, color: 'var(--aq-text-muted)' }}>{k.unit}</span>
                  )}
                  {/* "4 clients / 9 cases" - Siraj, asked which of the two
                      collection should count: "Both, side by side." */}
                  {k.second && (
                    <>
                      <span style={{ fontSize: 16, color: 'var(--aq-text-muted)' }}>/</span>
                      <span style={{ fontSize: 26, fontWeight: 800, lineHeight: 1.1 }}>{k.second.value}</span>
                      <span style={{ fontSize: 12, color: 'var(--aq-text-muted)' }}>{k.second.label}</span>
                    </>
                  )}
                  <span className={`aq-badge ${kpiBadge(k.tone)}`}
                    style={{ fontSize: 10, marginInlineStart: 2 }}>{k.label}</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--aq-text-muted)', marginTop: 6 }}>{k.note}</div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {loading ? (
        <div className="aq-card" style={{ padding: 8 }}><AqDrawingBlock label={'Reading the ledger\u2026'} /></div>
      ) : (
        <>
          {/* Keyed on the side: switching rebuilds this, it does not patch
              it. Only this section depends on the side now. */}
          <section key={view.side} className="aq-card" style={{ padding: 18 }}>
            <h3 style={{ fontSize: 15, fontWeight: 700 }}>What the app noticed</h3>
            <p style={{ fontSize: 13, color: 'var(--aq-text-muted)', marginTop: 4 }}>
              {view.warningsLine}
            </p>
            {shown.length > 0 && (
              <ul style={{ listStyle: 'none', marginTop: 12 }}>
                {shown.map((w, i) => (
                  <li key={w.sourceKey} style={{
                    display: 'flex', alignItems: 'center', gap: 12, padding: '10px 4px',
                    borderTop: i === 0 ? 'none' : '1px solid var(--aq-border-light)',
                  }}>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: 14, fontWeight: 600, display: 'block' }}>{w.party || '(unnamed)'}</span>
                      <span style={{ fontSize: 12, color: 'var(--aq-text-muted)' }}>
                        {w.campaign || 'no campaign name'}
                        {w.due ? <> {'\u00b7'} due {w.due}</> : null}
                        {w.daysLate > 0 ? <> {'\u00b7'} {w.daysLate} day{w.daysLate === 1 ? '' : 's'} late</> : null}
                      </span>
                    </span>
                    <span style={{ fontSize: 14, fontWeight: 700, whiteSpace: 'nowrap' }}>SAR {money(w.amount)}</span>
                    <button className="aq-btn aq-btn-ghost" style={{ whiteSpace: 'nowrap' }}
                      disabled={busy === w.sourceKey} onClick={() => void raise(w)}>
                      {busy === w.sourceKey ? 'Opening\u2026' : 'Open a matter'}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {/* Group before you cap: the rest is one counted line, not 500 rows. */}
            {!showAll && openWarnings.length > SHOW_WARNINGS && (
              <button className="aq-btn aq-btn-ghost" style={{ marginTop: 10 }} onClick={() => setShowAll(true)}>
                {openWarnings.length - SHOW_WARNINGS} more overdue {'\u2014'} show all
              </button>
            )}
          </section>

          {/* One search box over both checklists: they are one table split in
              two, and two boxes would mean typing a name twice to find out
              which of the two it is in. */}
          {lists.total > SHOW_WARNINGS && (
            <input className="aq-input" value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="Search every matter by name, title or status"
              style={{ width: '100%' }} />
          )}

          <MatterList
            title="Collection"
            blurb="Clients who have not paid. Money coming in."
            line={lists.collectionLine}
            matters={found.collection}
            filtered={!!q}
            onOpen={setOpenId}
          />
          <MatterList
            title="Legal cases"
            blurb="Everything that is not somebody owing us - a breach, a rights dispute, a vendor chasing us."
            line={lists.casesLine}
            matters={found.cases}
            filtered={!!q}
            onOpen={setOpenId}
          />
        </>
      )}

      {raising && (
        <NewMatterForm
          side={side}
          options={partyOptions}
          onCancel={() => setRaising(false)}
          onSave={raiseByHand}
        />
      )}

      {openId && (
        <MatterDetail
          matter={matters.find((m) => m.id === openId) ?? null}
          onClose={() => setOpenId(null)}
          onStatus={async (s) => { await setStatus(openId, s); }}
          onDelete={async () => { await remove(openId); setOpenId(null); }}
        />
      )}
    </div>
  );
}

/**
 * One checklist: Collection, or Cases.
 *
 * The same component twice rather than two copies of the same twenty rows,
 * because the day the two drift is the day one of them is missing the status
 * pill and nobody notices for a month.
 *
 * Rendering is capped at SHOW_MATTERS and says so when it bites. Four
 * thousand vendors came in from Asana and the ledger screens have already
 * been frozen once by a list that rendered all of something; a registry is
 * the last place to repeat it.
 */
function MatterList({ title, blurb, line, matters, filtered, onOpen }: {
  title: string;
  blurb: string;
  line: string;
  matters: MatterRow[];
  filtered: boolean;
  onOpen: (id: string) => void;
}) {
  const shown = matters.slice(0, SHOW_MATTERS);
  return (
    <section className="aq-card" style={{ padding: 18 }}>
      <h3 style={{ fontSize: 15, fontWeight: 700 }}>{title}</h3>
      <p style={{ fontSize: 12.5, color: 'var(--aq-text-muted)', marginTop: 4 }}>{blurb}</p>
      <p style={{ fontSize: 13, color: 'var(--aq-text-secondary)', marginTop: 6 }}>{line}</p>

      {matters.length === 0 && filtered && (
        <p style={{ fontSize: 13, color: 'var(--aq-text-muted)', marginTop: 12 }}>
          Nothing here matches that.
        </p>
      )}

      {shown.length > 0 && (
        <ul style={{ listStyle: 'none', marginTop: 12 }}>
          {shown.map((m, i) => (
            <li key={m.id} style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '10px 4px',
              borderTop: i === 0 ? 'none' : '1px solid var(--aq-border-light)',
              opacity: matterClosed(m.status) ? 0.6 : 1,
            }}>
              <span role="button" tabIndex={0} onClick={() => onOpen(m.id)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(m.id); } }}
                style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}>
                <span style={{ fontSize: 14, fontWeight: 600, display: 'block' }}>{m.title}</span>
                <span style={{ fontSize: 12, color: 'var(--aq-text-muted)' }}>
                  {m.party_name} {'\u00b7'} {matterKindLabel(m.kind)}
                  {m.amount ? <> {'\u00b7'} SAR {money(m.amount)}</> : null}
                </span>
              </span>
              <span className={`aq-badge ${matterStatusBadge(m.status)}`}>{matterStatusLabel(m.status)}</span>
              <span role="button" tabIndex={0} onClick={() => onOpen(m.id)}
                style={{ fontSize: 14, color: 'var(--aq-text-muted)', cursor: 'pointer' }}>&rsaquo;</span>
            </li>
          ))}
        </ul>
      )}

      {matters.length > SHOW_MATTERS && (
        <p style={{ fontSize: 12.5, color: 'var(--aq-text-muted)', marginTop: 10 }}>
          Showing {SHOW_MATTERS} of {matters.length}. Search to narrow it.
        </p>
      )}
    </section>
  );
}

/**
 * One matter: its status, and the log that proves it was followed through.
 *
 * Status changes are NOT written into the log here - the trigger in 113 does
 * that, however the row is changed. Writing one from the screen as well would
 * give two entries for one change, and one of them would be the one that is
 * wrong when somebody edits the row from anywhere else.
 */
function MatterDetail({ matter, onClose, onStatus, onDelete }: {
  matter: MatterRow | null;
  onClose: () => void;
  onStatus: (status: string) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const { events, loading, log } = useMatterEvents(matter?.id ?? null);
  // Was `confirm('Delete this matter and its whole log?')`, which names
  // nothing - on a screen with four matters open that is not a question
  // anybody can answer. See ConfirmDelete, and matterDeleteWarning for the
  // sentence it shows.
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [kind, setKind] = useState('note');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  if (!matter) return null;

  const add = async () => {
    if (!body.trim()) { setErr('Say what happened.'); return; }
    setBusy(true); setErr('');
    try { await log(kind, body); setBody(''); }
    catch (e: any) { setErr(e?.message ?? 'Could not save that.'); }
    finally { setBusy(false); }
  };

  const move = async (s: string) => {
    setBusy(true); setErr('');
    try { await onStatus(s); }
    catch (e: any) { setErr(e?.message ?? 'Could not change the status.'); }
    finally { setBusy(false); }
  };

  return (
    <div role="dialog" aria-modal="true" style={{
      position: 'fixed', inset: 0, background: 'var(--aq-backdrop, rgba(0,0,0,0.4))',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16,
    }} onClick={() => !busy && onClose()}>
      <div className="aq-card" style={{ padding: 22, width: 'min(640px, 100%)', maxHeight: '86vh', overflowY: 'auto' }}
        onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700 }}>{matter.title}</h3>
            <p style={{ fontSize: 12.5, color: 'var(--aq-text-muted)', marginTop: 4 }}>
              {matter.party_name} {'\u00b7'} {matterKindLabel(matter.kind)}
              {matter.amount ? <> {'\u00b7'} SAR {money(matter.amount)}</> : null}
              {' \u00b7 '}opened {String(matter.opened_at).slice(0, 10)}
              {matter.closed_at ? <> {'\u00b7'} closed {String(matter.closed_at).slice(0, 10)}</> : null}
            </p>
          </div>
          <span className={`aq-badge ${matterStatusBadge(matter.status)}`}>{matterStatusLabel(matter.status)}</span>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 16, flexWrap: 'wrap' }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--aq-text-muted)' }}>Status</label>
          <select className="aq-select" value={matter.status} disabled={busy}
            style={{ flex: '0 0 auto', width: 'auto', minWidth: 150 }}
            onChange={(e) => void move(e.target.value)}>
            {MATTER_STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <span style={{ flex: 1 }} />
          {!confirmDelete && (
            <button className="aq-btn aq-btn-ghost" disabled={busy}
              style={{ color: 'var(--aq-red)' }}
              onClick={() => setConfirmDelete(true)}>
              Delete
            </button>
          )}
          <button className="aq-btn aq-btn-ghost" onClick={onClose} disabled={busy}>Close</button>
        </div>

        {confirmDelete && (
          <ConfirmDelete message={matterDeleteWarning(matter, events.length)} busy={busy}
            onCancel={() => setConfirmDelete(false)}
            onConfirm={() => { setConfirmDelete(false); void onDelete(); }} />
        )}

        <div style={{ marginTop: 18, borderTop: '1px solid var(--aq-border-light)', paddingTop: 14 }}>
          {/* .aq-input and .aq-select both carry width:100% in globals.css. In a
              flex row that makes the SELECT claim the whole line and squeezes
              the box you actually type in down to nothing - which is what
              Siraj photographed. The select is pinned to its own width and the
              text box is given min-width:0 so it is allowed to grow. */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <select className="aq-select" value={kind} onChange={(e) => setKind(e.target.value)}
              disabled={busy} style={{ flex: '0 0 auto', width: 'auto', minWidth: 130 }}>
              {EVENT_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
            </select>
            <input className="aq-input" value={body} onChange={(e) => setBody(e.target.value)}
              placeholder="What happened" style={{ flex: '1 1 auto', minWidth: 0 }} disabled={busy}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void add(); } }} />
            <button className="aq-btn aq-btn-primary" onClick={() => void add()} disabled={busy || !body.trim()}>
              {busy ? 'Saving\u2026' : 'Log'}
            </button>
          </div>
          {err && <div className="aq-badge aq-badge-error" style={{ display: 'block', marginTop: 10, padding: 8 }}>{err}</div>}
        </div>

        {loading ? (
          <p style={{ fontSize: 13, color: 'var(--aq-text-muted)', marginTop: 14 }}>Loading the log{'\u2026'}</p>
        ) : (
          <ul style={{ listStyle: 'none', marginTop: 14 }}>
            {events.map((e, i) => (
              <li key={e.id} style={{
                padding: '10px 2px',
                borderTop: i === 0 ? 'none' : '1px solid var(--aq-border-light)',
              }}>
                <span style={{ fontSize: 12, color: 'var(--aq-text-muted)' }}>
                  {String(e.at).slice(0, 16).replace('T', ' ')} {'\u00b7'} {eventKindLabel(e.kind)}
                </span>
                <span style={{ fontSize: 13.5, display: 'block', marginTop: 2 }}>
                  {e.kind === 'status' && e.to_status
                    ? `${e.from_status ? matterStatusLabel(e.from_status) : 'Opened'} \u2192 ${matterStatusLabel(e.to_status)}${e.body ? ` - ${e.body}` : ''}`
                    : e.body}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * Raise a matter by hand.
 *
 * Siraj: "i need a manual also entry like a legal crm." Everything else on
 * this screen starts from something the ledger noticed, which only covers
 * money. A content dispute, a breach, a letter from somebody's lawyer - none
 * of those are a row in any ledger, and without this the screen is a debt
 * chaser rather than a registry.
 *
 * The party is PICKED where possible and TYPED where not. Picking links the
 * matter to the real record; typing covers the other side that is not in the
 * system at all, which is common enough at the point a dispute starts that
 * refusing it would send people to a spreadsheet.
 */
function NewMatterForm({ side, options, onCancel, onSave }: {
  side: MatterSide;
  options: PartyOption[];
  onCancel: () => void;
  onSave: (d: NewMatterDraft) => Promise<void>;
}) {
  const [partyName, setPartyName] = useState('');
  const [partyId, setPartyId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [titleTouched, setTitleTouched] = useState(false);
  const [kind, setKind] = useState(side === 'client' ? 'client_unpaid' : 'vendor_unpaid');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // Capped by partySearch, which is the whole reason this is a typeahead and
  // not a <select>: four thousand vendors came in from Asana.
  const hits = useMemo(() => partySearch(partyName, options, 6), [partyName, options]);
  const exact = hits.some((h) => h.name.toLowerCase() === partyName.trim().toLowerCase());

  // The title writes itself until somebody edits it, then it is theirs.
  const shown = titleTouched ? title : defaultMatterTitle(partyName, kind);
  const draft: NewMatterDraft = { partyName, partyId, title: shown, kind, amount };
  const problems = newMatterProblems(draft);

  const save = async () => {
    if (problems.length) { setErr(problems[0]); return; }
    setBusy(true); setErr('');
    try { await onSave(draft); }
    catch (e: any) { setErr(e?.message ?? 'Could not open the matter.'); }
    finally { setBusy(false); }
  };

  const label = { display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--aq-text-muted)', marginBottom: 4 } as const;

  return (
    <div role="dialog" aria-modal="true" style={{
      position: 'fixed', inset: 0, background: 'var(--aq-backdrop, rgba(0,0,0,0.4))',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16,
    }} onClick={() => !busy && onCancel()}>
      <div className="aq-card" style={{ padding: 22, width: 'min(520px, 100%)', maxHeight: '86vh', overflowY: 'auto' }}
        onClick={(e) => e.stopPropagation()}>
        <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 14 }}>
          New matter against a {side === 'client' ? 'client' : 'vendor'}
        </h3>

        <label style={label}>{side === 'client' ? 'Client' : 'Vendor'}</label>
        <input className="aq-input" value={partyName} autoFocus disabled={busy}
          onChange={(e) => { setPartyName(e.target.value); setPartyId(null); }}
          placeholder={side === 'client' ? 'Search or type a client' : 'Search or type a vendor'}
          style={{ width: '100%' }} />
        {/* The list only helps while the name is not already exactly one of
            them - once it is, it is six rows of noise under the answer. */}
        {partyName.trim() && !exact && hits.length > 0 && (
          <ul style={{ listStyle: 'none', marginTop: 6, border: '1px solid var(--aq-border-light)', borderRadius: 8 }}>
            {hits.map((h, i) => (
              <li key={h.id} role="button" tabIndex={0}
                onClick={() => { setPartyName(h.name); setPartyId(h.id); }}
                onKeyDown={(ev) => {
                  if (ev.key === 'Enter' || ev.key === ' ') {
                    ev.preventDefault(); setPartyName(h.name); setPartyId(h.id);
                  }
                }}
                style={{
                  padding: '8px 10px', fontSize: 13.5, cursor: 'pointer',
                  borderTop: i === 0 ? 'none' : '1px solid var(--aq-border-light)',
                }}>
                {h.name}
              </li>
            ))}
          </ul>
        )}
        {partyName.trim() && !partyId && (
          <p style={{ fontSize: 12, color: 'var(--aq-text-muted)', marginTop: 6 }}>
            Not linked to a record {'\u2014'} the matter will carry this name only.
          </p>
        )}

        <label style={{ ...label, marginTop: 14 }}>What it is about</label>
        <select className="aq-select" value={kind} disabled={busy}
          onChange={(e) => setKind(e.target.value)} style={{ width: '100%' }}>
          {MATTER_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
        </select>

        <label style={{ ...label, marginTop: 14 }}>Title</label>
        <input className="aq-input" value={shown} disabled={busy}
          onChange={(e) => { setTitleTouched(true); setTitle(e.target.value); }}
          style={{ width: '100%' }} />

        <label style={{ ...label, marginTop: 14 }}>Amount in dispute (optional)</label>
        <input className="aq-input" value={amount} disabled={busy} inputMode="decimal"
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Leave blank if it is not about a sum" style={{ width: '100%' }} />

        {(err || problems.length > 0) && (
          <p style={{ fontSize: 12.5, color: err ? 'var(--aq-error, #b3261e)' : 'var(--aq-text-muted)', marginTop: 12 }}>
            {err || problems[0]}
          </p>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18 }}>
          <button className="aq-btn aq-btn-ghost" onClick={onCancel} disabled={busy}>Cancel</button>
          <button className="aq-btn aq-btn-primary" onClick={() => void save()}
            disabled={busy || problems.length > 0}>
            {busy ? 'Opening\u2026' : 'Open the matter'}
          </button>
        </div>
      </div>
    </div>
  );
}
