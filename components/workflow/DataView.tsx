'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  useClients, useLegacyVendors, useWorkspaceProfiles,
  useTaskSources, useClientCategories, useServiceTypes,
} from '@/hooks/use-workflow';
import { useDashboardRows } from '@/hooks/use-dashboard';
import { SkeletonDashboard } from '@/components/Skeleton';
import {
  ALL_TIME, buildDashboard, scopeRows, sumMoney, searchEntities, compact, full, toCsv,
  type Cell, type DateRange, type Scope, type SearchHit, type Tone,
} from '@/lib/dashboard-data';
import {
  clientLedger, vendorLedger, ledgerTotals, shares, filterLedger, sortLedger,
  nextLedgerSort, isLedgerFiltered, ledgerLine, emptyLedgerMessage, ledgerCsv,
  marginRate, ratePct, money as sar,
  SIDES, PAY_KEYS, LEDGER_COLUMNS, EMPTY_LEDGER_FILTER, DEFAULT_LEDGER_SORT,
  payLabel, payTone,
  type LedgerFilter, type LedgerRow, type LedgerSort, type LedgerSortKey,
  type LedgerTotals, type PayKey, type Side,
} from '@/lib/money-ledger';

/**
 * The Data view — one search box over everything, and the same page narrowed
 * to whoever you pick.
 *
 * Colour rule, and it is a rule: this page is white and black. Hue appears
 * only where it means a state somebody has to act on — contract not signed,
 * payment outstanding, partly paid. Quantities are grey. Price / Net / AQ
 * gross are nested (price ⊃ net ⊃ gross), so they are one grey ramp rather
 * than three identities competing for attention.
 *
 * Chart fills are literal hex, not `var(--aq-…)`. A CSS variable that
 * resolves to nothing renders an SVG fill as transparent, and a chart that
 * silently draws nothing is much harder to notice than one that draws wrong.
 *
 * Every number on this page is computed in lib/dashboard-data.ts, which has
 * no React and no Supabase in it and is unit tested. This file only draws.
 */

/* ── the only colours on the page ─────────────────────────────── */
const INK = '#18181b';
const SERIES: [string, string, string] = ['#18181b', '#71717a', '#b4b4bb'];  // price, net, gross
const TONE_FILL: Record<Tone, string> = {
  ok: '#15803d', wait: '#a16207', bad: '#b91c1c', none: '#71717a',
};
const TONE_BG: Record<Tone, string> = {
  ok: '#dcfce7', wait: '#fef9c3', bad: '#fee2e2', none: '#f1f1f3',
};

type RangeKey = 'all' | 'year' | 'd90' | 'custom';

export function DataView({
  workspaceId, onOpenTask,
}: {
  workspaceId: string;
  /** Click a table row → open that task in the detail panel. */
  onOpenTask?: (taskId: string) => void;
}) {
  // No Refresh button here either: the rows reload whenever this view is
  // opened, and the sixty-second cache means switching away and back is the
  // refresh. See the note in the workflow page.
  const { rows, loading, error } = useDashboardRows(workspaceId);
  const { clients } = useClients();
  const { vendors } = useLegacyVendors();
  const { profiles } = useWorkspaceProfiles(workspaceId);
  // The vendor report prints Source, Client ctg and Ctg by name, not by id.
  const { items: sources } = useTaskSources(workspaceId);
  const { items: clientCategories } = useClientCategories(workspaceId);
  const { serviceTypes } = useServiceTypes(workspaceId);

  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<Scope | null>(null);
  const [rangeKey, setRangeKey] = useState<RangeKey>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  // Today is read after mount, never during render: the server has no idea
  // what day it is where you are, and a date that differs between the two
  // renders is a hydration error.
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => { setToday(new Date().toISOString().slice(0, 10)); }, []);

  const boxRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const hits: SearchHit[] = useMemo(
    () => searchEntities(query, clients, vendors),
    [query, clients, vendors],
  );

  const range: DateRange = useMemo(() => {
    if (rangeKey === 'all' || !today) return ALL_TIME;
    if (rangeKey === 'custom') return { from: from || null, to: to || null };
    if (rangeKey === 'year') return { from: `${today.slice(0, 4)}-01-01`, to: null };
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 89);
    return { from: d.toISOString().slice(0, 10), to: null };
  }, [rangeKey, from, to, today]);

  const lookups = useMemo(
    () => ({ sources, clientCategories, serviceTypes }),
    [sources, clientCategories, serviceTypes],
  );

  const model = useMemo(() => buildDashboard({
    tasks: rows, clients, vendors, people: profiles, scope, range, lookups,
  }), [rows, clients, vendors, profiles, scope, range, lookups]);

  /* ── Section 2: who owes us, and who do we owe ────────────────
     Siraj, Aug 2026: "client owe and vendors owe — you need to be able to
     search by unpaid or paid or partial." The old page could show the shape
     of it and not the rows: SAR 712,000 outstanding, and no way to find out
     from whom.

     Built from the same scoped rows every other panel uses, so this costs
     no extra request. */
  const scoped = useMemo(() => scopeRows(rows, scope, range), [rows, scope, range]);
  const clientNames = useMemo(
    () => new Map(clients.map((c) => [c.id, c.company_name])), [clients]);
  const vendorNames = useMemo(
    () => new Map(vendors.map((v) => [String(v.id), v.name])), [vendors]);

  const [side, setSide] = useState<Side>('clients');
  const [ledgerFilter, setLedgerFilter] = useState<LedgerFilter>(EMPTY_LEDGER_FILTER);
  const [ledgerSort, setLedgerSort] = useState<LedgerSort>(DEFAULT_LEDGER_SORT);

  const ledger = useMemo(() => (side === 'clients'
    ? clientLedger({ parents: scoped.parents, subtasks: scoped.allSubtasks, clientName: clientNames })
    : vendorLedger({ subtasks: scoped.subtasks, parents: scoped.parents, vendorName: vendorNames })
  ), [side, scoped, clientNames, vendorNames]);

  const ledgerAll = useMemo(() => ledgerTotals(ledger, side), [ledger, side]);
  const ledgerShown = useMemo(
    () => sortLedger(filterLedger(ledger, ledgerFilter), ledgerSort),
    [ledger, ledgerFilter, ledgerSort],
  );

  // The margin rate — the number this page never had. `Est AQ gross` is an
  // absolute, and an absolute goes up whenever we do more work.
  // Exactly the sum every model in lib/dashboard-data computes for its KPIs,
  // so the rate and the figures above it can never disagree.
  const totalMoney = useMemo(() => sumMoney(scoped.subtasks), [scoped]);
  const rate = marginRate(totalMoney.price, totalMoney.net);

  const pick = (h: SearchHit) => {
    setScope({ kind: h.kind, id: h.id, name: h.name, meta: h.meta });
    setQuery(h.name);
    setOpen(false);
  };

  const clear = () => { setScope(null); setQuery(''); setOpen(false); };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* No title here on purpose — the page shell already prints "Data"
          above every view, and two headings stacked read as a mistake. */}

      {/* ── search ─────────────────────────────────────────────── */}
      <div className="aq-card" style={{ padding: 16 }}>
        <div ref={boxRef} style={{ position: 'relative' }}>
          <input
            className="aq-input"
            value={query}
            placeholder="Search a client or vendor — name, CR, VAT, ID or licence"
            onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            style={{ width: '100%', fontSize: 15, padding: '12px 14px' }}
          />
          {open && hits.length > 0 && (
            <div style={{
              position: 'absolute', zIndex: 30, left: 0, right: 0, top: 'calc(100% + 6px)',
              background: 'var(--aq-bg-elevated, #fff)',
              border: '1px solid var(--aq-border-light)',
              borderRadius: 'var(--aq-radius)',
              boxShadow: 'var(--aq-shadow-lg, 0 12px 30px rgba(0,0,0,.12))',
              overflow: 'hidden',
            }}>
              {hits.map((h) => (
                // Two lines, not one. Client names here run to
                // "Science and Sunshine Advertising Agency FZ LLC", which on a
                // single row wrapped to six lines and pushed "matched on" off
                // the edge — the one part of the row that explains why a bare
                // number found anything.
                <button
                  key={`${h.kind}-${h.id}`}
                  type="button"
                  onClick={() => pick(h)}
                  style={{
                    display: 'block', width: '100%',
                    textAlign: 'left', font: 'inherit', background: 'none', border: 0,
                    padding: '10px 14px', cursor: 'pointer',
                    borderBottom: '1px solid var(--aq-border-light)',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--aq-bg-sunken)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span className="aq-badge aq-badge-muted"
                          style={{ textTransform: 'uppercase', fontSize: 10, flex: 'none' }}>
                      {h.kind}
                    </span>
                    <span style={{
                      fontWeight: 500, flex: 1, minWidth: 0,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>{h.name}</span>
                    <span style={{ fontSize: 12, color: 'var(--aq-text-muted)', flex: 'none' }}>
                      matched on {h.matched}
                    </span>
                  </span>
                  <span style={{
                    display: 'block', fontSize: 12, color: 'var(--aq-text-muted)',
                    marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{h.meta}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <p style={{ fontSize: 12.5, color: 'var(--aq-text-muted)', margin: '8px 0 0' }}>
          One box. It matches on name, CR number, VAT number, ID number and licence number, so you can
          paste whichever one you happen to have. Leave it empty and you are looking at the whole workspace.
        </p>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
          <span style={{ fontSize: 12.5, color: 'var(--aq-text-muted)' }}>Created</span>
          {([['all', 'All time'], ['year', 'This year'], ['d90', 'Last 90 days'], ['custom', 'Custom']] as [RangeKey, string][])
            .map(([key, label]) => (
              <Chip key={key} on={rangeKey === key} onClick={() => setRangeKey(key)}>{label}</Chip>
            ))}
          {rangeKey === 'custom' && (
            <>
              <input type="date" className="aq-input" value={from} onChange={(e) => setFrom(e.target.value)}
                     style={{ padding: '5px 8px', fontSize: 12.5 }} />
              <span style={{ fontSize: 12.5, color: 'var(--aq-text-muted)' }}>to</span>
              <input type="date" className="aq-input" value={to} onChange={(e) => setTo(e.target.value)}
                     style={{ padding: '5px 8px', fontSize: 12.5 }} />
            </>
          )}
          <span style={{ fontSize: 12.5, color: 'var(--aq-text-muted)' }}>
            · optional. On All time you see the whole record.
          </span>
        </div>
      </div>

      {error && (
        <div className="aq-card" style={{ padding: 16 }}>
          <span className="aq-badge aq-badge-error">Error</span>
          <p style={{ marginTop: 8, fontSize: 13 }}>{error}</p>
        </div>
      )}

      {scope && (
        <div className="aq-card" style={{
          padding: '12px 15px', display: 'flex', alignItems: 'center', gap: 11,
          flexWrap: 'wrap', border: `1px solid ${INK}`,
        }}>
          <span className="aq-badge aq-badge-muted" style={{ textTransform: 'uppercase', fontSize: 10 }}>
            {scope.kind}
          </span>
          <strong style={{ fontSize: 15 }}>{scope.name}</strong>
          <span style={{ fontSize: 12.5, color: 'var(--aq-text-muted)' }}>{scope.meta}</span>
          <button type="button" className="aq-btn aq-btn-secondary" onClick={clear}
                  style={{ marginLeft: 'auto', fontSize: 12.5, padding: '5px 12px' }}>
            Clear
          </button>
        </div>
      )}

      {loading && rows.length === 0 ? (
        // It really is loading every campaign and every subtask, so this is
        // the slowest screen in the app. Showing the shape of the answer
        // beats a sentence explaining why it is taking a while.
        <SkeletonDashboard />
      ) : (
        <>
          {/* ── 1. Profitability ─────────────────────────────
              People do not arrive here wanting "the data". They arrive with
              one of three questions, so the page is three sections named
              after them, in the order they get asked. */}
          <Question title="Profitability" note="on the work billed" />

          <div className="aq-card" style={{ padding: '18px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
              <span style={{
                fontSize: 40, fontWeight: 800, letterSpacing: '-0.03em',
                fontVariantNumeric: 'tabular-nums', lineHeight: 1,
              }}>{compact(totalMoney.gross)}</span>
              <span style={{ fontSize: 14, color: 'var(--aq-text-muted)', fontWeight: 600 }}>
                SAR AQ net
              </span>
              {/* The rate, which this page never had. The absolute goes up
                  whenever we do more work; the rate says whether the work
                  was worth doing. */}
              <span style={{
                fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
                color: rate == null ? 'var(--aq-text-muted)'
                  : rate < 0 ? '#b91c1c' : 'var(--aq-text-secondary)',
              }}>{ratePct(rate)} margin</span>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 28, margin: '16px 0 4px' }}>
              {model.kpis.filter((k) => k.key !== 'AQ net').map((k) => (
                <span key={k.key}>
                  <span style={{
                    display: 'block', fontSize: 10, fontWeight: 700, letterSpacing: '.08em',
                    textTransform: 'uppercase', color: 'var(--aq-text-muted)',
                  }}>{k.key}</span>
                  <span style={{
                    display: 'block', fontSize: 17, fontWeight: 700, marginTop: 2,
                    fontVariantNumeric: 'tabular-nums',
                  }}>{k.value}</span>
                  <span style={{ display: 'block', fontSize: 11, color: 'var(--aq-text-muted)' }}>
                    {k.note}
                  </span>
                </span>
              ))}
            </div>

            <div style={{ marginTop: 18 }}>
              <h3 style={{ fontSize: 13.5, fontWeight: 700, margin: 0 }}>Money by month</h3>
              <p style={{ fontSize: 11.5, color: 'var(--aq-text-muted)', margin: '2px 0 12px' }}>
                Billed, vendors cost and AQ net. One axis — all three are SAR, and each sits inside
                the one before it. By the month the campaign was <strong>created</strong>,
                which is not the month it was invoiced.
              </p>
              <Legend items={[['Billed', SERIES[0]], ['Vendors cost', SERIES[1]], ['AQ net', SERIES[2]]]} />
              <Months bars={model.months} />
            </div>
          </div>

          {/* ── 2. Receivables and payables ────────────────
              The section Siraj asked for. The bar is the shape; the ledger
              under it is the rows, filterable by state and searchable. */}
          <Question title="Receivables and payables" note="the money still moving" />

          <div className="aq-card" style={{ padding: '18px 20px' }}>
            <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
              {SIDES.map((sd) => (
                <button
                  key={sd.key}
                  type="button"
                  aria-pressed={side === sd.key}
                  onClick={() => {
                    setSide(sd.key);
                    // The state filter means different things on each side,
                    // so carrying it across would silently answer a question
                    // nobody asked.
                    setLedgerFilter(EMPTY_LEDGER_FILTER);
                  }}
                  style={{
                    font: 'inherit', fontSize: 13, fontWeight: side === sd.key ? 700 : 500,
                    padding: '7px 14px', borderRadius: 'var(--aq-radius)', cursor: 'pointer',
                    border: `1px solid ${side === sd.key ? INK : 'var(--aq-border-light)'}`,
                    background: side === sd.key ? INK : 'transparent',
                    color: side === sd.key ? '#fff' : 'var(--aq-text-secondary)',
                  }}
                >{sd.label}</button>
              ))}
              <span style={{
                fontSize: 12, color: 'var(--aq-text-muted)', alignSelf: 'center', marginLeft: 4,
              }}>{ledgerLine(ledgerAll, side)}</span>
            </div>

            <PayBar
              totals={ledgerAll}
              side={side}
              active={ledgerFilter.state}
              onPick={(k) => setLedgerFilter((f) => ({
                ...f, state: f.state === k ? null : k, outstandingOnly: false,
              }))}
            />

            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              flexWrap: 'wrap', margin: '16px 0 12px',
            }}>
              {PAY_KEYS.map((k) => {
                const band = ledgerAll.states.find((x) => x.key === k);
                return (
                  <Chip
                    key={k}
                    on={ledgerFilter.state === k}
                    onClick={() => setLedgerFilter((f) => ({
                      ...f, state: f.state === k ? null : k, outstandingOnly: false,
                    }))}
                  >
                    {payLabel(k, side)}
                    {band ? ` ${band.count}` : ''}
                  </Chip>
                );
              })}
              {/* Not the same question as "unpaid": a partly-paid campaign
                  is not unpaid, and somebody still has to chase it. */}
              <Chip
                on={ledgerFilter.outstandingOnly}
                onClick={() => setLedgerFilter((f) => ({
                  ...f, outstandingOnly: !f.outstandingOnly, state: null,
                }))}
              >Balance due</Chip>

              <input
                className="aq-input"
                value={ledgerFilter.query}
                onChange={(e) => setLedgerFilter((f) => ({ ...f, query: e.target.value }))}
                placeholder={side === 'clients'
                  ? 'Filter these rows — client or campaign'
                  : 'Filter these rows — vendor or campaign'}
                style={{ flex: '1 1 220px', minWidth: 180, fontSize: 12.5, padding: '6px 11px' }}
              />

              {isLedgerFiltered(ledgerFilter) && (
                <button
                  type="button"
                  className="aq-btn aq-btn-ghost"
                  onClick={() => setLedgerFilter(EMPTY_LEDGER_FILTER)}
                  style={{ fontSize: 12.5, padding: '5px 10px', color: 'var(--aq-text-secondary)' }}
                >Clear</button>
              )}

              <button
                type="button"
                className="aq-btn aq-btn-secondary"
                disabled={ledgerShown.length === 0}
                title={ledgerShown.length === 0
                  ? 'Nothing to export — this list is empty'
                  : `Download these ${ledgerShown.length} rows as a CSV`}
                onClick={() => downloadLedger(ledgerShown, side, scope)}
                style={{
                  fontSize: 12.5, padding: '5px 12px', whiteSpace: 'nowrap',
                  opacity: ledgerShown.length === 0 ? 0.45 : 1,
                  cursor: ledgerShown.length === 0 ? 'not-allowed' : 'pointer',
                }}
              >Download CSV</button>
            </div>

            <Ledger
              rows={ledgerShown}
              side={side}
              sort={ledgerSort}
              onSort={(k) => setLedgerSort((cur) => nextLedgerSort(cur, k))}
              onOpen={onOpenTask}
              empty={emptyLedgerMessage(ledgerFilter, side, ledger.length)}
            />
          </div>

          {/* ── 3. Where the revenue comes from ───────────────────────── */}
          <Question title="Where the revenue comes from" note="and who does the work" />

          <div style={{
            display: 'grid', gap: 14, alignItems: 'start',
            gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))',
          }}>
            <Panel title={model.bars2.title} caption={model.bars2.caption}>
              <Bars panel={model.bars2} />
            </Panel>
            <Panel title={model.bars1.title} caption={model.bars1.caption}>
              <Bars panel={model.bars1} />
            </Panel>
          </div>

          {/* The workspace table used to be a second "Needs attention" with
              its own two rules, competing with the Dashboard panel of the
              same name and ten. The Dashboard owns that question. A scoped
              view still gets its table — for a vendor that is AQ's own
              seventeen-column report, which is not a duplicate of anything. */}
          {scope && (
            <Panel
              title={model.table.title}
              caption={model.table.caption}
              action={(
                <button
                  type="button"
                  className="aq-btn aq-btn-secondary"
                  disabled={model.table.rows.length === 0}
                  title={model.table.rows.length === 0
                    ? 'Nothing to export yet — this table is empty'
                    : `Download these ${model.table.rows.length} rows as a CSV`}
                  onClick={() => downloadCsv(model.table, scope)}
                  style={{
                    fontSize: 12.5, padding: '5px 12px', whiteSpace: 'nowrap',
                    opacity: model.table.rows.length === 0 ? 0.45 : 1,
                    cursor: model.table.rows.length === 0 ? 'not-allowed' : 'pointer',
                  }}
                >Download CSV</button>
              )}
            >
              {model.table.rows.length === 0 ? (
                <p style={{ fontSize: 13, color: 'var(--aq-text-muted)' }}>Nothing to show here.</p>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 560 }}>
                    <thead>
                      <tr>
                        {model.table.columns.map((c, i) => (
                          <th key={c} style={{
                            textAlign: i === model.table.columns.length - 1 ? 'right' : 'left',
                            fontSize: 10.5, letterSpacing: '.09em', textTransform: 'uppercase',
                            color: 'var(--aq-text-muted)', padding: '7px 10px',
                            borderBottom: '1px solid var(--aq-border-light)',
                            whiteSpace: 'nowrap',
                          }}>{c}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {model.table.rows.map((r) => (
                        <tr
                          key={r.id}
                          onClick={onOpenTask ? () => onOpenTask(r.id) : undefined}
                          style={{ cursor: onOpenTask ? 'pointer' : 'default' }}
                          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--aq-bg-sunken)'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                        >
                          {r.cells.map((cell, i) => <TableCell key={i} cell={cell} />)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          )}

          <p style={{ fontSize: 11.5, color: 'var(--aq-text-muted)' }}>
            Built from {full(model.counted.parents)} campaigns and {full(model.counted.subtasks)} subtasks
            {loading ? ' · refreshing…' : ''}. {model.note}
          </p>
        </>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────
   Small pieces
   ──────────────────────────────────────────────────────────────── */

/** A section heading written as the question people arrive with. */
function Question({ title, note }: { title: string; note: string }) {
  return (
    <h2 style={{
      display: 'flex', alignItems: 'baseline', gap: 9, flexWrap: 'wrap',
      fontSize: 11, fontWeight: 700, letterSpacing: '.09em', textTransform: 'uppercase',
      color: 'var(--aq-text-muted)', margin: '10px 0 0',
    }}>
      {title}
      <span style={{
        textTransform: 'none', letterSpacing: 0, fontWeight: 400, fontSize: 12.5,
      }}>· {note}</span>
    </h2>
  );
}

/**
 * Paid / partly paid / outstanding, as one bar.
 *
 * A bar, not a donut. Three parts of one total read across a line; as wedges
 * you have to compare angles, and the centre number ends up repeating the
 * caption. Each band is also the filter — clicking it is the same as
 * clicking the chip underneath, because somebody who has just looked at the
 * red part wants the red rows.
 */
function PayBar({
  totals, side, active, onPick,
}: {
  totals: LedgerTotals;
  side: Side;
  active: PayKey | null;
  onPick: (k: PayKey) => void;
}) {
  const pcts = shares(totals);
  if (totals.total <= 0 || pcts.length === 0) {
    return (
      <p style={{ fontSize: 13, color: 'var(--aq-text-muted)' }}>
        {side === 'clients'
          ? 'Nothing billed in this period.'
          : 'No vendor bookings with a recorded cost in this period.'}
      </p>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', height: 28, gap: 2, borderRadius: 6, overflow: 'hidden' }}>
        {pcts.map(({ key, pct }) => {
          const band = totals.states.find((x) => x.key === key)!;
          const on = active === key;
          return (
            <button
              key={key}
              type="button"
              aria-pressed={on}
              onClick={() => onPick(key)}
              title={`${payLabel(key, side)} — SAR ${sar(band.amount)} across ${band.count}`}
              style={{
                width: `${pct}%`, height: '100%', border: 'none', padding: 0, cursor: 'pointer',
                background: TONE_FILL[payTone(key)],
                // Selected is an inset outline, not a different hue: the hue
                // already means the payment state and cannot mean two things.
                boxShadow: on ? 'inset 0 0 0 2px var(--aq-text)' : 'none',
                opacity: active && !on ? 0.45 : 1,
              }}
            >
              <span style={SR_ONLY}>
                {payLabel(key, side)}: SAR {sar(band.amount)} across {band.count}
              </span>
            </button>
          );
        })}
      </div>
      {/* The key carries the money. Colour alone is never the label. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 10, fontSize: 11.5 }}>
        {totals.states.map((b) => (
          <span key={b.key} style={{ color: 'var(--aq-text-secondary)' }}>
            <i style={{
              width: 9, height: 9, borderRadius: 2, display: 'inline-block',
              marginRight: 6, background: TONE_FILL[payTone(b.key)],
            }} />
            {payLabel(b.key, side)}{' '}
            <strong style={{ fontVariantNumeric: 'tabular-nums' }}>SAR {sar(b.amount)}</strong>
            <span style={{ color: 'var(--aq-text-muted)' }}> · {b.count}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** The rows behind the bar. */
function Ledger({
  rows, side, sort, onSort, onOpen, empty,
}: {
  rows: LedgerRow[];
  side: Side;
  sort: LedgerSort;
  onSort: (k: LedgerSortKey) => void;
  onOpen?: (id: string) => void;
  empty: string;
}) {
  if (rows.length === 0) {
    return (
      <p style={{
        fontSize: 13, color: 'var(--aq-text-muted)', padding: '22px 0', textAlign: 'center',
      }}>{empty}</p>
    );
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table data-ledger="" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 720 }}>
        <thead>
          <tr>
            {LEDGER_COLUMNS.map((c) => {
              const on = sort.key === c.key;
              return (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                  style={{
                    textAlign: c.align, padding: 0,
                    borderBottom: '1px solid var(--aq-border-light)',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => onSort(c.key)}
                    style={{
                      display: 'flex', gap: 4, width: '100%',
                      justifyContent: c.align === 'right' ? 'flex-end' : 'flex-start',
                      padding: '7px 10px', border: 'none', background: 'none',
                      font: 'inherit', fontSize: 10, fontWeight: 700,
                      letterSpacing: '.08em', textTransform: 'uppercase',
                      color: on ? 'var(--aq-text)' : 'var(--aq-text-muted)',
                      cursor: 'pointer', whiteSpace: 'nowrap',
                    }}
                  >
                    {c.label(side)}
                    <span aria-hidden style={{ fontSize: 8, opacity: on ? 1 : 0 }}>
                      {on && sort.dir === 'desc' ? '▼' : '▲'}
                    </span>
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.id}
              onClick={onOpen ? () => onOpen(r.id) : undefined}
              style={{ cursor: onOpen ? 'pointer' : 'default' }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--aq-bg-sunken)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              <LTd>
                <strong style={{ fontWeight: 600 }}>{r.party}</strong>
                {/* Somebody ticked one box and not the other. Not an error,
                    but the sort of thing that becomes an argument with a
                    client six weeks later. */}
                {r.mismatch && (
                  <span style={{
                    display: 'block', fontSize: 11, color: '#a16207', fontWeight: 600, marginTop: 2,
                    // The cell is nowrap so the money columns line up; this
                    // sentence is prose and has to be allowed to wrap, or it
                    // drags the whole table off the side of its card.
                    whiteSpace: 'normal', maxWidth: 320,
                  }}>{r.mismatch}</span>
                )}
              </LTd>
              <LTd muted>{r.campaign}</LTd>
              <LTd>
                <span style={{
                  display: 'inline-block', fontSize: 10.5, fontWeight: 700,
                  padding: '3px 9px', borderRadius: 9999, whiteSpace: 'nowrap',
                  background: TONE_BG[r.tone], color: TONE_FILL[r.tone],
                }}>{r.stateLabel}</span>
              </LTd>
              <LTd align="right">{sar(r.total)}</LTd>
              <LTd align="right" muted={r.paid <= 0}>{r.paid > 0 ? sar(r.paid) : '—'}</LTd>
              <LTd align="right">
                <span style={{
                  fontWeight: r.outstanding > 0 ? 700 : 400,
                  color: r.outstanding > 0 ? TONE_FILL.bad : 'var(--aq-text-muted)',
                }}>{r.outstanding > 0 ? sar(r.outstanding) : '—'}</span>
              </LTd>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LTd({
  children, align = 'left', muted,
}: { children: React.ReactNode; align?: 'left' | 'right'; muted?: boolean }) {
  return (
    <td style={{
      padding: '9px 10px', textAlign: align,
      borderBottom: '1px solid var(--aq-border-light)',
      color: muted ? 'var(--aq-text-muted)' : 'var(--aq-text)',
      whiteSpace: 'nowrap',
      fontVariantNumeric: align === 'right' ? 'tabular-nums' : undefined,
      verticalAlign: 'top',
    }}>{children}</td>
  );
}

/**
 * The ledger as it stands, as a file — same rows, same filter, same order.
 * A download that quietly ignored the filters would be worse than none,
 * because the numbers would look authoritative and be wrong.
 */
function downloadLedger(rows: LedgerRow[], side: Side, scope: Scope | null) {
  // A BOM, so Excel opens Arabic client and vendor names correctly.
  const blob = new Blob(['\uFEFF' + ledgerCsv(rows, side)], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const who = (scope?.name ?? 'workspace').replace(/[^\w\u0600-\u06FF-]+/g, '-').slice(0, 40);
  a.href = url;
  a.download = `AQ-${who}-${side}-owed.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const SR_ONLY: React.CSSProperties = {
  position: 'absolute', width: 1, height: 1, padding: 0, margin: -1,
  overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
};

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      style={{
        font: 'inherit', fontSize: 12.5, cursor: 'pointer',
        padding: '5px 12px', borderRadius: 9999,
        background: on ? INK : 'transparent',
        color: on ? '#fff' : 'var(--aq-text-secondary)',
        border: `1px solid ${on ? INK : 'var(--aq-border-light)'}`,
        fontWeight: on ? 600 : 400,
      }}
    >{children}</button>
  );
}

function Panel({ title, caption, children, action }: {
  title: string;
  caption: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="aq-card" style={{ padding: '16px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>{title}</h2>
          <p style={{ fontSize: 12, color: 'var(--aq-text-muted)', margin: '2px 0 14px' }}>{caption}</p>
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

/**
 * The table as it stands, as a file.
 *
 * Whatever is on screen is what downloads — same rows, same scope, same date
 * range. A download that quietly ignored the filters would be worse than no
 * download, because the numbers would look authoritative and be wrong.
 */
function downloadCsv(table: { columns: string[]; rows: { cells: Cell[] }[]; title: string }, scope: Scope | null) {
  const csv = toCsv(table as any);
  // A BOM, so Excel opens Arabic client and vendor names correctly instead
  // of as mojibake.
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const who = (scope?.name ?? 'workspace').replace(/[^\w\u0600-\u06FF-]+/g, '-').slice(0, 40);
  a.href = url;
  a.download = `AQ-${who}-report.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function Legend({ items }: { items: [string, string][] }) {
  return (
    <div style={{ display: 'flex', gap: 15, flexWrap: 'wrap', marginBottom: 10 }}>
      {items.map(([label, fill]) => (
        <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
          <i style={{ width: 10, height: 10, borderRadius: 3, background: fill, display: 'inline-block' }} />
          {label}
        </span>
      ))}
    </div>
  );
}

function TableCell({ cell }: { cell: Cell }) {
  // nowrap, and the container scrolls sideways. The report is seventeen
  // columns wide; letting cells wrap turned every row into three lines of
  // ragged text and made a ledger impossible to read across.
  const base = {
    padding: '9px 10px',
    borderBottom: '1px solid var(--aq-border-light)',
    whiteSpace: 'nowrap' as const,
  } as const;
  if (cell.kind === 'pill') {
    return (
      <td style={base}>
        <span style={{
          display: 'inline-block', fontSize: 10.5, fontWeight: 700,
          padding: '3px 9px', borderRadius: 9999,
          background: TONE_BG[cell.tone], color: TONE_FILL[cell.tone],
        }}>{cell.text}</span>
      </td>
    );
  }
  return (
    <td style={{
      ...base,
      textAlign: cell.kind === 'num' ? 'right' : 'left',
      fontVariantNumeric: cell.kind === 'num' ? 'tabular-nums' : undefined,
    }}>{cell.text}</td>
  );
}

/* ── hover tooltip, shared by all three charts ────────────────── */

interface Tip { x: number; y: number; title: string; line: string }

function useTip() {
  const [tip, setTip] = useState<Tip | null>(null);
  const show = (e: React.MouseEvent, title: string, line: string) =>
    setTip({ x: e.clientX, y: e.clientY, title, line });
  const hide = () => setTip(null);
  const node = tip ? (
    <div style={{
      position: 'fixed', zIndex: 60, pointerEvents: 'none',
      left: Math.min(tip.x + 14, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 210),
      top: tip.y - 10,
      background: INK, color: '#fff', fontSize: 12, padding: '7px 10px',
      borderRadius: 7, whiteSpace: 'nowrap',
    }}>
      <strong>{tip.title}</strong><br />{tip.line}
    </div>
  ) : null;
  return { show, hide, node };
}

/* ── grouped columns ──────────────────────────────────────────── */

function Months({ bars }: { bars: { key: string; label: string; short: string; price: number; net: number; gross: number }[] }) {
  const { show, hide, node } = useTip();
  if (!bars.length) {
    return <p style={{ fontSize: 13, color: 'var(--aq-text-muted)' }}>No campaigns in this period.</p>;
  }
  // Campaigns exist but carry no money yet. An axis of 0 / 1 / 1 over six
  // flat months looks like a broken chart; saying so is more use.
  const peak = Math.max(...bars.map((b) => b.price));
  if (peak <= 0) {
    return (
      <p style={{ fontSize: 13, color: 'var(--aq-text-muted)' }}>
        These campaigns have no price or net recorded on their subtasks yet, so there is nothing to plot.
      </p>
    );
  }

  const W = 520, H = 240, L = 54, R = 8, T = 16, B = 34;
  const iw = W - L - R, ih = H - T - B;
  const step = Math.pow(10, Math.floor(Math.log10(peak)));
  const max = Math.ceil(peak / (step / 2)) * (step / 2);
  const y = (v: number) => T + ih - (v / max) * ih;
  const gw = iw / bars.length;
  const bw = Math.min(18, (gw - 30) / 3);
  const gap = 4;
  const series: [keyof typeof bars[0], string, string][] = [
    ['price', SERIES[0], 'Billed'], ['net', SERIES[1], 'Vendors cost'], ['gross', SERIES[2], 'AQ net'],
  ];

  return (
    <>
      {node}
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label="Money by month"
           style={{ display: 'block', overflow: 'visible' }}>
        {[0, max / 2, max].map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="var(--aq-border-light)" strokeWidth={1} />
            <text x={L - 8} y={y(v) + 4} textAnchor="end" fontSize={10.5} fill="var(--aq-text-muted)">
              {v === 0 ? '0' : compact(v)}
            </text>
          </g>
        ))}
        {bars.map((d, i) => (
          <g key={d.key}>
            {series.map(([field, fill, label], j) => {
              const value = d[field] as number;
              const x = L + i * gw + (gw - (bw * 3 + gap * 2)) / 2 + j * (bw + gap);
              const h = Math.max(value > 0 ? 2 : 0, T + ih - y(Math.max(value, 0)));
              return (
                <g key={label}>
                  <rect
                    x={x} y={y(Math.max(value, 0))} width={bw} height={h} rx={4} fill={fill}
                    style={{ cursor: 'pointer' }}
                    onMouseMove={(e) => show(e, `${d.label} · ${label}`, `SAR ${full(value)}`)}
                    onMouseLeave={hide}
                  />
                  {/* The lightest step is under 3:1 on white, so AQ gross always
                      carries its own number, haloed against whatever is behind it. */}
                  {field === 'gross' && value > 0 && (
                    <text
                      x={x + bw / 2} y={y(value) - 7} textAnchor="middle"
                      fontSize={10} fontWeight={700} fill="var(--aq-text-secondary)"
                      stroke="#fff" strokeWidth={3} paintOrder="stroke" strokeLinejoin="round"
                    >{compact(value)}</text>
                  )}
                </g>
              );
            })}
            <text x={L + i * gw + gw / 2} y={H - B + 18} textAnchor="middle"
                  fontSize={10.5} fill="var(--aq-text-muted)">{d.short}</text>
          </g>
        ))}
      </svg>
      <details style={{ marginTop: 12 }}>
        <summary style={{ fontSize: 12, color: 'var(--aq-text-muted)', cursor: 'pointer' }}>Show as a table</summary>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginTop: 6 }}>
          <thead>
            <tr>
              {['Month', 'Billed', 'Vendors cost', 'AQ net'].map((h, i) => (
                <th key={h} style={{
                  textAlign: i ? 'right' : 'left', fontSize: 10.5, textTransform: 'uppercase',
                  letterSpacing: '.09em', color: 'var(--aq-text-muted)', padding: '6px 8px',
                  borderBottom: '1px solid var(--aq-border-light)',
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {bars.map((d) => (
              <tr key={d.key}>
                <td style={{ padding: '7px 8px' }}>{d.label}</td>
                <td style={{ padding: '7px 8px', textAlign: 'right' }}>{full(d.price)}</td>
                <td style={{ padding: '7px 8px', textAlign: 'right' }}>{full(d.net)}</td>
                <td style={{ padding: '7px 8px', textAlign: 'right' }}>{full(d.gross)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </>
  );
}

/* ── horizontal bars, one ink, direct labels ──────────────────── */

function Bars({ panel }: { panel: { rows: { key: string; label: string; value: number; display: string }[] } }) {
  const { show, hide, node } = useTip();
  if (!panel.rows.length) {
    return <p style={{ fontSize: 13, color: 'var(--aq-text-muted)' }}>Nothing here yet.</p>;
  }

  const W = 520, L = 130, R = 66, T = 8, bh = 17, gap = 12;
  const max = Math.max(...panel.rows.map((r) => r.value), 1);
  const H = T + panel.rows.length * (bh + gap);

  return (
    <>
      {node}
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label="Magnitude by category"
           style={{ display: 'block', overflow: 'visible' }}>
        {panel.rows.map((r, i) => {
          const y = T + i * (bh + gap);
          const w = Math.max(3, (r.value / max) * (W - L - R));
          return (
            <g key={r.key}>
              <text x={L - 10} y={y + 13} textAnchor="end" fontSize={12} fill="var(--aq-text-secondary)">
                {r.label.length > 22 ? `${r.label.slice(0, 21)}…` : r.label}
              </text>
              <rect
                x={L} y={y} width={w} height={bh} rx={4} fill={INK} style={{ cursor: 'pointer' }}
                onMouseMove={(e) => show(e, r.label, r.display)}
                onMouseLeave={hide}
              />
              <text x={L + w + 8} y={y + 13} fontSize={11} fontWeight={700} fill="var(--aq-text-secondary)">
                {r.display}
              </text>
            </g>
          );
        })}
      </svg>
    </>
  );
}
