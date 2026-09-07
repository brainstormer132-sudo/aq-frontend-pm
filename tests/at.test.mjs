import { EMPTY_FILTER, filterRows, buildRows } from '../.test-build/all-tasks.js';
let p=0,f=0;
const eq=(n,g,w)=>{ if(JSON.stringify(g)===JSON.stringify(w)) p++; else {f++;console.log(`FAIL ${n}: ${JSON.stringify(g)} != ${JSON.stringify(w)}`);} };

const tasks = [
  { id:'a', task_name:'Live one',   stage:'in_progress', status:'in_progress' },
  { id:'b', task_name:'Done one',   stage:'completed',   status:'done' },
  { id:'c', task_name:'Another done', stage:'completed', status:'done' },
  { id:'d', task_name:'Waiting',    stage:'pending_marketing', status:'pending' },
];
const rows = buildRows({ tasks, rollup: [], today: '2026-08-27' });
const names = (rs) => rs.map(r => r.name ?? r.title ?? r.raw?.task_name).sort();

// ── the bug: a finished campaign vanished from a list called All Tasks ──
eq('default shows completed', filterRows(rows, EMPTY_FILTER, []).length, 4);
eq('and names them',
   names(filterRows(rows, EMPTY_FILTER, [])),
   ['Another done','Done one','Live one','Waiting']);

// ── hiding is now a choice ──
const hidden = { ...EMPTY_FILTER, showCompleted: false };
eq('hiding drops exactly the completed', filterRows(rows, hidden, []).length, 2);
eq('and keeps the rest', names(filterRows(rows, hidden, [])), ['Live one','Waiting']);

// ── the stage filter still beats the toggle, both ways ──
const onlyDone = { ...EMPTY_FILTER, showCompleted: false, stage: 'completed' };
eq('picking Completed shows them even while hidden', filterRows(rows, onlyDone, []).length, 2);
const onlyLive = { ...EMPTY_FILTER, stage: 'in_progress' };
eq('picking a stage still narrows', filterRows(rows, onlyLive, []).length, 1);

// ── search still reaches a completed one ──
eq('search finds a completed campaign',
   filterRows(rows, { ...EMPTY_FILTER, query: 'done one' }, []).length, 1);

console.log(`\n${p} passed, ${f} failed`);
process.exit(f?1:0);
