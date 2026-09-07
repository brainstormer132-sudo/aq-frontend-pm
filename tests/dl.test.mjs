import { nextAction } from '../.test-build/contracts.js';

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; }
  else { fail++; console.log(`FAIL ${name}\n  got  ${g}\n  want ${w}`); }
};

const gen = (over = {}) => ({
  id: 'r1', status: 'generated', file: 'both', party: 'Reem', ...over,
});

/* ── A generated contract, now that the route exists ─────────────── */
{
  const a = nextAction(gen(), { canManage: true, canDownload: true });
  eq('offers to open it', a.kind, 'open');
  eq('enabled', a.disabled, false);
  eq('with no excuse attached', a.reason, null);
  eq('label', a.label, 'Open');
}
// DOCX-only: the PDF never rendered. The label has to say so, because the
// button hands over a different file from the one people expect.
{
  const a = nextAction(gen({ file: 'docx_only' }), { canManage: true, canDownload: true });
  eq('says which file', a.label, 'Open DOCX');
  eq('still enabled', a.disabled, false);
}
// No file at all — nothing to hand over, whatever the permission.
{
  const a = nextAction(gen({ file: 'missing' }), { canManage: true, canDownload: true });
  eq('disabled', a.disabled, true);
  eq('and says why', a.reason, 'The backend has no file for this contract.');
}

/* ── Permission ──────────────────────────────────────────────────── */
// The old state, kept as a test so the reason string stays honest if the
// flag is ever turned back off.
{
  const a = nextAction(gen(), { canManage: true, canDownload: false });
  eq('disabled without the route', a.disabled, true);
  eq('reason', a.reason, 'Downloading needs a route on the contract backend.');
}
// A viewer who may not manage may not download either: the file carries the
// vendor's IBAN and both sides' money.
{
  const a = nextAction(gen(), { canManage: false, canDownload: false });
  eq('no download for a viewer', a.disabled, true);
}
{
  // The button is still DRAWN rather than left out — an absent control is
  // indistinguishable from a missing feature.
  const a = nextAction(gen(), { canManage: false, canDownload: false });
  eq('drawn, not hidden', a.kind, 'open');
}

/* ── Nothing else moved ──────────────────────────────────────────── */
{
  const a = nextAction({ id: 'r2', status: 'pending', file: 'missing' },
    { canManage: true, canDownload: true });
  eq('pending is not an open', a.kind !== 'open', true);
}
{
  const a = nextAction({ id: 'r3', status: 'rejected', file: 'missing' },
    { canManage: true, canDownload: true });
  eq('rejected offers nothing', a.kind, 'none');
}
{
  const a = nextAction({ id: 'r4', status: 'cancelled', file: 'missing' },
    { canManage: true, canDownload: true });
  eq('cancelled offers nothing', a.kind, 'none');
}
{
  const a = nextAction({ id: 'r5', status: 'pending', file: 'missing' },
    { canManage: false, canDownload: true });
  eq('a viewer still cannot act', a.kind, 'none');
  eq('and is told why', a.reason,
    'Only owners, admins, marketing and key accounts act on contracts.');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
