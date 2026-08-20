'use client';

import { useState } from 'react';
import {
  useVendorAdLines, createAdLine, updateAdLine, deleteAdLine, type AdLine,
} from '@/hooks/use-workflow';
import {
  totalsOf, blankLine, lineProblems, adTypeSummary, AD_LINE_STATUSES,
} from '@/lib/ad-lines';

/**
 * The ads inside one vendor booking.
 *
 * A Package Ad is sold as one booking with several ads in it — six home ads,
 * six store visits, and often a few reminders that cost nothing. The subtask
 * above this card holds the vendor, the contract and the money; these lines
 * hold what was actually booked, and one contract is written from all of
 * them.
 *
 * Zero is a legal price here, and the card says so out loud. The instinct on
 * seeing "SAR 0" is to treat it as unfinished, and a free reminder that gets
 * "fixed" or deleted is work that ends up delivered but not contracted.
 *
 * Each line carries its own due date, brief and status: same vendor, same
 * contract, different work. Six home ads booked together still land on six
 * different days, and one due date on the booking cannot say that.
 *
 * Dates commit when you leave the box, never while the picker is open — the
 * same rule as everywhere else on this panel, for the same reason.
 */
export function AdLinesCard({
  subtaskId, canEdit,
}: {
  subtaskId: string;
  canEdit: boolean;
}) {
  const { lines, loading, refetch } = useVendorAdLines(subtaskId);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  const totals = totalsOf(lines);

  const add = async () => {
    setBusy('new'); setError('');
    try {
      await createAdLine({ ...blankLine(subtaskId, lines), ad_type: 'Ad' });
      await refetch();
    } catch (e: any) { setError(e?.message ?? String(e)); }
    finally { setBusy(null); }
  };

  const patch = async (line: AdLine, fields: Partial<AdLine>) => {
    if (!line.id) return;
    const next = { ...line, ...fields };
    const problems = lineProblems(next);
    if (problems.length) { setError(problems[0]); return; }
    setBusy(line.id); setError('');
    try { await updateAdLine(line.id, fields); await refetch(); }
    catch (e: any) { setError(e?.message ?? String(e)); }
    finally { setBusy(null); }
  };

  const remove = async (line: AdLine) => {
    if (!line.id) return;
    setBusy(line.id); setError('');
    try { await deleteAdLine(line.id); await refetch(); }
    catch (e: any) { setError(e?.message ?? String(e)); }
    finally { setBusy(null); }
  };

  return (
    <section className="aq-card" style={{ padding: 18, marginTop: 14 }}>
      <header style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700 }}>Ads in this booking</h3>
          <p style={{ fontSize: 12, color: 'var(--aq-text-muted)', marginTop: 2 }}>
            One contract covers all of them. A line can cost nothing — a free reminder
            still belongs in the contract.
          </p>
        </div>
        {canEdit && (
          <button
            type="button"
            className="aq-btn aq-btn-secondary"
            disabled={busy === 'new'}
            onClick={add}
            style={{ fontSize: 12.5, padding: '5px 12px', whiteSpace: 'nowrap' }}
          >{busy === 'new' ? 'Adding…' : 'Add line'}</button>
        )}
      </header>

      {error && (
        <p style={{ fontSize: 12.5, color: '#b91c1c', marginBottom: 8 }}>{error}</p>
      )}

      {loading ? (
        <p style={{ fontSize: 13, color: 'var(--aq-text-muted)' }}>Loading…</p>
      ) : lines.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--aq-text-muted)' }}>
          No lines yet. Without them the contract is written from the single price on
          this subtask, which is right for a one-off booking and wrong for a package.
        </p>
      ) : (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 940 }}>
              <thead>
                <tr>
                  {['Ad type', 'Platform', 'Due', 'Brief', 'Status', 'Qty', 'Unit price', 'Line total', ''].map((h, i) => (
                    <th key={h || i} style={{
                      textAlign: i >= 5 && i <= 7 ? 'right' : 'left',
                      fontSize: 10.5, letterSpacing: '.09em', textTransform: 'uppercase',
                      color: 'var(--aq-text-muted)', padding: '6px 8px', whiteSpace: 'nowrap',
                      borderBottom: '1px solid var(--aq-border-light)',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => {
                  const free = Number(l.line_total ?? (l.quantity * l.unit_price)) === 0;
                  return (
                    <tr key={l.id} style={{ opacity: busy === l.id ? 0.6 : 1 }}>
                      <td style={CELL}>
                        <input
                          className="aq-input"
                          defaultValue={l.ad_type}
                          disabled={!canEdit}
                          onBlur={(e) => {
                            if (e.target.value.trim() !== l.ad_type) patch(l, { ad_type: e.target.value.trim() });
                          }}
                          style={{ width: 150, padding: '4px 8px', fontSize: 12.5 }}
                        />
                      </td>
                      <td style={CELL}>
                        <input
                          className="aq-input"
                          defaultValue={l.platform ?? ''}
                          disabled={!canEdit}
                          placeholder="—"
                          onBlur={(e) => {
                            const v = e.target.value.trim() || null;
                            if (v !== (l.platform ?? null)) patch(l, { platform: v });
                          }}
                          style={{ width: 120, padding: '4px 8px', fontSize: 12.5 }}
                        />
                      </td>
                      <td style={CELL}>
                        {/* Commits on blur, not while the picker is open. */}
                        <input
                          className="aq-input"
                          type="date"
                          defaultValue={l.due_date ?? ''}
                          disabled={!canEdit}
                          onBlur={(e) => {
                            const v = e.target.value || null;
                            if (v !== (l.due_date ?? null)) patch(l, { due_date: v });
                          }}
                          style={{ width: 140, padding: '4px 8px', fontSize: 12.5 }}
                        />
                      </td>
                      <td style={CELL}>
                        <input
                          className="aq-input"
                          defaultValue={l.description ?? ''}
                          disabled={!canEdit}
                          placeholder="what this one is"
                          onBlur={(e) => {
                            const v = e.target.value.trim() || null;
                            if (v !== (l.description ?? null)) patch(l, { description: v });
                          }}
                          style={{ width: 190, padding: '4px 8px', fontSize: 12.5 }}
                        />
                      </td>
                      <td style={CELL}>
                        <select
                          className="aq-input"
                          value={l.status ?? 'Not started'}
                          disabled={!canEdit}
                          onChange={(e) => patch(l, { status: e.target.value })}
                          style={{ width: 130, padding: '4px 8px', fontSize: 12.5 }}
                        >
                          {AD_LINE_STATUSES.map((st) => <option key={st} value={st}>{st}</option>)}
                        </select>
                      </td>
                      <td style={{ ...CELL, textAlign: 'right' }}>
                        <input
                          className="aq-input"
                          type="number"
                          min={1}
                          defaultValue={l.quantity}
                          disabled={!canEdit}
                          onBlur={(e) => {
                            const v = Number(e.target.value);
                            if (v !== l.quantity) patch(l, { quantity: v });
                          }}
                          style={{ width: 64, padding: '4px 8px', fontSize: 12.5, textAlign: 'right' }}
                        />
                      </td>
                      <td style={{ ...CELL, textAlign: 'right' }}>
                        <input
                          className="aq-input"
                          type="number"
                          min={0}
                          step="0.01"
                          defaultValue={l.unit_price}
                          disabled={!canEdit}
                          onBlur={(e) => {
                            const v = Number(e.target.value);
                            if (v !== Number(l.unit_price)) patch(l, { unit_price: v });
                          }}
                          style={{ width: 100, padding: '4px 8px', fontSize: 12.5, textAlign: 'right' }}
                        />
                      </td>
                      <td style={{ ...CELL, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {free ? (
                          <span style={{ color: 'var(--aq-text-muted)' }}>no charge</span>
                        ) : (
                          Number(l.line_total ?? 0).toLocaleString('en-US')
                        )}
                      </td>
                      <td style={{ ...CELL, textAlign: 'right' }}>
                        {canEdit && (
                          <button
                            type="button"
                            className="aq-btn aq-btn-secondary"
                            disabled={busy === l.id}
                            onClick={() => remove(l)}
                            style={{ fontSize: 12, padding: '3px 9px' }}
                          >Remove</button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p style={{ fontSize: 12.5, color: 'var(--aq-text-secondary)', marginTop: 10 }}>
            <strong>{totals.ads} ad{totals.ads === 1 ? '' : 's'}</strong>
            {' · '}SAR {Math.round(totals.amount).toLocaleString('en-US')}
            {totals.freeLines > 0 && ` · ${totals.freeLines} free line${totals.freeLines === 1 ? '' : 's'}`}
          </p>
          <p style={{ fontSize: 12, color: 'var(--aq-text-muted)', marginTop: 4 }}>
            The contract will read: {adTypeSummary(lines)}
          </p>
          {lines.some((l) => !l.due_date) && (
            <p style={{ fontSize: 12, color: '#b91c1c', marginTop: 4 }}>
              {lines.filter((l) => !l.due_date).length} line
              {lines.filter((l) => !l.due_date).length === 1 ? '' : 's'} with no due date —
              they stay off the calendar and out of the contract's schedule until they have one.
            </p>
          )}
        </>
      )}
    </section>
  );
}

const CELL = {
  padding: '6px 8px',
  borderBottom: '1px solid var(--aq-border-light)',
  whiteSpace: 'nowrap' as const,
};
