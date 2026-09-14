/**
 * lib/asana-import.ts - asanaApiToRows: the API sync source.
 *
 * The sync pulls tasks from the Asana REST API and must produce the SAME
 * AsanaRow[] a CSV export would, so the rest of the pipeline (resolveParents,
 * planImport, renderSql) runs unchanged. These tests feed synthetic API JSON
 * shaped like Asana's real responses (custom_fields carry display_value;
 * native fields sit on the task) and check the rows, then run the whole
 * pipeline end to end.
 */
import assert from 'node:assert/strict';
import {
  asanaApiToRows, resolveParents, planImport,
} from '../.test-build/asana-import.js';

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; }
  catch (e) { failed++; console.error(`  x ${name}\n    ${e.message}`); process.exitCode = 1; }
}

// A custom field the way Asana's API returns it.
function cf(name, display) { return { name, display_value: display == null ? null : String(display) }; }

// A realistic campaign with two vendor subtasks.
function fixture() {
  const campaign = {
    gid: '1000000000000001',
    name: 'Coffee Co - AQ',
    notes: 'Brief in the deck.',
    created_at: '2026-09-06T09:00:00.000Z',
    completed: false,
    completed_at: null,
    due_on: '2026-09-20',
    assignee: { email: 'pm@aqcreativity.com' },
    tags: [{ name: '#Transaction' }, { name: 'Q3' }],
    custom_fields: [
      cf('Sales', 'Ahmad Qurunfulah'),
      cf('Source', 'AQ'),
      cf('Client Ctg', 'F&B'),
      cf('Client Account Name', 'Coffee Company LLC'),
      cf('Brand Name ', 'Coffee Co'),          // trailing space, like the real export
      cf('PIC Name', 'mohamad'),
      cf('Platform.', 'SnapChat, TikTok'),
      cf('AD Type ', 'Multiservices'),
      cf('Approval stage', 'No Reply By Client'),
      cf('Total Amount ', '7,500'),
      cf('Statues ', 'Pending'),
      cf('Client Payment', 'Unpaid'),
      cf('Contract ', 'Signed & Attached'),
      cf('Key Account Mangers', 'Khulood'),
      cf('Packages', 'SMC - Customize'),
    ],
    subtasks: [
      {
        gid: '1000000000000002',
        name: 'Coffee Co - Amal',
        completed: true,
        completed_at: '2026-09-02T12:00:00.000Z',
        due_on: null,
        assignee: { email: 'amal@example.com' },
        tags: [],
        custom_fields: [
          cf('Vendor Name', 'Other Vendor...'),
          cf('Other Vendor...', 'heba thabeet'),
          cf('Platform.', 'SnapChat'),
          cf('AD Type ', 'Store Visit'),
          cf('Approval stage', 'Approved'),
          cf('Price', '3750'),
          cf('Statues ', 'Done'),
          cf('Quotation No.', 'EST-004236'),
          cf('Client Payment', 'Unpaid'),
          cf('Net..', '3000'),                 // "net" must NOT grab these two:
          cf('Net. Payment', 'Paid'),
          cf('Net. Payment Date ', '2026-09-01'),
        ],
      },
      {
        gid: '1000000000000003',
        name: 'Coffee Co - Sara',
        completed: false,
        custom_fields: [
          cf('Vendor Name', 'UGC'),
          cf('Platform.', 'TikTok'),
          cf('AD Type ', 'Home Ad'),
          cf('Price', '3750'),
          cf('Net..', '4000'),
          cf('Statues ', 'Canceled'),
        ],
      },
    ],
  };
  return [campaign];
}

// ---- row shape -----------------------------------------------------------

test('one row per task, campaign first then its subtasks in order', () => {
  const rows = asanaApiToRows(fixture());
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((r) => r.gid), ['1000000000000001', '1000000000000002', '1000000000000003']);
  assert.deepEqual(rows.map((r) => r.index), [0, 1, 2]);
});

test('parent rows are campaigns; subtasks carry the campaign name as parentName', () => {
  const rows = asanaApiToRows(fixture());
  assert.equal(rows[0].parentName, '');
  assert.equal(rows[1].parentName, 'Coffee Co - AQ');
  assert.equal(rows[2].parentName, 'Coffee Co - AQ');
});

test('custom fields map to AsanaRow keys, trailing-space names included', () => {
  const [c] = asanaApiToRows(fixture());
  assert.equal(c.sales, 'Ahmad Qurunfulah');
  assert.equal(c.source, 'AQ');
  assert.equal(c.clientCtg, 'F&B');
  assert.equal(c.client, 'Coffee Company LLC');
  assert.equal(c.brand, 'Coffee Co');            // "Brand Name " matched despite the space
  assert.equal(c.platform, 'SnapChat, TikTok');
  assert.equal(c.adType, 'Multiservices');
  assert.equal(c.approval, 'No Reply By Client');
  assert.equal(c.totalAmount, '7,500');
  assert.equal(c.status, 'Pending');             // "Statues " -> status
  assert.equal(c.contract, 'Signed & Attached');
  assert.equal(c.kam, 'Khulood');
});

test('"net" never grabs "net payment" / "net payment date" (prefix-clash rule)', () => {
  const rows = asanaApiToRows(fixture());
  const amal = rows[1];
  assert.equal(amal.net, '3000');                // Net..
  assert.equal(amal.netPayment, 'Paid');         // Net. Payment
  assert.equal(amal.netPaymentDate, '2026-09-01'); // Net. Payment Date
  assert.equal(amal.price, '3750');
  assert.equal(amal.quotationNo, 'EST-004236');
});

test('native fields come off the task, not custom fields', () => {
  const rows = asanaApiToRows(fixture());
  const c = rows[0];
  assert.equal(c.name, 'Coffee Co - AQ');
  assert.equal(c.notes, 'Brief in the deck.');
  assert.equal(c.createdAt, '2026-09-06T09:00:00.000Z');
  assert.equal(c.dueDate, '2026-09-20');
  assert.equal(c.assigneeEmail, 'pm@aqcreativity.com');
  assert.equal(c.tags, '#Transaction, Q3');
  assert.equal(c.completedAt, '');               // not completed -> blank
  const amal = rows[1];
  assert.equal(amal.completedAt, '2026-09-02T12:00:00.000Z'); // completed -> kept
});

test('a task with no gid is skipped', () => {
  const campaigns = fixture();
  campaigns[0].subtasks.push({ gid: '', name: 'ghost', custom_fields: [] });
  const rows = asanaApiToRows(campaigns);
  assert.equal(rows.length, 3);
});

// ---- end to end: the same pipeline the CSV path uses ---------------------

test('resolveParents binds both subtasks to the campaign', () => {
  const rows = asanaApiToRows(fixture());
  const { parentOf, orphans } = resolveParents(rows);
  assert.equal(orphans.length, 0);
  assert.equal(parentOf.get('1000000000000002'), '1000000000000001');
  assert.equal(parentOf.get('1000000000000003'), '1000000000000001');
});

test('duplicate campaign names bind subtasks to the nearest preceding parent', () => {
  const a = fixture()[0];
  const b = {
    gid: '2000000000000001', name: 'Coffee Co - AQ',   // same name as a
    custom_fields: [],
    subtasks: [{ gid: '2000000000000002', name: 'later booking', custom_fields: [cf('Price', '10')] }],
  };
  const rows = asanaApiToRows([a, b]);
  const { parentOf } = resolveParents(rows);
  assert.equal(parentOf.get('1000000000000002'), '1000000000000001'); // a's sub -> a
  assert.equal(parentOf.get('2000000000000002'), '2000000000000001'); // b's sub -> b
});

test('planImport turns the API rows into a campaign with its bookings and money', () => {
  const plan = planImport(asanaApiToRows(fixture()), 'Jed Deals 26');
  assert.equal(plan.campaigns.length, 1);
  assert.equal(plan.bookings.length, 2);
  const amal = plan.bookings.find((b) => b.gid === '1000000000000002');
  assert.equal(amal.price, 3750);
  assert.equal(amal.net, 3000);
  assert.equal(amal.parentGid, '1000000000000001');
  // The client and its brand made it into the registries.
  assert.ok(plan.clients.some((c) => c.name === 'Coffee Company LLC'));
});

test('a gid returned twice by Asana is emitted only once', () => {
  const [c] = fixture();
  // Same campaign listed twice (pagination overlap), and one subtask repeated.
  const dupSub = { gid: '1000000000000002', name: 'dup', custom_fields: [] };
  const rows = asanaApiToRows([c, c, { ...c, subtasks: [dupSub] }]);
  const gids = rows.map((r) => r.gid);
  assert.equal(new Set(gids).size, gids.length);           // no duplicate gids
  assert.equal(rows.length, 3);                            // still just the 3 real tasks
});

console.log(`\n  asana-adapter: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);