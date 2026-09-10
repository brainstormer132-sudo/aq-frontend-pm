/**
 * lib/asana-import.ts - the shapes Asana's export actually has.
 *
 * The fixture is synthetic but built row-for-row from the first real
 * export (JED_Deals_26, 7 Sep 2026): trailing-space headers, a parent
 * name that repeats, a subtask whose parent is not the row above it,
 * `Other Vendor...` free text with two spellings, a Net above Price, an
 * Excel-mangled Task ID, quotation numbers living on the vendor rows.
 */
import assert from 'node:assert/strict';
import {
  parseCsv, readRows, fold, clean, resolveParents, planImport, renderSql,
  mapApproval, mapPayment, mapContract, mapStatus, mapLineStatus, splitPlatforms, isRealPlatform,
  resolveVendor, serviceTypeCandidates, lit, arr, isoDate, report, UNNAMED_UGC, mergeExports,
} from '../.test-build/asana-import.js';

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; }
  catch (e) { failed++; console.error(`  x ${name}\n    ${e.message}`); process.exitCode = 1; }
}

const HEADER = 'Task ID,Created At,Completed At,Last Modified,Name,Section/Column,Assignee,Assignee Email,Start Date,Due Date,Tags,Notes,Projects,Parent task,Department Ctg.,Sales,Source,Client Ctg,Client Account Name,Brand Name ,PIC Name,PIC No.,PIC Email,Vendor Name,Other Vendor...,Platform.,AD Type ,Approval stage,Total Amount ,Price,Statues ,Quotation No.,Client Payment,Invoice No.,Payment Date ,Paid Amount,Net..,Net. Payment Date ,Net. Payment,AQ Gross Cal.,Quo. Breakdown,Key Account Mangers,Packages,Links.,Contract ';

// Column helper so rows stay readable.
const COLS = HEADER.split(',');
function row(o) {
  return COLS.map((c) => {
    const v = o[c.trim()] ?? o[c] ?? '';
    return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  }).join(',');
}

const FIXTURE = [
  HEADER,
  // Campaign A - the name repeats later.
  row({ 'Task ID': '1000000000000001', 'Created At': '2026-09-06', Name: 'Coffee Co - AQ', 'Department Ctg.': 'Campaign', Sales: 'Ahmad  Qurunfulah', Source: 'AQ', 'Client Ctg': 'F&B', 'Client Account Name': 'Coffee Company LLC', 'Brand Name': 'Coffee Co', 'PIC Name': 'mohamad', 'PIC No.': "'+966 550000000", 'Platform.': 'SnapChat, TikTok', 'AD Type': 'Multiservices', 'Approval stage': 'No Reply By Client', 'Total Amount': '7,500', 'Statues': 'Pending', 'Client Payment': 'Unpaid', 'Contract': 'Signed & Attached', 'Key Account Mangers': 'Khulood', Packages: 'SMC - Customize', Tags: '#Transaction' }),
  row({ 'Task ID': '1000000000000002', 'Created At': '2026-09-06', Name: 'Coffee Co - Amal', 'Parent task': 'Coffee Co - AQ', 'Department Ctg.': 'Campaign', 'Vendor Name': 'Other Vendor...', 'Other Vendor...': 'heba thabeet', 'Platform.': 'SnapChat', 'AD Type': 'Store Visit', 'Approval stage': 'Approved', Price: '3750', 'Statues': 'Done', 'Quotation No.': 'EST-004236', 'Client Payment': 'Unpaid', 'Net..': '3000', 'Net. Payment': 'Paid', 'Net. Payment Date': '2026-09-01', 'Completed At': '2026-09-02' }),
  row({ 'Task ID': '1000000000000003', 'Created At': '2026-09-06', Name: 'Coffee Co - Sara', 'Parent task': 'Coffee Co - AQ', 'Vendor Name': 'UGC', 'Other Vendor...': 'Heba Thabet', 'Platform.': 'TikTok', 'AD Type': 'Home Ad', Price: '3750', 'Statues': 'Canceled', 'Quotation No.': 'EST-004236', 'Net..': '4000', 'Net. Payment': 'Unpaid', 'Invoice No.': 'INV-000044' }),
  // Campaign B - unique name.
  row({ 'Task ID': '1000000000000004', 'Created At': '2026-08-01', Name: 'Gold Shop - Faisal', 'Department Ctg.': 'Package AD', Sales: 'Inf.', Source: 'Inf.', 'Client Ctg': 'Real\u00a0State', 'Client Account Name': 'Gold Shop', 'Brand Name': 'Gold', 'Vendor Name': 'AQ Agency', 'Approval stage': 'Approved', 'Total Amount': '10000', 'Statues': 'Done', 'Client Payment': 'Paid', 'Quotation No.': 'QT-000188', 'Invoice No.': 'INV-003190' }),
  row({ 'Task ID': '1000000000000005', 'Created At': '2026-08-01', Name: 'Gold Shop - Faisal (1)', 'Parent task': 'Gold Shop - Faisal', 'Vendor Name': 'Faisal Al-Ghazzawi', 'Platform.': 'Client', 'AD Type': 'Video', Price: '10000', 'Net..': '8000', 'Statues': 'Done', 'Net. Payment': 'Free Spot', 'Quotation No.': 'QT-000199' }),
  // Campaign A again (duplicate name) with its own child; then a child of B
  // placed out of order - its parent is unique so it must still resolve.
  row({ 'Task ID': '1000000000000006', 'Created At': '2026-07-01', Name: 'Coffee Co - AQ', 'Department Ctg.': 'BillBoard', Sales: 'AQ Website', Source: 'AQ', 'Client Account Name': 'coffee company llc', 'Approval stage': 'Approved', 'Statues': 'On Going', 'Client Payment': 'No Payment' }),
  row({ 'Task ID': '1000000000000007', 'Created At': '2026-07-01', Name: 'Coffee Co - Board', 'Parent task': 'Coffee Co - AQ', 'Vendor Name': 'UGC', 'AD Type': '', Price: '', 'Statues': 'Pending', 'Net. Payment': 'Unpaid' }),
  row({ 'Task ID': '1000000000000008', 'Created At': '2026-08-02', Name: 'Gold Shop - late', 'Parent task': 'Gold Shop - Faisal', 'Vendor Name': 'Faisal Al-Ghazzawi', 'AD Type': 'Reel', Price: '500', 'Net..': '400', 'Statues': 'Pending' }),
  // Junk-named parent.
  row({ 'Task ID': '1000000000000009', 'Created At': '2026-08-02', Name: 'Retrieving data. Wait a few seconds and try to cut or copy again.', 'Statues': 'Pending' }),
].join('\r\n') + '\r\n';

// -- CSV ----------------------------------------------------------
test('parseCsv: quotes, doubled quotes, embedded newlines, CRLF, BOM', () => {
  const t = parseCsv('\ufeffa,b\r\n1,"x, ""y""\nz"\r\n');
  assert.deepEqual(t, [['a', 'b'], ['1', 'x, "y"\nz']]);
});

test('readRows: headers with trailing spaces and dots are matched', () => {
  const { rows, missing } = readRows(FIXTURE);
  assert.equal(missing.length, 0, `missing: ${missing.join(',')}`);
  assert.equal(rows.length, 9);
  assert.equal(rows[0].brand, 'Coffee Co');
  assert.equal(rows[1].net, '3000');
  assert.equal(rows[1].netPayment, 'Paid');
  assert.equal(rows[1].netPaymentDate, '2026-09-01');
  assert.equal(rows[0].contract, 'Signed & Attached');
});

test('readRows: an Excel-rounded Task ID is refused, loudly', () => {
  const bad = HEADER + '\n' + row({ 'Task ID': '1.2182E+15', Name: 'x' }) + '\n';
  assert.throws(() => readRows(bad), /opened and saved in Excel/);
});

test('clean: nbsp, runs of space, phone-number apostrophe', () => {
  assert.equal(clean("'+966 550000000"), '+966 550000000');
  assert.equal(clean('Real\u00a0State'), 'Real State');
  assert.equal(clean('Ahmad  Qurunfulah '), 'Ahmad Qurunfulah');
  assert.equal(clean("'Quoted name"), "'Quoted name"); // only before a number
});

test('fold: case, punctuation and whitespace are all one', () => {
  assert.equal(fold('Coffee Company LLC'), fold('coffee  company, llc'));
  assert.equal(fold('Faisal Al-Ghazzawi'), fold('faisal al ghazzawi'));
  assert.notEqual(fold('heba thabeet'), fold('heba thabet')); // spelling is not folded
});

// -- Parents ------------------------------------------------------
test('resolveParents: duplicate names go by file order; unique names ignore order', () => {
  const { rows } = readRows(FIXTURE);
  const r = resolveParents(rows);
  assert.equal(r.parentOf.get('1000000000000002'), '1000000000000001');
  assert.equal(r.parentOf.get('1000000000000003'), '1000000000000001');
  assert.equal(r.parentOf.get('1000000000000007'), '1000000000000006', 'second Coffee Co gets its own child');
  assert.equal(r.parentOf.get('1000000000000008'), '1000000000000004', 'out-of-order child of a unique parent');
  assert.equal(r.orphans.length, 0);
  assert.deepEqual([...r.duplicateNames], [['Coffee Co - AQ', 2]]);
});

// -- Vocabulary ---------------------------------------------------
test('mapApproval folds the three "no / declined" values into cancelled and says so', () => {
  assert.deepEqual(mapApproval('Approved'), { stage: 'approved', folded: false });
  assert.deepEqual(mapApproval('Canceled'), { stage: 'cancelled', folded: false });
  assert.deepEqual(mapApproval('Ready For Review'), { stage: 'ready_for_review', folded: false });
  assert.deepEqual(mapApproval('No Reply By Client'), { stage: 'cancelled', folded: true });
  assert.deepEqual(mapApproval('Declined By Inf.'), { stage: 'cancelled', folded: true });
  assert.deepEqual(mapApproval(''), { stage: null, folded: false });
});

test('mapPayment matches the seven-value picker exactly', () => {
  assert.equal(mapPayment('Unpaid'), 'unpaid');
  assert.equal(mapPayment('Paid'), 'paid');
  assert.equal(mapPayment('Partial Paid'), 'partial');
  assert.equal(mapPayment('No Payment'), 'no_payment');
  assert.equal(mapPayment('Free Spot'), 'no_payment');
  assert.equal(mapPayment('Adjustment'), 'adjustment');
  assert.equal(mapPayment('Refund'), 'refund');
  assert.equal(mapPayment(''), null);
});

test('mapContract / mapStatus / mapLineStatus', () => {
  assert.equal(mapContract('Signed & Attached'), 'signed_attached');
  assert.equal(mapContract('On Process'), 'on_process');
  assert.equal(mapContract('PO'), 'po');
  assert.equal(mapStatus('On Going'), 'pending');
  assert.equal(mapStatus('Canceled'), 'cancelled');
  assert.equal(mapLineStatus('Done'), 'Posted');
  assert.equal(mapLineStatus('On Going'), 'Scheduled');
  assert.equal(mapLineStatus(''), 'Not started');
});

test('splitPlatforms canonicalises and drops nothing; isRealPlatform filters the lookup', () => {
  assert.deepEqual(splitPlatforms('SnapChat, Instagram, TikTok'), ['Snapchat', 'Instagram', 'TikTok']);
  assert.deepEqual(splitPlatforms('Client'), ['Client']);
  assert.equal(isRealPlatform('Client'), false);
  assert.equal(isRealPlatform('Off Line'), false);
  assert.equal(isRealPlatform('TikTok'), true);
});

test('serviceTypeCandidates: aliases first, raw last', () => {
  assert.deepEqual(serviceTypeCandidates('BillBoard'), ['Billboards', 'BillBoard']);
  assert.deepEqual(serviceTypeCandidates('Campaign'), ['Influencers Campaign', 'Campaign']);
  assert.deepEqual(serviceTypeCandidates('Social Media'), ['Social Media']);
  assert.deepEqual(serviceTypeCandidates(''), []);
});

test('isoDate accepts ISO and the Excel form', () => {
  assert.equal(isoDate('2026-09-06'), '2026-09-06');
  assert.equal(isoDate('9/6/2026'), '2026-09-06');
  assert.equal(isoDate(''), null);
});

// -- Vendors ------------------------------------------------------
test('resolveVendor: dropdown name, free text, placeholder', () => {
  const pick = resolveVendor({ vendor: 'Faisal Al-Ghazzawi', otherVendor: '' });
  assert.equal(pick.key, 'asana:faisal al ghazzawi');
  assert.equal(pick.freeText, false);
  const typed = resolveVendor({ vendor: 'UGC', otherVendor: 'heba thabeet' });
  assert.equal(typed.name, 'heba thabeet');
  assert.equal(typed.category, 'UGC');
  assert.equal(typed.freeText, true);
  const none = resolveVendor({ vendor: 'UGC', otherVendor: '' });
  assert.equal(none.name, UNNAMED_UGC);
  const agency = resolveVendor({ vendor: 'AQ Agency', otherVendor: '' });
  assert.equal(agency.category, 'Agency');
});

// -- Plan ---------------------------------------------------------
const READ = readRows(FIXTURE);
const PLAN = planImport(READ.rows, 'TEST');

test('plan: counts', () => {
  assert.equal(PLAN.campaigns.length, 4);
  assert.equal(PLAN.bookings.length, 5);
  assert.equal(PLAN.clients.length, 2, 'Coffee Company LLC / coffee company llc are one client');
  assert.equal(PLAN.stats['untitled campaigns'], 1);
  assert.equal(PLAN.stats['bookings where net exceeds price'], 1);
});

test('plan: quotation and invoice numbers roll up from the vendor rows, distinct, in order', () => {
  const a = PLAN.campaigns.find((c) => c.gid === '1000000000000001');
  assert.deepEqual(a.quotationNumbers, ['EST-004236']);
  assert.deepEqual(a.invoiceNumbers, ['INV-000044']);
  const b = PLAN.campaigns.find((c) => c.gid === '1000000000000004');
  assert.deepEqual(b.quotationNumbers, ['QT-000188', 'QT-000199'], "parent's own first, then the children's");
});

test('plan: the campaign carries what the app has no field for, as text', () => {
  const a = PLAN.campaigns.find((c) => c.gid === '1000000000000001');
  assert.match(a.description, /Approval stage in Asana: No Reply By Client/);
  assert.match(a.description, /Key account: Khulood/);
  assert.match(a.description, /Packages: SMC - Customize/);
  assert.equal(a.approval, 'cancelled');
  assert.equal(a.adType, 'Multi Service');
  assert.equal(a.kam, 'Khulood');
  assert.equal(a.contract, 'signed_attached');
  assert.equal(a.budget, 7500);
  assert.deepEqual(a.platforms, ['Snapchat', 'TikTok']);
  assert.equal(a.salesName, 'Ahmad Qurunfulah');
});

test('plan: sales "Inf." is the influencer flag; "AQ Website" is neither a closer nor lost', () => {
  const b = PLAN.campaigns.find((c) => c.gid === '1000000000000004');
  assert.equal(b.salesInfluencer, true);
  assert.equal(b.salesName, null);
  assert.equal(b.source, 'Influencer');
  const c6 = PLAN.campaigns.find((c) => c.gid === '1000000000000006');
  assert.equal(c6.salesInfluencer, false);
  assert.equal(c6.salesName, null);
  assert.match(c6.description, /Sales in Asana: AQ Website/);
  assert.equal(c6.status, 'pending', 'On Going -> pending');
  assert.equal(c6.clientPayment, 'no_payment');
});

test('plan: client contact comes from the PIC columns; category from Client Ctg with the nbsp gone', () => {
  const coffee = PLAN.clients.find((c) => c.key === 'asana:coffee company llc');
  assert.equal(coffee.contactPhone, '+966 550000000');
  assert.equal(coffee.contactName, 'mohamad');
  assert.deepEqual(coffee.brands, ['Coffee Co']);
  const gold = PLAN.clients.find((c) => c.key === 'asana:gold shop');
  assert.equal(gold.category, 'Real State');
  assert.deepEqual(PLAN.lookups.clientCategories, ['F&B', 'Real State']);
  assert.deepEqual(PLAN.lookups.platforms, ['Snapchat', 'TikTok']);
});

test('plan: bookings keep money per ad, line status from Asana status', () => {
  const b2 = PLAN.bookings.find((b) => b.gid === '1000000000000002');
  assert.equal(b2.price, 3750);
  assert.equal(b2.net, 3000);
  assert.equal(b2.lineStatus, 'Posted');
  assert.equal(b2.vendorPayment, 'paid');
  assert.equal(b2.vendorPaymentDate, '2026-09-01');
  assert.equal(b2.completedAt, '2026-09-02');
  assert.equal(b2.position, 0);
  // the sub-row's OWN approval and client-payment, so the board's tiles can be reproduced
  assert.equal(b2.approval, 'approved');
  assert.equal(b2.clientPayment, 'unpaid');
  const b3 = PLAN.bookings.find((b) => b.gid === '1000000000000003');
  assert.equal(b3.status, 'cancelled');
  assert.equal(b3.lineStatus, 'Cancelled');
  assert.equal(b3.position, 1);
  // b3 has neither in the export, so both are null - the Data view falls back to the campaign
  assert.equal(b3.approval, null);
  assert.equal(b3.clientPayment, null);
  const b7 = PLAN.bookings.find((b) => b.gid === '1000000000000007');
  assert.equal(b7.price, null);
  assert.equal(b7.adType, null);
  assert.equal(b7.vendorKey, 'asana:' + fold(UNNAMED_UGC));
});

test('plan: two spellings of a free-text vendor stay two vendors, and the report says which to check', () => {
  const names = PLAN.vendors.map((v) => v.name).sort();
  assert.deepEqual(names, ['Faisal Al-Ghazzawi', 'Heba Thabet', UNNAMED_UGC, 'heba thabeet'].sort(), 'a Vendor Name on a campaign row is not a booking');
  const rep = report(PLAN, READ, 'fixture.csv');
  assert.match(rep, /heba thabeet - 1/);
  assert.match(rep, /Campaigns: \*\*4\*\*/);
  assert.match(rep, /occurs 2 times/);
});

// -- SQL ----------------------------------------------------------
test('lit / arr escape quotes and pass nulls', () => {
  assert.equal(lit("O'Neil"), "'O''Neil'");
  assert.equal(lit(''), 'null');
  assert.equal(lit(null), 'null');
  assert.equal(lit(3750), '3750');
  assert.equal(arr([]), "'{}'::text[]");
  assert.equal(arr(["a'b", 'c']), "array['a''b','c']::text[]");
});

test('renderSql: one file per stage, bookings chunked, every file its own transaction', () => {
  const files = renderSql(PLAN, { chunk: 100 });
  assert.deepEqual(files.map((f) => f.name), [
    '01_registries.sql', '02_campaigns.sql', '03_bookings_01_of_01.sql', '04_ad_lines_01_of_01.sql', '99_wipe.sql',
  ]);
  for (const f of files) {
    assert.ok(f.sql.startsWith('--'), f.name);
    assert.ok(/\nbegin;\n/.test(f.sql), `${f.name} opens a transaction`);
    assert.ok(/\ncommit;\n/.test(f.sql), `${f.name} commits`);
  }
  const many = renderSql({ ...PLAN, bookings: Array.from({ length: 250 }, (_, i) => ({ ...PLAN.bookings[0], gid: String(2000000000000000 + i) })) }, { chunk: 100 });
  assert.equal(many.filter((f) => f.name.startsWith('03_')).length, 3);
  assert.equal(many.filter((f) => f.name.startsWith('04_')).length, 3);
});

test('renderSql: keyed on asana_gid, and a forced workspace is honoured', () => {
  const [reg, camp, book, line, wipe] = renderSql(PLAN, { workspaceId: '11111111-1111-1111-1111-111111111111' });
  assert.match(camp.sql, /on conflict \(workspace_id, asana_gid\) where asana_gid is not null do update/);
  assert.match(book.sql, /on conflict \(workspace_id, asana_gid\) where asana_gid is not null do update/);
  // the sub-row approval / client-payment reach pm_tasks so the board's tiles compute
  assert.match(book.sql, /approval_stage, client_payment_status/);
  assert.match(book.sql, /approval_stage = excluded.approval_stage/);
  assert.match(book.sql, /'approved'/);
  assert.match(line.sql, /on conflict \(asana_gid\) where asana_gid is not null do update/);
  assert.match(reg.sql, /'11111111-1111-1111-1111-111111111111'::uuid as ws/);
  assert.doesNotMatch(reg.sql, /There are % workspaces/);
  assert.match(wipe.sql, /import_key like 'asana:%'/);
  assert.match(camp.sql, /'Coffee Co - AQ'/);
  assert.match(camp.sql, /No Reply By Client/);
});

test('renderSql: brands dedupe by folded name, and never twice within one batch', () => {
  const [reg] = renderSql(PLAN);
  // One row per (client, folded brand). COZ / coz / Coz collapse, and a brand
  // that differs from an existing one only in case or punctuation is reused.
  assert.match(reg.sql, /select distinct on \(t\.cid, t\.bf\)/);
  assert.match(reg.sql, /pg_temp\._fold\(b\.brand\) as bf/);
  assert.match(reg.sql, /pg_temp\._fold\(x\.brand_name\) = t\.bf/);
  // the old case-only guard, which let punctuation and same-batch variants
  // through, is gone.
  assert.doesNotMatch(reg.sql, /lower\(x\.brand_name\) = lower\(b\.brand\)/);
});

test('mergeExports: copies columns the first file lacks, refuses different rows', () => {
  const a = 'Task ID,Name,Parent task,Price\n1000000000000001,A,,10\n1000000000000002,B,A,5\n';
  const b = 'Task ID,Name,Parent task,Contract \n1.0E+15,A,,Signed & Attached\n1.0E+15,B,A,PO\n';
  const m = mergeExports(a, b);
  assert.deepEqual(m.added, ['Contract']);
  const { rows } = readRows(m.text);
  assert.equal(rows[0].contract, 'Signed & Attached');
  assert.equal(rows[0].price, '10');
  assert.equal(rows[1].gid, '1000000000000002', 'ids come from the first file');
  assert.throws(() => mergeExports(a, b.replace(',B,A,', ',C,A,')), /not the same rows/);
  assert.throws(() => mergeExports(a, b + '1.0E+15,D,,\n'), /rows vs/);
});

console.log(`${passed} passed, ${failed} failed`);
