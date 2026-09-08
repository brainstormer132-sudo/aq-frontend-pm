/**
 * lib/task-calendar.ts - the month grid, and one day opened in full.
 *
 * The day view: Siraj, after the Asana import put forty things on some
 * days - *"calendar when you click on a day that has a lot of tasks it
 * shows you a detailed view of the day"*.
 */
import assert from 'node:assert/strict';
import {
  monthGrid, splitByDueDate, isOverdue, shiftMonth, monthTitle,
  dayDetail, dayTitle, dayCountLine,
} from '../.test-build/task-calendar.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; }
  catch (e) { failed++; console.error(`  x ${name}\n    ${e.message}`); process.exitCode = 1; }
}

const TODAY = '2026-09-08';
const item = (id, kind, title, due, done, campaignId, campaign) => ({ id, kind, title, due_date: due, done, campaignId, campaign });
const ITEMS = [
  item('c1', 'campaign', 'Zed Launch', '2026-09-08', false, 'c1', 'Zed Launch'),
  item('s1', 'subtask', 'Zed - Sara', '2026-09-08', false, 'c1', 'Zed Launch'),
  item('ad:1', 'ad', 'Store Visit', '2026-09-08', true, 'c1', 'Zed Launch'),
  item('ad:2', 'ad', 'Home Ad', '2026-09-08', false, 'c1', 'Zed Launch'),
  item('s2', 'subtask', 'Apple - Faisal', '2026-09-08', false, 'c2', 'Apple Gold'),
  item('ad:3', 'ad', 'Reel', '2026-09-07', false, 'c3', 'Late One'),      // yesterday, not today
  item('ad:4', 'ad', 'Story', '2026-09-08', false, 'c3', 'Late One'),
  item('s9', 'subtask', 'Elsewhere', '2026-09-20', false, 'c9', 'Not today'),
  item('u1', 'subtask', 'Undated', null, false, 'c9', 'Not today'),
];

// -- Grid -----------------------------------------------------------
test('monthGrid: always six weeks, items land on their day, today is marked', () => {
  const weeks = monthGrid('2026-09', ITEMS, (t) => t.due_date, TODAY);
  assert.equal(weeks.length, 6);
  const cells = weeks.flat();
  assert.equal(cells.length, 42);
  const eighth = cells.find((c) => c.day === '2026-09-08');
  assert.equal(eighth.items.length, 6);
  assert.equal(eighth.isToday, true);
  assert.equal(cells.find((c) => c.day === '2026-09-20').items.length, 1);
  assert.equal(cells.filter((c) => c.inMonth).length, 30);
});

test('splitByDueDate / isOverdue / shiftMonth / monthTitle', () => {
  const { dated, undated } = splitByDueDate(ITEMS, (t) => t.due_date);
  assert.equal(undated.length, 1);
  assert.equal(dated.length, 8);
  assert.equal(isOverdue('2026-09-07', TODAY, false), true);
  assert.equal(isOverdue('2026-09-07', TODAY, true), false);
  assert.equal(isOverdue('2026-09-08', TODAY, false), false);
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
  assert.equal(monthTitle('2026-09'), 'September 2026');
});

// -- Day detail -----------------------------------------------------
test('dayDetail: only that day, grouped by campaign, counted', () => {
  const d = dayDetail(ITEMS, '2026-09-08', TODAY);
  assert.equal(d.total, 6);
  assert.equal(d.done, 1);
  assert.equal(d.overdue, 0);
  assert.deepEqual(d.groups.map((g) => g.campaign), ['Apple Gold', 'Late One', 'Zed Launch']);
  const zed = d.groups.find((g) => g.campaign === 'Zed Launch');
  assert.deepEqual(zed.items.map((i) => i.id), ['c1', 's1', 'ad:2', 'ad:1'], 'campaign, then booking, then ads by title');
});

test('dayDetail: a day in the past marks the unfinished ones overdue and floats those groups up', () => {
  const d = dayDetail(ITEMS, '2026-09-08', '2026-09-30');
  assert.equal(d.overdue, 5, 'everything but the posted ad');
  assert.equal(d.groups[0].campaign === 'Apple Gold' || d.groups[0].campaign === 'Late One', true);
  const done = d.groups.flatMap((g) => g.items).find((i) => i.id === 'ad:1');
  assert.equal(done.overdue, false);
  const y = dayDetail(ITEMS, '2026-09-07', TODAY);
  assert.equal(y.total, 1);
  assert.equal(y.overdue, 1);
  assert.equal(y.groups[0].items[0].overdue, true);
});

test('dayDetail: an empty day', () => {
  const d = dayDetail(ITEMS, '2026-09-09', TODAY);
  assert.deepEqual(d, { day: '2026-09-09', total: 0, done: 0, overdue: 0, groups: [] });
  assert.equal(dayCountLine(d), 'Nothing due.');
});

test('dayTitle / dayCountLine', () => {
  assert.equal(dayTitle('2026-09-08'), 'Tuesday 8 September');
  assert.equal(dayTitle('2026-01-01'), 'Thursday 1 January');
  assert.equal(dayTitle('garbage'), 'garbage');
  assert.equal(dayCountLine({ total: 6, done: 1, overdue: 0 }), '6 due | 1 done');
  assert.equal(dayCountLine({ total: 6, done: 1, overdue: 5 }), '6 due | 5 overdue | 1 done');
  assert.equal(dayCountLine({ total: 2, done: 0, overdue: 0 }), '2 due');
});

console.log(`${passed} passed, ${failed} failed`);
