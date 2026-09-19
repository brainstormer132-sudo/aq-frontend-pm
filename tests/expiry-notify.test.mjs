/**
 * expiry-notify - which CRs and licences are worth a daily notice, and what
 * it says.
 *
 * `expiryDue` keeps a record only when its date is expired or within the
 * window; a record with no date, a junk date, or a date comfortably ahead is
 * left alone. The message names the papers correctly (a client's CR, a
 * vendor's licence) and reads differently once expired. The link is unique per
 * (workspace, record, state), which is also the de-duplication key.
 */
import {
  expiryDue, expiryMessage, expiryLink, papersNoun,
  EXPIRY_WITHIN_DAYS, NOTIFY_EVERY_DAYS, RECIPIENT_ROLES,
} from '../.test-build/expiry-notify.js';

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; console.log(`FAIL ${name}\n  got  ${g}\n  want ${w}`); }
};
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.log(`FAIL ${name}`); } };

const TODAY = '2026-09-19';

ok('the window is 30 days', EXPIRY_WITHIN_DAYS === 30);
ok('the dedup window is a week', NOTIFY_EVERY_DAYS === 7);
eq('owners and admins hear it', RECIPIENT_ROLES, ['owner', 'admin']);
eq('a client keeps a CR', papersNoun('client'), 'CR');
eq('a vendor keeps a licence', papersNoun('vendor'), 'licence');

// The filter: expired and within-window kept; junk, blank and far-off dropped.
const rows = [
  { id: 'c1', kind: 'client', name: 'Alpha', expiry: '2026-09-10', workspaceId: 'w1' }, // expired 9d
  { id: 'c2', kind: 'client', name: 'Beta',  expiry: '2026-10-05', workspaceId: 'w1' }, // soon 16d
  { id: 'c3', kind: 'client', name: 'Gamma', expiry: '2026-10-19', workspaceId: 'w2' }, // soon, exactly 30d
  { id: 'c4', kind: 'client', name: 'Delta', expiry: '2026-10-20', workspaceId: 'w1' }, // 31d - dropped
  { id: 'c5', kind: 'client', name: 'Eps',   expiry: '',           workspaceId: 'w1' }, // blank - dropped
  { id: 'c6', kind: 'client', name: 'Zeta',  expiry: 'not-a-date', workspaceId: 'w1' }, // junk - dropped
  { id: 'v1', kind: 'vendor', name: 'Vend',  expiry: '2026-09-19', workspaceId: null }, // soon, today
];
const due = expiryDue(rows, TODAY);
eq('keeps only expired + within 30 days', due.map((c) => c.id), ['c1', 'c2', 'c3', 'v1']);
eq('the boundary at exactly 30 days is kept', due.some((c) => c.id === 'c3'), true);
eq('a day past the window is dropped', due.some((c) => c.id === 'c4'), false);

const byId = Object.fromEntries(due.map((c) => [c.id, c]));
eq('an overdue row is marked expired with a negative daysLeft',
  [byId.c1.state, byId.c1.daysLeft], ['expired', -9]);
eq('a within-window row is soon with days left', [byId.c2.state, byId.c2.daysLeft], ['soon', 16]);
eq('today counts as soon, zero days left', [byId.v1.state, byId.v1.daysLeft], ['soon', 0]);

// The message: right noun, right tense.
eq('expired client message', expiryMessage(byId.c1),
  { title: 'CR expired', body: "Alpha's CR expired 9 days ago (2026-09-10)." });
eq('soon client message', expiryMessage(byId.c2),
  { title: 'CR expiring soon', body: "Beta's CR expires in 16 days (2026-10-05)." });
eq('vendor says licence, today reads "today"', expiryMessage(byId.v1),
  { title: 'Licence expiring soon', body: "Vend's licence expires today (2026-09-19)." });

// The link / dedup key: unique per workspace, record and state.
const linkC1 = expiryLink(byId.c1, 'w1');
ok('the link carries the record, its state and the workspace',
  linkC1.includes('expiry=c1') && linkC1.includes('state=expired') && linkC1.includes('ws=w1')
  && linkC1.includes('view=clients'));
ok('a vendor notice to two workspaces gets two distinct links',
  expiryLink(byId.v1, 'w1') !== expiryLink(byId.v1, 'w2'));
ok('the same record in soon vs expired gets distinct links',
  expiryLink({ ...byId.c2, state: 'soon' }, 'w1')
  !== expiryLink({ ...byId.c2, state: 'expired' }, 'w1'));

// An empty scan is quiet, not an error.
eq('nothing due is an empty list', expiryDue([], TODAY), []);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
