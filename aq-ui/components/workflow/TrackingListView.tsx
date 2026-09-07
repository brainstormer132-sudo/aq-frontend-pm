'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTrackingCampaigns, type WorkspaceRole } from '@/hooks/use-workflow';
import { TrackingSheetPanel } from './TrackingSheetPanel';
import { Chip, RegistryHeader, RegistryToolbar } from './RegistryTable';
import {
  buildCampaigns, filterCampaigns, sortCampaigns, listSummary, listEmptyMessage,
  isListFiltered, firstListDir, money, LIST_COLUMNS, STAGE_FILTERS,
  DEFAULT_LIST_SORT, EMPTY_LIST_FILTER,
  type CampaignRow, type ListSort, type ListSortKey, type ListFilter, type PublishStatus,
} from '@/lib/tracking';

/**
 * Sidebar view: every campaign flagged with a tracking sheet.
 *
 * A campaign gets flagged when "Tracking Sheet" is chosen as a subtask at
 * Marketing triage (sets pm_tasks.has_tracking = true). Clicking a row opens
 * that campaign's tracking sheet.
 *
 * What changed (Aug 2026, variant A):
 *
 *  - Search, a stage filter, a client-view filter and sortable columns. It was
 *    created_at descending and nothing else.
 *  - **Client sees.** `tracking_published_at` existed and only the task panel
 *    ever showed it, so from here you could not tell a published sheet from a
 *    stale one. It is now a column, a filter, and the first thing in the
 *    summary line.
 *  - "Vendors" became "Ads", because a row is an ad.
 *  - A sheet where nothing is priced reads "—", not "0.00". Zero in a money
 *    column says free.
 *  - The redundant "Open sheet" button is gone; the row was already the button.
 *  - Stages are spelled properly — it was `stage.replace('_', ' ')`, which
 *    lower-cases the screen and only replaces the first underscore.
 *
 * The date is fixed once per render and passed down, so nothing below reads the
 * clock during render and the server and the browser cannot disagree.
 */
export function TrackingListView({
  workspaceId, role,
}: {
  workspaceId: string;
  role: WorkspaceRole | null;
}) {
  const { items, rows, published, loading, refetch } = useTrackingCampaigns(workspaceId);
  const [open, setOpen] = useState<CampaignRow | null>(null);
  const [filter, setFilter] = useState<ListFilter>(EMPTY_LIST_FILTER);
  const [sort, setSort] = useState<ListSort>(DEFAULT_LIST_SORT);

  // Today is read after mount, never during render: the server does not know
  // what day it is where you are, and disagreeing about it is a hydration
  // error. Until it arrives the table waits — same as All Tasks.
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => { setToday(new Date().toISOString().slice(0, 10)); }, []);

  const built = useMemo(
    () => (today
      ? buildCampaigns({ campaigns: items as any, rows: rows as any, published: published as any, today })
      : []),
    [items, rows, published, today],
  );
  const shown = useMemo(
    () => sortCampaigns(filterCampaigns(built, filter), sort),
    [built, filter, sort],
  );
  const all = useMemo(() => listSummary(built), [built]);
  const view = useMemo(() => listSummary(shown), [shown]);

  const set = <K extends keyof ListFilter>(k: K, v: ListFilter[K]) =>
    setFilter((f) => ({ ...f, [k]: v }));

  const onSort = (key: ListSortKey) =>
    setSort((s) => (s.key === key
      ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: firstListDir(key) }));

  const filtered = isListFiltered(filter);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <RegistryHeader
        title="Tracking Sheets"
        line={filtered ? `${view.label} — of ${all.label}` : all.label}
      />

      <RegistryToolbar
        query={filter.query}
        onQuery={(q) => set('query', q)}
        placeholder="Search campaign or brand"
      >
        {STAGE_FILTERS.map((s) => (
          <Chip
            key={s.key || 'all'}
            label={s.label}
            on={filter.stage === s.key}
            onClick={() => set('stage', filter.stage === s.key ? '' : s.key)}
          />
        ))}
        <span style={{
          width: 1, alignSelf: 'stretch', background: 'var(--aq-border-light)', margin: '0 2px',
        }} />
        <Chip
          label="Needs publishing"
          count={all.needsPublishing}
          danger
          on={filter.client === 'needs'}
          onClick={() => set('client', filter.client === 'needs' ? '' : 'needs')}
        />
        <Chip
          label="Client is up to date"
          on={filter.client === 'current'}
          onClick={() => set('client', filter.client === 'current' ? '' : 'current')}
        />
      </RegistryToolbar>

      {loading || !today ? (
        <div className="aq-card" style={{ padding: 40, textAlign: 'center', color: 'var(--aq-text-muted)' }}>
          Loading tracking sheets…
        </div>
      ) : shown.length === 0 ? (
        <div className="aq-card" style={{
          padding: 40, textAlign: 'center', color: 'var(--aq-text-muted)', fontSize: 13,
        }}>
          {listEmptyMessage(filter)}
        </div>
      ) : (
        <div className="aq-card" style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 860 }}>
            <thead>
              <tr>
                {LIST_COLUMNS.map((c) => {
                  const on = sort.key === c.key;
                  return (
                    <th
                      key={c.key}
                      scope="col"
                      aria-sort={on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                      style={{
                        textAlign: c.num ? 'right' : 'left', padding: 0,
                        borderBottom: '1px solid var(--aq-border)',
                        background: 'var(--aq-bg-elevated)',
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => onSort(c.key)}
                        title={on
                          ? (sort.dir === 'asc' ? 'Sorted ascending' : 'Sorted descending')
                          : `Sort by ${c.label.toLowerCase()}`}
                        style={{
                          display: 'flex', gap: 4, width: '100%',
                          justifyContent: c.num ? 'flex-end' : 'flex-start',
                          padding: '9px 12px', border: 'none', background: 'none',
                          font: 'inherit', fontSize: 10, fontWeight: 700,
                          letterSpacing: '.07em', textTransform: 'uppercase',
                          color: on ? 'var(--aq-text)' : 'var(--aq-text-muted)',
                          cursor: 'pointer', whiteSpace: 'nowrap',
                        }}
                      >
                        {c.label}
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
              {shown.map((r) => (
                <tr
                  key={r.id}
                  className="aq-tr"
                  tabIndex={0}
                  onClick={() => setOpen(r)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(r); }
                  }}
                  style={{ cursor: 'pointer', borderTop: '1px solid var(--aq-border-light)' }}
                >
                  <Td><span style={{ fontWeight: 600 }}>{r.name}</span></Td>
                  <Td muted={!r.brand}>{r.brand || 'No brand'}</Td>
                  <Td><StagePill label={r.stageLabel} stage={r.stage} /></Td>
                  <Td num muted={r.ads === 0}>{r.ads || '—'}</Td>
                  <Td num muted={r.total == null}>{money(r.total)}</Td>
                  <Td><ClientPill publish={r.publish} /></Td>
                  <Td muted>{r.created}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <TrackingSheetPanel
          taskId={open.id}
          taskTitle={open.name}
          brandName={open.brand}
          role={role}
          onClose={() => { setOpen(null); refetch(); }}
        />
      )}
    </div>
  );
}

/* ── Bits ───────────────────────────────────────────────────────── */

const STAGE_STYLE: Record<string, { bg: string; fg: string }> = {
  completed: { bg: 'var(--aq-accent-light)', fg: '#14603a' },
  pending_marketing: { bg: '#fef3c7', fg: '#92400e' },
  awaiting_review: { bg: '#dbeafe', fg: '#1e40af' },
};

function StagePill({ label, stage }: { label: string; stage: string }) {
  const s = STAGE_STYLE[stage] ?? { bg: 'var(--aq-bg-sunken)', fg: 'var(--aq-text-secondary)' };
  return (
    <span style={{
      display: 'inline-block', fontSize: 10.5, fontWeight: 700,
      padding: '2px 9px', borderRadius: 999, whiteSpace: 'nowrap',
      background: s.bg, color: s.fg,
    }}>{label}</span>
  );
}

const PUBLISH_STYLE = {
  warn: { bg: '#fef3c7', fg: '#92400e' },
  ok:   { bg: 'var(--aq-accent-light)', fg: '#14603a' },
  none: { bg: 'var(--aq-bg-sunken)', fg: 'var(--aq-text-muted)' },
} as const;

function ClientPill({ publish }: { publish: PublishStatus }) {
  const s = PUBLISH_STYLE[publish.tone === 'none' ? 'none' : publish.tone];
  return (
    <span title={publish.sentence} style={{
      display: 'inline-block', fontSize: 10.5, fontWeight: 700,
      padding: '2px 9px', borderRadius: 999, whiteSpace: 'nowrap',
      background: s.bg, color: s.fg,
    }}>{publish.label}</span>
  );
}

function Td({ children, num = false, muted = false }: {
  children?: React.ReactNode; num?: boolean; muted?: boolean;
}) {
  return (
    <td style={{
      textAlign: num ? 'right' : 'left', padding: '11px 12px',
      color: muted ? 'var(--aq-text-muted)' : 'var(--aq-text)',
      whiteSpace: 'nowrap',
      fontVariantNumeric: num ? 'tabular-nums' : undefined,
    }}>{children}</td>
  );
}
