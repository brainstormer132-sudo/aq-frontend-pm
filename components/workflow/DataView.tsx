'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  useClients, useLegacyVendors, useWorkspaceProfiles,
  useTaskSources, useClientCategories, useServiceTypes,
} from '@/hooks/use-workflow';
import { useDashboardRows } from '@/hooks/use-dashboard';
import { SkeletonDashboard } from '@/components/Skeleton';
import {
  ALL_TIME, buildDashboard, searchEntities, compact, full, toCsv,
  type Cell, type DateRange, type Scope, type SearchHit, type Tone,
} from '@/lib/dashboard-data';

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
          <div style={{
            display: 'grid', gap: 12,
            gridTemplateColumns: 'repeat(auto-fit, minmax(158px, 1fr))',
          }}>
            {model.kpis.map((k) => (
              <div key={k.key} className="aq-card" style={{ padding: '14px 16px' }}>
                <div style={{
                  fontSize: 10.5, fontWeight: 700, letterSpacing: '.09em',
                  textTransform: 'uppercase', color: 'var(--aq-text-muted)',
                }}>{k.key}</div>
                <div style={{
                  fontSize: 26, fontWeight: 700, marginTop: 5,
                  letterSpacing: '-0.025em', fontVariantNumeric: 'tabular-nums',
                }}>{k.value}</div>
                <div style={{ fontSize: 11.5, color: 'var(--aq-text-muted)', marginTop: 3 }}>{k.note}</div>
              </div>
            ))}
          </div>

          <div style={{
            display: 'grid', gap: 14, alignItems: 'start',
            gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))',
          }}>
            <Panel
              title="Money by month"
              caption="Price, net and AQ gross. One axis — all three are SAR. Dark to light, because each one sits inside the one before it."
            >
              <Legend items={[['Price', SERIES[0]], ['Net', SERIES[1]], ['AQ gross', SERIES[2]]]} />
              <Months bars={model.months} />
            </Panel>

            <Panel title={model.donut.title} caption={model.donut.caption}>
              <Donut slices={model.donut.slices} centre={model.donut.centre} />
            </Panel>

            <Panel title={model.bars1.title} caption={model.bars1.caption}>
              <Bars panel={model.bars1} />
            </Panel>

            <Panel title={model.bars2.title} caption={model.bars2.caption}>
              <Bars panel={model.bars2} />
            </Panel>
          </div>

          <Panel
            title={model.table.title}
            caption={model.table.caption}
            // Always rendered, disabled when there is nothing to export.
            // Hiding it meant that on an empty workspace the export looked
            // like a feature that had never been built — an absent control
            // is indistinguishable from a missing one.
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
            <p style={{ fontSize: 12.5, color: 'var(--aq-text-muted)', lineHeight: 1.6, marginTop: 12 }}>
              {model.note}
            </p>
            <p style={{ fontSize: 11.5, color: 'var(--aq-text-muted)', marginTop: 6 }}>
              Built from {full(model.counted.parents)} campaigns and {full(model.counted.subtasks)} subtasks
              {loading ? ' · refreshing…' : ''}
            </p>
          </Panel>
        </>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────
   Small pieces
   ──────────────────────────────────────────────────────────────── */

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
    return <p style={{ fontSize: 13, color: 'var(--aq-text-muted)' }}>No campaigns in this window.</p>;
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
    ['price', SERIES[0], 'Price'], ['net', SERIES[1], 'Net'], ['gross', SERIES[2], 'AQ gross'],
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
              {['Month', 'Price', 'Net', 'AQ gross'].map((h, i) => (
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

/* ── donut, three states, status colours ──────────────────────── */

function Donut({
  slices, centre,
}: {
  slices: { key: string; label: string; value: number; tone: Tone }[];
  centre: [string, string];
}) {
  const { show, hide, node } = useTip();
  const total = slices.reduce((a, b) => a + b.value, 0);
  if (!total) {
    return <p style={{ fontSize: 13, color: 'var(--aq-text-muted)' }}>Nothing to split up in this window.</p>;
  }

  const cx = 140, cy = 120, r = 84, w = 30;
  let a0 = -Math.PI / 2;
  const arcs = slices.map((s) => {
    const frac = s.value / total;
    const a1 = a0 + frac * Math.PI * 2;
    const g = slices.length > 1 ? 0.018 : 0;
    const start = a0 + g, end = a1 - g;
    const large = end - start > Math.PI ? 1 : 0;
    const pt = (ang: number, rad: number) => [cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad];
    const [x1, y1] = pt(start, r), [x2, y2] = pt(end, r);
    const [x3, y3] = pt(end, r - w), [x4, y4] = pt(start, r - w);
    a0 = a1;
    return {
      ...s, frac,
      d: `M${x1},${y1}A${r},${r} 0 ${large} 1 ${x2},${y2}L${x3},${y3}A${r - w},${r - w} 0 ${large} 0 ${x4},${y4}Z`,
    };
  });

  return (
    <>
      {node}
      <svg viewBox="0 0 520 240" width="100%" height={240} role="img" aria-label="Payment status"
           style={{ display: 'block', overflow: 'visible' }}>
        {arcs.map((a) => (
          <path
            key={a.key} d={a.d} fill={TONE_FILL[a.tone]} style={{ cursor: 'pointer' }}
            onMouseMove={(e) => show(e, a.label, `SAR ${full(a.value)} · ${Math.round(a.frac * 100)}%`)}
            onMouseLeave={hide}
          />
        ))}
        <text x={cx} y={cy + 2} textAnchor="middle" fontSize={23} fontWeight={700} fill="var(--aq-text)">
          {centre[0]}
        </text>
        <text x={cx} y={cy + 21} textAnchor="middle" fontSize={11} fill="var(--aq-text-muted)">
          {centre[1]}
        </text>
        {arcs.map((a, i) => (
          <g key={`l-${a.key}`}>
            <rect x={272} y={78 + i * 30 - 9} width={11} height={11} rx={3} fill={TONE_FILL[a.tone]} />
            <text x={292} y={78 + i * 30} fontSize={12} fill="var(--aq-text-secondary)">{a.label}</text>
            <text x={500} y={78 + i * 30} textAnchor="end" fontSize={11} fontWeight={700} fill="var(--aq-text-secondary)">
              {compact(a.value)}
            </text>
          </g>
        ))}
      </svg>
      <details style={{ marginTop: 12 }}>
        <summary style={{ fontSize: 12, color: 'var(--aq-text-muted)', cursor: 'pointer' }}>Show as a table</summary>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginTop: 6 }}>
          <tbody>
            {slices.map((s) => (
              <tr key={s.key}>
                <td style={{ padding: '7px 8px' }}>{s.label}</td>
                <td style={{ padding: '7px 8px', textAlign: 'right' }}>{full(s.value)}</td>
                <td style={{ padding: '7px 8px', textAlign: 'right' }}>{Math.round((s.value / total) * 100)}%</td>
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
