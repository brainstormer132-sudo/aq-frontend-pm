# Calendar: a day opened in full

**8 Sep 2026.** Siraj: *"calendar when you click on a day that has a lot
of tasks it shows you a detailed view of the day"*. After the Asana import
some days carry forty items and the cell said three of them and "+37 more".

## What it does

- Every day cell is clickable (and keyboard-reachable). The number of
  items sits in the cell's top-right corner; the open day gets a heavy
  border.
- Clicking a day replaces the right-hand rail - where "No due date"
  normally lives - with that day: *Tuesday 8 September*, *41 due | 3
  overdue | 12 done*, then the items **grouped by campaign**. Campaign
  first, then bookings, then ads; groups with something overdue float to
  the top. Done items are struck through, overdue ones red. The campaign
  name opens the campaign; an item opens its task (an ad opens its
  booking).
- *Close* brings the undated rail back. Paging to another month closes it
  too, since the day is no longer on screen. Clicking a chip inside a cell
  still opens that task directly - it does not open the day.

## Where the logic is

`lib/task-calendar.ts` - `dayDetail(items, day, today)`, `dayTitle`,
`dayCountLine`. Pure; now in the test harness (`tests/cal.test.mjs`, which
also covers `monthGrid` and friends - the file's header had claimed tests
that did not exist).

`hooks/use-calendar-items.ts` - every item now carries `campaignId` and
`campaign`, the top of whatever it hangs off, so an ad groups under its
campaign rather than under its booking.
