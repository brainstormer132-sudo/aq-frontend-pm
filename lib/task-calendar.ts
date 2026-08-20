/**
 * Laying tasks out on a month grid.
 *
 * Pure — no React, no Supabase, and no argless `new Date()`: today is passed
 * in. Calendars are exactly the kind of code that looks right in the month
 * you happen to test it in and is wrong in February, over a year boundary,
 * or in a month that starts on a Sunday, so the arithmetic lives here where
 * it can be tested against all of those.
 *
 * The week starts on **Sunday**, which is the working week here.
 *
 * Dates are handled as `YYYY-MM-DD` strings throughout. A task due date is a
 * calendar day, not an instant: turning it into a Date and back is how a
 * task due on the 1st ends up drawn on the 30th for anyone west of UTC.
 */

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

/** `2026-08-17T09:00:00Z` → `2026-08-17`. Never constructs a Date. */
export function dayOf(iso: string | null | undefined): string {
  return (iso ?? '').slice(0, 10);
}

export function monthOf(day: string | null | undefined): string {
  return (day ?? '').slice(0, 7);
}

export function monthTitle(month: string): string {
  const [y, m] = month.split('-');
  return `${MONTHS[Number(m) - 1] ?? m} ${y}`;
}

/** Month key arithmetic on strings, so December → January is not special. */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const total = y * 12 + (m - 1) + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

function daysInMonth(year: number, month1: number): number {
  // Day 0 of the next month is the last day of this one.
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

/** 0 = Sunday. UTC throughout, so the grid is the same everywhere. */
function weekdayOf(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export interface CalendarDay<T> {
  /** `YYYY-MM-DD`. */
  day: string;
  dayOfMonth: number;
  /** False for the leading and trailing days borrowed from the neighbours. */
  inMonth: boolean;
  isToday: boolean;
  items: T[];
}

/**
 * A six-week grid for `month`, with each item placed on its due day.
 *
 * Always six rows: a month that needs five and a month that needs six would
 * otherwise change the page height as you page through, which is the kind of
 * jump that makes people lose their place.
 */
export function monthGrid<T>(
  month: string,
  items: T[],
  getDue: (item: T) => string | null | undefined,
  todayISO: string,
): CalendarDay<T>[][] {
  const [year, m] = month.split('-').map(Number);

  const byDay = new Map<string, T[]>();
  for (const item of items) {
    const day = dayOf(getDue(item));
    if (!day) continue;
    const list = byDay.get(day) ?? [];
    list.push(item);
    byDay.set(day, list);
  }

  const first = `${month}-01`;
  const lead = weekdayOf(first);
  const prev = shiftMonth(month, -1);
  const [py, pm] = prev.split('-').map(Number);
  const prevDays = daysInMonth(py, pm);

  const cells: CalendarDay<T>[] = [];
  const push = (dayKey: string, inMonth: boolean) => {
    cells.push({
      day: dayKey,
      dayOfMonth: Number(dayKey.slice(8)),
      inMonth,
      isToday: dayKey === todayISO,
      items: byDay.get(dayKey) ?? [],
    });
  };

  for (let i = lead - 1; i >= 0; i--) push(`${prev}-${String(prevDays - i).padStart(2, '0')}`, false);
  const total = daysInMonth(year, m);
  for (let d = 1; d <= total; d++) push(`${month}-${String(d).padStart(2, '0')}`, true);
  const next = shiftMonth(month, 1);
  let d = 1;
  while (cells.length < 42) push(`${next}-${String(d++).padStart(2, '0')}`, false);

  const weeks: CalendarDay<T>[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/**
 * Split what can be placed from what cannot.
 *
 * A task with no due date is not a task with no deadline — it is a task
 * nobody has given a deadline to, which is worse. It gets its own list so it
 * can be shown rather than silently dropped off the calendar.
 */
export function splitByDueDate<T>(
  items: T[],
  getDue: (item: T) => string | null | undefined,
): { dated: T[]; undated: T[] } {
  const dated: T[] = [];
  const undated: T[] = [];
  for (const item of items) (dayOf(getDue(item)) ? dated : undated).push(item);
  return { dated, undated };
}

/** Overdue = due before today and not finished. */
export function isOverdue(
  due: string | null | undefined,
  todayISO: string,
  done?: boolean,
): boolean {
  if (done) return false;
  const day = dayOf(due);
  return !!day && day < todayISO;
}
