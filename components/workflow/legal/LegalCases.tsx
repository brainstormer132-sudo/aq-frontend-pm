'use client';

import { useEffect, useMemo, useState } from 'react';
import { useClients, useLegacyVendors } from '@/hooks/use-workflow';
import { useDashboardRows } from '@/hooks/use-dashboard';
import { useMatters, useMatterEvents, type MatterRow } from '@/hooks/use-legal';
import { scopeRows, ALL_TIME } from '@/lib/dashboard-data';
import { clientLedger, vendorLedger, money, type TermSet } from '@/lib/money-ledger';
import {
  MATTER_STATUSES, EVENT_KINDS,
  matterStatusLabel, matterStatusBadge, matterClosed, matterKindLabel, eventKindLabel,
  matterWarnings, warningsLine, sortMatters, mattersLine,
  type MatterSide, type MatterWarning,
} from '@/lib/legal-matters';
import { AqDrawingBlock } from '@/components/AQLoading';

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
 * The side, its warnings, its matters and both header lines come out of ONE
 * useMemo, and the body is keyed on the side so switching rebuilds it rather
 * than patching it. This is the Collection-header-over-Liability-rows bug from
 * the Data view, and it would be worse here: a client's name over a vendor's
 * debt, on the screen that decides who gets a lawyer's letter.
 */

/** Warnings shown before folding the rest into a counted line. */
const SHOW_WARNINGS = 5;

export function LegalCases({ workspaceId }: { workspaceId?: string }) {
  const { rows, loading: rowsLoading } = useDashboardRows(workspaceId ?? null);
  const { clients } = useClients();
  const { vendors } = useLegacyVendors();
  const {
    matters, loading: mattersLoading, error, open, setStatus, remove,
  } = useMatters(workspaceId ?? null);

  const [side, setSide] = useState<MatterSide>('client');
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState('');
  const [formErr, setFormErr] = useState('');
  const [showAll, setShowAll] = useState(false);

  // Today is read after mount, never during render: the server does not know
  // what day it is here, and a date that differs between the two renders is a
  // hydration error. Until it arrives the ledger dates on its own default.
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => { setToday(new Date().toISOString().slice(0, 10)); }, []);

  useEffect(() => { setShowAll(false); setFormErr(''); }, [side]);

  const clientNames = useMemo(
    () => new Map(clients.map((c) => [c.id, c.company_name])), [clients]);
  const vendorNames = useMemo(
    () => new Map(vendors.map((v) => [String(v.id), v.name])), [vendors]);
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
  const view = useMemo(() => {
    const ledger = side === 'client'
      ? clientLedger({
        parents: scoped.parents, subtasks: scoped.allSubtasks,
        clientName: clientNames, clientTerms, today: today ?? undefined,
      })
      : vendorLedger({
        subtasks: scoped.subtasks, parents: scoped.parents,
        vendorName: vendorNames, today: today ?? undefined,
      });
    const mine = matters.filter((m) => m.party_type === side);
    const handled = new Set(mine.map((m) => m.source_key).filter(Boolean) as string[]);
    const warnings = matterWarnings({ rows: ledger, side, party: partyIds, handled });
    return {
      side,
      warnings,
      warningsLine: warningsLine(warnings, side),
      matters: sortMatters(mine) as MatterRow[],
      mattersLine: mattersLine(mine),
    };
  }, [side, scoped, clientNames, vendorNames, clientTerms, today, matters, partyIds]);

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

  const loading = rowsLoading || mattersLoading;

  return (
    <div className="aq-view" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button className={`aq-btn ${side === 'client' ? 'aq-btn-primary' : 'aq-btn-ghost'}`}
          onClick={() => setSide('client')}>Clients</button>
        <button className={`aq-btn ${side === 'vendor' ? 'aq-btn-primary' : 'aq-btn-ghost'}`}
          onClick={() => setSide('vendor')}>Vendors</button>
      </div>

      {error && <div className="aq-badge aq-badge-error" style={{ display: 'block', padding: 10 }}>{error}</div>}
      {formErr && <div className="aq-badge aq-badge-error" style={{ display: 'block', padding: 10 }}>{formErr}</div>}

      {loading ? (
        <div className="aq-card" style={{ padding: 8 }}><AqDrawingBlock label={'Reading the ledger\u2026'} /></div>
      ) : (
        // Keyed on the side: switching rebuilds this, it does not patch it.
        <div key={view.side} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          <section className="aq-card" style={{ padding: 18 }}>
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

          <section className="aq-card" style={{ padding: 18 }}>
            <h3 style={{ fontSize: 15, fontWeight: 700 }}>Matters</h3>
            <p style={{ fontSize: 13, color: 'var(--aq-text-muted)', marginTop: 4 }}>{view.mattersLine}</p>
            {view.matters.length > 0 && (
              <ul style={{ listStyle: 'none', marginTop: 12 }}>
                {view.matters.map((m, i) => (
                  <li key={m.id} style={{
                    display: 'flex', alignItems: 'center', gap: 12, padding: '10px 4px',
                    borderTop: i === 0 ? 'none' : '1px solid var(--aq-border-light)',
                    opacity: matterClosed(m.status) ? 0.6 : 1,
                  }}>
                    <span role="button" tabIndex={0} onClick={() => setOpenId(m.id)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenId(m.id); } }}
                      style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}>
                      <span style={{ fontSize: 14, fontWeight: 600, display: 'block' }}>{m.title}</span>
                      <span style={{ fontSize: 12, color: 'var(--aq-text-muted)' }}>
                        {m.party_name} {'\u00b7'} {matterKindLabel(m.kind)}
                        {m.amount ? <> {'\u00b7'} SAR {money(m.amount)}</> : null}
                      </span>
                    </span>
                    <span className={`aq-badge ${matterStatusBadge(m.status)}`}>{matterStatusLabel(m.status)}</span>
                    <span role="button" tabIndex={0} onClick={() => setOpenId(m.id)}
                      style={{ fontSize: 14, color: 'var(--aq-text-muted)', cursor: 'pointer' }}>&rsaquo;</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
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
            onChange={(e) => void move(e.target.value)}>
            {MATTER_STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <span style={{ flex: 1 }} />
          <button className="aq-btn aq-btn-ghost" disabled={busy}
            onClick={async () => { if (confirm('Delete this matter and its whole log?')) await onDelete(); }}>
            Delete
          </button>
          <button className="aq-btn aq-btn-ghost" onClick={onClose} disabled={busy}>Close</button>
        </div>

        <div style={{ marginTop: 18, borderTop: '1px solid var(--aq-border-light)', paddingTop: 14 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <select className="aq-select" value={kind} onChange={(e) => setKind(e.target.value)} disabled={busy}>
              {EVENT_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
            </select>
            <input className="aq-input" value={body} onChange={(e) => setBody(e.target.value)}
              placeholder="What happened" style={{ flex: 1 }} disabled={busy}
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
