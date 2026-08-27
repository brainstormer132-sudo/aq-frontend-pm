'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePmTaskCampaignRollup } from '@/hooks/use-workflow';
import {
  buildRows, sortRows, filterRows, nextSort, summarise, summaryLine, emptyMessage,
  isFiltered, money, shortDate, stageLabel, COLUMNS, STAGE_ORDER, DEFAULT_SORT, EMPTY_FILTER,
  sortHint,
  type Filter, type Sort, type SortKey, type StageKey, type TableRow,
  type TaskRow, type PersonLike,
} from '@/lib/all-tasks';
import { SkeletonRows } from '@/components/Skeleton';
import { CalendarPanel } from './TaskCalendarView';

/**
 * All Tasks — the register.
 *
 * Rebuilt Aug 2026, fourth screen of the UI pass. Siraj picked the table.
 *
 * It was one flat list in the order things were created, with no due date on
 * any row, and a grey subtitle carrying six unlabelled facts —
 * `Sunbulah Foods · client 4030112233 · 🎬 Video · priority 3 · sales Sama
 * Jad · KA Malak Alassaf`. The one field that decides what you do next was
 * the only one missing.
 *
 * The job this screen actually does is looking things up: which campaigns
 * has nobody booked a vendor on, which is the biggest, what is late. A feed
 * is the wrong shape for that, so it is a table now, and every column sorts.
 *
 * Two rules carried through the pass:
 *   • Urgency is never colour alone — a red dot AND the words "11 days late".
 *   • Nothing new is fetched. The rollup view was already loaded by the
 *     Dashboard; it is cached, so arriving here costs no round trip.
 *
 * All the deciding — what a row says, where it sorts, what a filter keeps —
 * is in lib/all-tasks.ts, pure and tested.
 */
export function AllTasksView({
  tasks, loading, profiles, currentUserId, workspaceId, onOpen, hrefFor,
}: {
  tasks: TaskRow[];
  loading: boolean;
  profiles: (PersonLike & { role?: string })[];
  currentUserId: string;
  workspaceId: string;
  onOpen: (id: string) => void;
  /* Where a row goes. Given, the campaign name becomes a real anchor, so a
     row can be middle-clicked into a new tab and its address copied — a
     campaign is a place now, not a drawer state. */
  hrefFor?: (id: string) => string;
}) {
  const { rows: rollup, loading: rollupLoading } = usePmTaskCampaignRollup(workspaceId);

  const [filter, setFilter] = useState<Filter>(EMPTY_FILTER);
  const [sort, setSort] = useState<Sort>(DEFAULT_SORT);
  const set = <K extends keyof Filter>(k: K) => (v: Filter[K]) =>
    setFilter((f) => ({ ...f, [k]: v }));

  // Today is read after mount, never during render: the server does not know
  // what day it is where you are, and disagreeing about it is a hydration
  // error. Until it arrives there is nothing to sort by, so the table waits.
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => { setToday(new Date().toISOString().slice(0, 10)); }, []);

  // The calendar that has always been on this screen, kept. It shows more
  // than the table does — subtasks and individual ads carry their own due
  // dates, and those are the dates people actually work to.
  const [mode, setMode] = useState<'table' | 'calendar'>('table');
  const [month, setMonth] = useState<string | null>(null);
  useEffect(() => { if (today && !month) setMonth(today.slice(0, 7)); }, [today, month]);

  const rows = useMemo(
    () => (today ? buildRows({ tasks, rollup, profiles }, today) : []),
    [tasks, rollup, profiles, today],
  );
  const shown = useMemo(
    () => sortRows(filterRows(rows, filter, profiles), sort),
    [rows, filter, sort, profiles],
  );
  const summary = summarise(shown, rows.length);

  // Which stages exist here at all. Offering "Draft" to a workspace that has
  // never had one is a filter that can only ever empty the table.
  const stages = useMemo(() => {
    const seen = new Set(rows.map((r) => r.stage));
    return STAGE_ORDER.filter((s) => seen.has(s));
  }, [rows]);

  const waiting = loading && tasks.length === 0;

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: 20, fontWeight: 700 }}>All tasks</h2>
        <span style={{ fontSize: 13, color: 'var(--aq-text-muted)' }}>
          {waiting || !today ? 'Loading…' : summaryLine(summary)}
        </span>
      </header>

      <div className="aq-card">
        <div style={{ padding: '12px 14px 0' }}>
          <input
            className="aq-input"
            placeholder="Search campaign, client, CR number, or anyone on it…"
            value={filter.query}
            onChange={(e) => set('query')(e.target.value)}
          />
        </div>

        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          flexWrap: 'wrap', padding: '12px 14px',
        }}>
          <Chip
            label="Mine"
            on={filter.personId === currentUserId}
            onClick={() => set('personId')(filter.personId === currentUserId ? null : currentUserId)}
          />
          {/* The two questions this screen gets asked most, as one click. */}
          <Chip
            label="Late"
            count={rows.filter((r) => r.dueTone === 'late').length}
            on={filter.lateOnly}
            onClick={() => set('lateOnly')(!filter.lateOnly)}
          />
          <Chip
            label="No vendors"
            count={rows.filter((r) => r.vendors === 0 && r.chased).length}
            on={filter.noVendors}
            onClick={() => set('noVendors')(!filter.noVendors)}
          />
          <Chip
            label="Hide completed"
            count={rows.filter((r) => r.stage === 'completed').length}
            on={!filter.showCompleted}
            onClick={() => set('showCompleted')(!filter.showCompleted)}
          />

          <select
            className="aq-select"
            value={filter.stage ?? ''}
            onChange={(e) => set('stage')((e.target.value || null) as StageKey | null)}
            style={{ width: 'auto', fontSize: 12.5, padding: '5px 10px' }}
            aria-label="Stage"
          >
            <option value="">Every stage</option>
            {stages.map((s) => (
              <option key={s} value={s}>{stageLabel(s)}</option>
            ))}
          </select>

          <select
            className="aq-select"
            value={filter.personId ?? ''}
            onChange={(e) => set('personId')(e.target.value || null)}
            style={{ width: 'auto', fontSize: 12.5, padding: '5px 10px' }}
            aria-label="Person"
          >
            <option value="">Everyone</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.id === currentUserId ? `${p.full_name} (you)` : p.full_name}
              </option>
            ))}
          </select>

          {isFiltered(filter) && (
            <button
              type="button"
              className="aq-btn aq-btn-ghost"
              onClick={() => setFilter(EMPTY_FILTER)}
              style={{ fontSize: 12.5, padding: '5px 10px', color: 'var(--aq-text-secondary)' }}
            >Clear</button>
          )}

          {/* Named for where it goes, not for where you are. The old toggle
              read "Calendar" while you were looking at the list and "List"
              while you were looking at the calendar, which is the same
              button telling you two different things. */}
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
            <Toggle label="Table" on={mode === 'table'} onClick={() => setMode('table')} />
            <Toggle label="Calendar" on={mode === 'calendar'} onClick={() => setMode('calendar')} />
          </span>
        </div>
      </div>

      {mode === 'calendar' && today && month ? (
        <CalendarPanel
          workspaceId={workspaceId}
          month={month}
          today={today}
          query={filter.query.trim().toLowerCase()}
          memberFilter={filter.personId ?? 'all'}
          onMonth={setMonth}
          onOpen={onOpen}
        />
      ) : waiting || !today ? (
        // Not "no tasks yet" — that sentence used to be shown for the whole
        // of every load, telling people with 400 campaigns that they had none.
        <SkeletonRows rows={9} height={38} label="Loading campaigns" />
      ) : shown.length === 0 ? (
        <div className="aq-card" style={{
          padding: 34, textAlign: 'center', color: 'var(--aq-text-muted)', fontSize: 13.5,
        }}>
          {emptyMessage(filter, rows.length)}
        </div>
      ) : (
        <div className="aq-card" style={{ overflowX: 'auto' }}>
          <table style={{
            width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 860,
          }}>
            <thead>
              <tr>
                {COLUMNS.map((c) => {
                  const on = sort.key === c.key;
                  return (
                    <th
                      key={c.key}
                      scope="col"
                      aria-sort={on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                      style={{
                        textAlign: c.align, padding: 0,
                        borderBottom: '1px solid var(--aq-border)',
                        position: 'sticky', top: 0, zIndex: 1,
                        background: 'var(--aq-bg-elevated)',
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => setSort(nextSort(sort, c.key))}
                        title={sortHint(c, sort)}
                        style={{
                          display: 'flex', gap: 4, width: '100%',
                          justifyContent: c.align === 'right' ? 'flex-end' : 'flex-start',
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
                        <span style={SR_ONLY}>{sortHint(c, sort)}</span>
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <Row
                  key={r.id}
                  row={r}
                  today={today}
                  href={hrefFor?.(r.id)}
                  onOpen={() => onOpen(r.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Said once, at the bottom, rather than as a hint on every header. */}
      {mode === 'table' && shown.length > 0 && (
        <p style={{ fontSize: 11.5, color: 'var(--aq-text-muted)', paddingLeft: 2 }}>
          Any column sorts. Sorting <strong style={{ fontWeight: 600 }}>Vendors</strong> upwards
          finds the campaigns nobody has booked.
          {rollupLoading && ' · Loading vendor counts…'}
        </p>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────── */

function Row({ row, today, href, onOpen }: {
  row: TableRow; today: string; href?: string; onOpen: () => void;
}) {
  const late = row.dueTone === 'late';
  const todayish = row.dueTone === 'today';

  return (
    <tr
      // The whole row stays clickable — that is how it has always behaved and
      // a 40px strip of dead table between the columns would be worse. The
      // name is additionally a real link, so cmd-click and "copy link" work.
      onClick={(e) => {
        // Let the anchor handle its own click, including modifier keys.
        if ((e.target as HTMLElement).closest('a')) return;
        onOpen();
      }}
      tabIndex={href ? -1 : 0}
      role={href ? undefined : 'button'}
      onKeyDown={(e) => {
        if (href) return; // the anchor is the focus stop and Enter follows it
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); }
      }}
      style={{ cursor: 'pointer' }}
      className="aq-tr"
    >
      <Td>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* The dot repeats what the Due column already says in words.
              Red and amber are the same dot to a lot of people, so the dot
              is never the only place the urgency is written. */}
          <span
            aria-hidden
            style={{
              width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
              background: late ? '#b91c1c' : todayish ? '#d97706' : 'transparent',
            }}
          />
          {href ? (
            <Link
              href={href}
              style={{ fontWeight: 600, color: 'inherit', textDecoration: 'none' }}
            >
              {row.name}
            </Link>
          ) : (
            <span style={{ fontWeight: 600 }}>{row.name}</span>
          )}
        </span>
      </Td>
      <Td muted>{row.client || '—'}</Td>
      <Td><StagePill stage={row.stage} label={row.stageLabel} /></Td>
      <Td>
        <span style={{
          whiteSpace: 'nowrap',
          color: late ? '#b91c1c' : todayish ? '#a16207' : 'var(--aq-text-secondary)',
          fontWeight: late || todayish ? 700 : 400,
          fontStyle: row.due ? 'normal' : 'italic',
        }}>
          {row.dueLabel}
        </span>
        {/* The words are for deciding; the date is for checking. Shown only
            where the words are not already the date. */}
        {row.due && row.chased && (
          <span style={{
            color: 'var(--aq-text-muted)', marginLeft: 6, fontVariantNumeric: 'tabular-nums',
          }}>{shortDate(row.due, today)}</span>
        )}
      </Td>
      <Td muted italic={!row.keyAccount}>{row.keyAccount ?? 'nobody yet'}</Td>
      <Td align="right">
        <span style={{
          fontVariantNumeric: 'tabular-nums',
          // A zero here is the thing people are usually hunting for, so it
          // is not left to look like every other number.
          color: row.vendors === 0 && row.chased ? '#b91c1c' : 'var(--aq-text-secondary)',
          fontWeight: row.vendors === 0 && row.chased ? 700 : 400,
        }}>{row.vendors}</span>
      </Td>
      <Td align="right" muted={row.value == null}>
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{money(row.value)}</span>
      </Td>
    </tr>
  );
}

function Td({
  children, align = 'left', muted, italic,
}: {
  children: React.ReactNode;
  align?: 'left' | 'right';
  muted?: boolean;
  italic?: boolean;
}) {
  return (
    <td style={{
      padding: '9px 12px', textAlign: align,
      borderBottom: '1px solid var(--aq-border-light)',
      color: muted ? 'var(--aq-text-muted)' : 'var(--aq-text)',
      fontStyle: italic ? 'italic' : 'normal',
      whiteSpace: align === 'right' ? 'nowrap' : undefined,
    }}>{children}</td>
  );
}

const STAGE_STYLE: Record<string, { bg: string; fg: string }> = {
  pending_marketing: { bg: '#fef3c7', fg: '#92400e' },
  in_progress:       { bg: '#e0e7ff', fg: '#3730a3' },
  awaiting_review:   { bg: '#ede9fe', fg: '#5b21b6' },
  completed:         { bg: 'var(--aq-accent-light)', fg: '#14603a' },
};

function StagePill({ stage, label }: { stage: StageKey; label: string }) {
  const s = STAGE_STYLE[stage] ?? { bg: 'var(--aq-bg-sunken)', fg: 'var(--aq-text-secondary)' };
  return (
    <span style={{
      display: 'inline-block', fontSize: 10.5, fontWeight: 700, letterSpacing: '.03em',
      padding: '3px 9px', borderRadius: 999, whiteSpace: 'nowrap',
      background: s.bg, color: s.fg,
    }}>{label}</span>
  );
}

function Chip({
  label, count, on, onClick,
}: {
  label: string;
  count?: number;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      style={{
        font: 'inherit', fontSize: 12, fontWeight: on ? 600 : 500,
        padding: '5px 11px', borderRadius: 999, cursor: 'pointer', whiteSpace: 'nowrap',
        border: `1px solid ${on ? 'var(--aq-text)' : 'var(--aq-border-light)'}`,
        background: on ? 'var(--aq-text)' : 'var(--aq-bg-elevated)',
        color: on ? '#fff' : 'var(--aq-text-secondary)',
      }}
    >
      {label}
      {count != null && count > 0 && (
        <span style={{
          marginLeft: 5, opacity: 0.65, fontVariantNumeric: 'tabular-nums',
        }}>{count}</span>
      )}
    </button>
  );
}

function Toggle({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      style={{
        font: 'inherit', fontSize: 12.5, fontWeight: on ? 600 : 500,
        padding: '5px 11px', borderRadius: 'var(--aq-radius)', cursor: 'pointer',
        border: '1px solid transparent',
        background: on ? 'var(--aq-bg-sunken)' : 'transparent',
        color: on ? 'var(--aq-text)' : 'var(--aq-text-secondary)',
      }}
    >{label}</button>
  );
}

const SR_ONLY: React.CSSProperties = {
  position: 'absolute', width: 1, height: 1, padding: 0, margin: -1,
  overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
};
