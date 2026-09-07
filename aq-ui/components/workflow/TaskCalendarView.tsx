'use client';

import { useCalendarItems } from '@/hooks/use-calendar-items';
import {
  monthGrid, splitByDueDate, monthTitle, shiftMonth, isOverdue, WEEKDAYS,
} from '@/lib/task-calendar';

/**
 * Tasks on a month grid, with the ones nobody dated beside it.
 *
 * The rail is the point of this view as much as the grid is. A task with no
 * due date cannot be drawn on a calendar, and a calendar that simply omits it
 * is worse than no calendar: the work disappears and the page still looks
 * complete. So they sit to the right, in red, counted.
 *
 * All the date arithmetic is in lib/task-calendar.ts, which is pure and
 * tested — including February, year boundaries and months that start on a
 * Sunday, all of which look fine in whatever month you happen to build in.
 */

/**
 * The calendar's own data.
 *
 * The list above it shows campaigns, which is what All Tasks has always been.
 * The calendar deliberately shows more: subtasks and the individual ads
 * inside a vendor booking carry their own due dates, and those are the dates
 * people actually work to. A calendar of campaign deadlines alone would look
 * complete while missing most of the work.
 */
export function CalendarPanel({
  workspaceId, month, today, query, memberFilter, onMonth, onOpen,
}: {
  workspaceId: string;
  month: string;
  today: string;
  query: string;
  memberFilter: string;
  onMonth: (m: string) => void;
  onOpen: (id: string) => void;
}) {
  const { items, loading } = useCalendarItems(workspaceId);

  const shown = items.filter((i) => {
    if (memberFilter !== 'all' && i.assignee_id !== memberFilter) return false;
    if (!query) return true;
    return [i.title, i.context].some((v) => String(v || '').toLowerCase().includes(query));
  });

  if (loading) {
    return (
      <div className="aq-card" style={{ padding: 32, color: 'var(--aq-text-muted)' }}>
        Loading campaigns, subtasks and ads…
      </div>
    );
  }

  return (
    <TaskCalendar
      tasks={shown.map((i) => ({
        id: i.taskId,
        key: i.id,
        task_name: i.context && i.kind !== 'campaign' ? `${i.title}` : i.title,
        brand_name: i.context,
        due_date: i.due_date,
        status: i.done ? 'done' : 'pending',
        kind: i.kind,
      }))}
      month={month}
      today={today}
      onMonth={onMonth}
      onOpen={onOpen}
    />
  );
}

function TaskCalendar({
  tasks, month, today, onMonth, onOpen,
}: {
  tasks: any[];
  month: string;
  today: string;
  onMonth: (m: string) => void;
  onOpen: (id: string) => void;
}) {
  const { dated, undated } = splitByDueDate(tasks, (t: any) => t.due_date);
  const weeks = monthGrid(month, dated, (t: any) => t.due_date, today);
  const name = (t: any) => t.task_name || t.title || 'Untitled';

  const chip = (t: any, overdue: boolean) => (
    <button
      key={t.key ?? t.id}
      type="button"
      onClick={() => onOpen(t.id)}
      title={t.brand_name ? `${name(t)} — ${t.brand_name}` : name(t)}
      style={{
        display: 'block', width: '100%', textAlign: 'left', font: 'inherit',
        fontSize: 11, padding: '2px 5px', marginTop: 2, cursor: 'pointer',
        borderRadius: 5, border: '1px solid var(--aq-border-light)',
        background: overdue ? '#fee2e2' : 'var(--aq-bg-sunken)',
        color: overdue ? '#b91c1c' : 'var(--aq-text)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}
    >{name(t)}</button>
  );

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 3fr) minmax(220px, 1fr)', gap: 14, alignItems: 'start' }}>
      <div className="aq-card" style={{ padding: 16 }}>
        <header style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <button type="button" className="aq-btn aq-btn-secondary"
                  onClick={() => onMonth(shiftMonth(month, -1))}
                  style={{ fontSize: 12.5, padding: '4px 10px' }}>←</button>
          <strong style={{ fontSize: 15 }}>{monthTitle(month)}</strong>
          <button type="button" className="aq-btn aq-btn-secondary"
                  onClick={() => onMonth(shiftMonth(month, 1))}
                  style={{ fontSize: 12.5, padding: '4px 10px' }}>→</button>
          <button type="button" className="aq-btn aq-btn-secondary"
                  onClick={() => onMonth(today.slice(0, 7))}
                  style={{ fontSize: 12.5, padding: '4px 10px', marginLeft: 'auto' }}>Today</button>
        </header>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 4 }}>
          {WEEKDAYS.map((d) => (
            <div key={d} style={{
              fontSize: 10.5, fontWeight: 700, letterSpacing: '.08em',
              textTransform: 'uppercase', color: 'var(--aq-text-muted)',
              padding: '2px 4px',
            }}>{d}</div>
          ))}
          {weeks.flat().map((cell) => (
            <div key={cell.day} style={{
              minHeight: 92, padding: 4, borderRadius: 8,
              border: cell.isToday ? '1px solid var(--aq-text)' : '1px solid var(--aq-border-light)',
              background: cell.inMonth ? 'transparent' : 'var(--aq-bg-sunken)',
              opacity: cell.inMonth ? 1 : 0.55,
            }}>
              <div style={{
                fontSize: 11, fontWeight: cell.isToday ? 700 : 500,
                color: cell.inMonth ? 'var(--aq-text-secondary)' : 'var(--aq-text-muted)',
              }}>{cell.dayOfMonth}</div>
              {cell.items.slice(0, 3).map((t: any) =>
                chip(t, isOverdue(t.due_date, today, t.status === 'done' || t.stage === 'completed')))}
              {cell.items.length > 3 && (
                <div style={{ fontSize: 10.5, color: 'var(--aq-text-muted)', marginTop: 2 }}>
                  +{cell.items.length - 3} more
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="aq-card" style={{ padding: 16, border: undated.length ? '1px solid #b91c1c' : undefined }}>
        <h3 style={{ fontSize: 13, fontWeight: 700, color: undated.length ? '#b91c1c' : 'var(--aq-text)' }}>
          No due date {undated.length ? `· ${undated.length}` : ''}
        </h3>
        <p style={{ fontSize: 12, color: 'var(--aq-text-muted)', margin: '2px 0 10px' }}>
          {undated.length
            ? 'These cannot be placed on the calendar. Give them a due date and they move across.'
            : 'Everything in view has a due date.'}
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 520, overflowY: 'auto' }}>
          {undated.map((t: any) => (
            <button
              key={t.key ?? t.id}
              type="button"
              onClick={() => onOpen(t.id)}
              style={{
                display: 'block', width: '100%', textAlign: 'left', font: 'inherit',
                fontSize: 12.5, padding: '7px 9px', cursor: 'pointer',
                border: '1px solid #fecaca', background: '#fef2f2', color: '#b91c1c',
                borderRadius: 7,
              }}
            >
              <strong style={{ display: 'block', fontWeight: 600 }}>{name(t)}</strong>
              <span style={{ fontSize: 11, opacity: 0.85 }}>
                no due date{t.brand_name ? ` · ${t.brand_name}` : ''}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
