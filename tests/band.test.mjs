import {
  ringOffset, RING_C, isLiveCampaign, isMine, cleanCampaigns, dashboardHero, attentionChips, allTasksHero, welcomeTitle,
} from '../.test-build/band.js';

let pass = 0, fail = 0;
function eq(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; return; }
  fail++;
  console.log(`FAIL ${name}\n  got:  ${g}\n  want: ${w}`);
}

// ringOffset: 0% draws nothing, 100% draws all, out-of-range clamps, junk is 0
eq('0% is full offset', ringOffset(0), Math.round(RING_C * 100) / 100);
eq('100% is zero offset', ringOffset(100), 0);
eq('50% is half', ringOffset(50), Math.round(RING_C * 50) / 100);
eq('150% clamps to 100', ringOffset(150), 0);
eq('-5 clamps to 0', ringOffset(-5), ringOffset(0));
eq('null is 0%', ringOffset(null), ringOffset(0));
eq('NaN is 0%', ringOffset(NaN), ringOffset(0));

// isLiveCampaign
eq('in_progress campaign is live', isLiveCampaign({ id: 'a', stage: 'in_progress', status: 'open' }), true);
eq('completed is not live', isLiveCampaign({ id: 'a', stage: 'completed' }), false);
eq('cancelled is not live', isLiveCampaign({ id: 'a', stage: 'cancelled' }), false);
eq('draft is not live', isLiveCampaign({ id: 'a', stage: 'draft' }), false);
eq('status done is not live', isLiveCampaign({ id: 'a', stage: 'in_progress', status: 'done' }), false);
eq('subtask is never a campaign', isLiveCampaign({ id: 's', parent_task_id: 'a', stage: 'in_progress' }), false);
eq('unknown stage counts as live', isLiveCampaign({ id: 'a', stage: 'something_new' }), true);

// cleanCampaigns
const rows = [
  { id: 'c1', stage: 'in_progress', status: 'open' },
  { id: 'c2', stage: 'in_progress', status: 'open' },
  { id: 'c3', stage: 'pending_marketing', status: 'open' },
  { id: 'c4', stage: 'completed', status: 'done' },
  { id: 's1', parent_task_id: 'c2', stage: 'in_progress', status: 'open' },
  { id: 's4', parent_task_id: 'c4', stage: 'in_progress', status: 'open' },
];
eq('no problems: all clean', cleanCampaigns(rows, []), { live: 3, clean: 3, pct: 100 });
eq('one campaign problem', cleanCampaigns(rows, [{ taskId: 'c1' }]), { live: 3, clean: 2, pct: 67 });
eq('subtask problem resolves to its campaign', cleanCampaigns(rows, [{ taskId: 's1' }]), { live: 3, clean: 2, pct: 67 });
eq('two problems on one campaign count once', cleanCampaigns(rows, [{ taskId: 'c2' }, { taskId: 's1' }]), { live: 3, clean: 2, pct: 67 });
eq('problem on a completed campaign is ignored', cleanCampaigns(rows, [{ taskId: 's4' }, { taskId: 'c4' }]), { live: 3, clean: 3, pct: 100 });
eq('problem on an unknown id is ignored', cleanCampaigns(rows, [{ taskId: 'nope' }]), { live: 3, clean: 3, pct: 100 });
eq('nothing live: pct is null', cleanCampaigns([{ id: 'c4', stage: 'completed' }], []), { live: 0, clean: 0, pct: null });

// dashboardHero
eq('hero names its slice', dashboardHero(rows, [{ taskId: 'c1' }]),
  { value: '67%', label: '2 of 3 live campaigns with nothing wrong', pct: 67 });
eq('singular campaign', dashboardHero([{ id: 'c1', stage: 'in_progress' }], []),
  { value: '100%', label: '1 of 1 live campaign with nothing wrong', pct: 100 });
eq('no live work: no hero', dashboardHero([], []), null);

// mine: assignee / key account / creator, and subtasks inherit from the campaign
const mineRows = [
  { id: 'c1', stage: 'in_progress', assignee_id: 'me' },
  { id: 'c2', stage: 'in_progress', key_account_id: 'me' },
  { id: 'c3', stage: 'in_progress', creator_id: 'me' },
  { id: 'c4', stage: 'in_progress', assignee_id: 'someone' },
  { id: 's4', parent_task_id: 'c4', assignee_id: 'me' },
  { id: 's1', parent_task_id: 'c1', assignee_id: 'someone' },
];
const mineById = new Map(mineRows.map((r) => [r.id, r]));
eq('assignee is mine', isMine(mineRows[0], 'me'), true);
eq('key account is mine', isMine(mineRows[1], 'me'), true);
eq('creator is mine', isMine(mineRows[2], 'me'), true);
eq('someone else is not', isMine(mineRows[3], 'me'), false);
eq('subtask of another campaign, assigned to me, is mine', isMine(mineRows[4], 'me', mineById), true);
eq('subtask of my campaign is mine', isMine(mineRows[5], 'me', mineById), true);
eq('subtask of my campaign without the map is not resolvable', isMine(mineRows[5], 'me'), false);
eq('scoped: only my three campaigns are live', cleanCampaigns(mineRows, [{ taskId: 'c4' }], 'me'), { live: 3, clean: 3, pct: 100 });
eq('scoped: a problem on my subtask hits my campaign', cleanCampaigns(mineRows, [{ taskId: 's1' }], 'me'), { live: 3, clean: 2, pct: 67 });
eq('scoped hero says your', dashboardHero(mineRows, [], 'me'), { value: '100%', label: '3 of your 3 live campaigns with nothing wrong', pct: 100 });
eq('unscoped hero counts all four', dashboardHero(mineRows, [], null).label, '4 of 4 live campaigns with nothing wrong');

// welcomeTitle
eq('first name only', welcomeTitle('Siraj Qurunfulah'), 'Welcome, Siraj');
eq('blank name', welcomeTitle('   '), 'Welcome');
eq('null name', welcomeTitle(null), 'Welcome');

// attentionChips: always three, zeros kept, order fixed
const chips = attentionChips({ urgent: 2, soon: 0, tidy: 5 });
eq('three chips', chips.length, 3);
eq('chip order', chips.map((c) => c.tone), ['urgent', 'soon', 'tidy']);
eq('zero chip kept', chips[1].count, 0);
eq('labels', chips.map((c) => c.label), ['Urgent', 'Soon', 'Missing data']);
eq('no handler means no onClick', chips[0].onClick, undefined);
{
  let got = null;
  const c = attentionChips({ urgent: 1, soon: 1, tidy: 1 }, (s) => { got = s; });
  c[2].onClick();
  eq('chip click passes its severity', got, 'tidy');
}

// allTasksHero
eq('no value: no hero', allTasksHero({ shown: 5, total: 5, value: 0, unpriced: 5 }), null);
eq('all priced, unfiltered', allTasksHero({ shown: 3, total: 3, value: 1234567.4, unpriced: 0 }),
  { value: 'SAR 1,234,567', label: 'across 3 priced campaigns', pct: null });
eq('some unpriced, filtered', allTasksHero({ shown: 4, total: 9, value: 500, unpriced: 3 }),
  { value: 'SAR 500', label: 'across 1 priced campaign (filtered)', pct: null });

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
