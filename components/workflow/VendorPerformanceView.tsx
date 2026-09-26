'use client';

/**
 * Vendor Performance — who delivers on time, who needs chasing, who is worth
 * rebooking, from the ad lines the app already keeps.
 *
 * An ad line has no vendor of its own; it belongs to a booking subtask that
 * names the vendor. That join, the roll-up and the sort all happen in the
 * DATABASE now (migration 143): one call, one row per vendor, already
 * counted and already ordered. This screen puts names to the ids and draws
 * the table, and nothing else.
 *
 * It used to fetch every booking and every ad line in the company and roll
 * them up here, which took five minutes to open. The rules did not change -
 * the SQL is a translation of lib/vendor-performance.ts, and
 * scripts/check-vendor-performance-sql.mjs runs both over the same data on
 * every CI run to prove they still agree.
 *
 * Delivery first — on-time posting, proof attached, what is overdue — then the
 * money beside it: what each vendor is owed (the booking net, summed) against
 * what has been paid, so "who to chase" reads on both axes at once. The money
 * is the booking-level figure across all their bookings, which is the vendor
 * relationship; the Finance Liability ledger is the stricter completed-only
 * view of the same numbers.
 */

import { useEffect, useMemo, useState } from 'react';
import { useVendorPerformance, useLegacyVendors, type WorkspaceRole } from '@/hooks/use-workflow';
import { reliabilityBand } from '@/lib/vendor-performance';
import { pageSlice, DEFAULT_PAGE_SIZE } from '@/lib/registry';
import { AqDrawingBlock } from '@/components/AQLoading';
import { RegistryHeader, RegistryToolbar, Chip, RegistryPager } from './RegistryTable';

const BAND_COLOR: Record<'reliable' | 'ok' | 'shaky' | 'none', string> = {
  reliable: 'var(--aq-green-strong, #15803d)',
  ok: 'var(--aq-text)',
  shaky: 'var(--aq-red, #dc2626)',
  none: 'var(--aq-text-muted)',
};

interface Named {
  vendorId: string;
  ads: number;
  onTime: number;
  late: number;
  overdue: number;
  missingProof: number;
  reliabilityPct: number | null;
  needsChasing: number;
  lastPostedOn: string | null;
  owed: number;
  paid: number;
  outstanding: number;
  name: string;
  category: string | null;
}

function sar(n: number): string {
  return n ? `SAR ${Math.round(n).toLocaleString('en-US')}` : '—';
}

export function VendorPerformanceView({
  workspaceId, role,
}: {
  workspaceId: string;
  role: WorkspaceRole | null;
}) {
  void role;
  const { vendors, loading: vendorsLoading } = useLegacyVendors();

  const [query, setQuery] = useState('');
  const [chaseOnly, setChaseOnly] = useState(false);

  const nameById = useMemo(() => {
    const m = new Map<string, { name: string; category: string | null }>();
    for (const v of vendors) {
      m.set(String(v.id), {
        name: (v.name || '').trim() || 'Unnamed vendor',
        category: ((v as any).vendor_category || '').trim() || null,
      });
    }
    return m;
  }, [vendors]);

  // Set in an effect, never read during render. Two reasons, and LegalCases
  // has carried the same fix for the same ones since it hit this:
  //
  //   * read during render this is a FRESH STRING every time, so a memo that
  //     lists it as a dep never matches and recomputes on every render;
  //   * Next.js renders this on the server too, so across midnight the
  //     server's day and the browser's differ and React reports a hydration
  //     mismatch.
  const [today, setToday] = useState('');
  useEffect(() => { setToday(new Date().toISOString().slice(0, 10)); }, []);

  // The database has already counted, sorted and paired the money to each
  // vendor. All that is left is the name, which lives in the registry.
  const { rows, loading: rowsLoading, error } = useVendorPerformance(workspaceId, today);

  const ranked: Named[] = useMemo(() => rows.map((r) => {
    const meta = nameById.get(r.vendorId);
    return {
      ...r,
      name: meta?.name ?? `Vendor ${r.vendorId}`,
      category: meta?.category ?? null,
    };
  }), [rows, nameById]);

  const needChasing = useMemo(() => ranked.filter((r) => r.needsChasing > 0).length, [ranked]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ranked.filter((r) => {
      if (chaseOnly && r.needsChasing === 0) return false;
      if (!q) return true;
      return `${r.name} ${r.category ?? ''}`.toLowerCase().includes(q);
    });
  }, [ranked, query, chaseOnly]);

  // Paint one page at a time. The search and the chase filter above still run
  // over every vendor - `shown` is the whole matching set and the count line
  // below reports its length - this only limits what is DRAWN. Ten rows of ten
  // columns is cheap; four thousand of them is the freeze that this screen
  // shares with the registry, and the registry already solved it this way.
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [query, chaseOnly, pageSize]);
  const paged = useMemo(() => pageSlice(shown, page, pageSize), [shown, page, pageSize]);

  const loading = rowsLoading || vendorsLoading;
  const line = error
    ? `Could not load vendor delivery: ${error}`
    : ranked.length === 0
    ? 'No vendor delivery on record yet.'
    : `${ranked.length} vendor${ranked.length === 1 ? '' : 's'} with delivery on record`
      + (needChasing > 0 ? ` · ${needChasing} to chase` : '');

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <RegistryHeader title="Vendor performance" line={line} />

      <RegistryToolbar
        query={query}
        onQuery={setQuery}
        placeholder="Search a vendor or category…"
      >
        <Chip
          label="Needs chasing"
          count={needChasing}
          danger
          on={chaseOnly}
          onClick={() => setChaseOnly((v) => !v)}
        />
      </RegistryToolbar>

      <div className="aq-card" style={{ padding: 0, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 940 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: 'var(--aq-text-muted)' }}>
              <th style={TH}>Vendor</th>
              <th style={TH_NUM}>Ads</th>
              <th style={TH_NUM}>On-time</th>
              <th style={TH_NUM}>Late</th>
              <th style={TH_NUM}>Overdue</th>
              <th style={TH_NUM}>Missing proof</th>
              <th style={TH_NUM}>Net owed</th>
              <th style={TH_NUM}>Paid</th>
              <th style={TH_NUM}>Outstanding</th>
              <th style={TH}>Last posted</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={10} style={{ padding: 8 }}><AqDrawingBlock label={'Loading vendor performance…'} /></td></tr>
            ) : shown.length === 0 ? (
              <tr><td colSpan={10} style={{ textAlign: 'center', color: 'var(--aq-text-muted)', padding: 18 }}>
                {ranked.length === 0
                  ? 'Once vendors are booked on ad lines with due and posted dates, their delivery shows here.'
                  : chaseOnly ? 'Nothing to chase — every vendor is up to date.'
                  : 'No vendor matches that search.'}
              </td></tr>
            ) : (
              paged.rows.map((r) => {
                const band = reliabilityBand(r.reliabilityPct);
                return (
                  <tr key={r.vendorId} style={{ borderTop: '1px solid var(--aq-border-light)' }}>
                    <td style={TD}>
                      <div style={{ fontWeight: 600 }}>{r.name}</div>
                      {r.category ? (
                        <div style={{ fontSize: 11, color: 'var(--aq-text-muted)' }}>{r.category}</div>
                      ) : null}
                    </td>
                    <td style={TD_NUM}>{r.ads}</td>
                    <td style={{ ...TD_NUM, color: BAND_COLOR[band], fontWeight: band === 'none' ? 400 : 700 }}>
                      {r.reliabilityPct == null ? '—' : `${r.reliabilityPct}%`}
                      <div style={{ fontSize: 11, fontWeight: 400, color: 'var(--aq-text-muted)' }}>
                        {r.onTime}/{r.onTime + r.late}
                      </div>
                    </td>
                    <td style={{ ...TD_NUM, color: r.late > 0 ? 'var(--aq-text)' : 'var(--aq-text-muted)' }}>{r.late || '—'}</td>
                    <td style={{ ...TD_NUM, color: r.overdue > 0 ? 'var(--aq-red, #dc2626)' : 'var(--aq-text-muted)', fontWeight: r.overdue > 0 ? 700 : 400 }}>{r.overdue || '—'}</td>
                    <td style={{ ...TD_NUM, color: r.missingProof > 0 ? 'var(--aq-red, #dc2626)' : 'var(--aq-text-muted)', fontWeight: r.missingProof > 0 ? 700 : 400 }}>{r.missingProof || '—'}</td>
                    <td style={{ ...TD_NUM, color: r.owed > 0 ? 'var(--aq-text)' : 'var(--aq-text-muted)' }}>{sar(r.owed)}</td>
                    <td style={{ ...TD_NUM, color: r.paid > 0 ? 'var(--aq-text)' : 'var(--aq-text-muted)' }}>{sar(r.paid)}</td>
                    <td style={{ ...TD_NUM, color: r.outstanding > 0 ? 'var(--aq-text)' : 'var(--aq-text-muted)', fontWeight: r.outstanding > 0 ? 700 : 400 }}>{sar(r.outstanding)}</td>
                    <td style={{ ...TD, color: r.lastPostedOn ? 'var(--aq-text)' : 'var(--aq-text-muted)' }}>{r.lastPostedOn ?? '—'}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {shown.length > 0 ? (
        <RegistryPager
          page={paged.page} pages={paged.pages} size={pageSize}
          total={paged.total} from={paged.from} to={paged.to} noun="vendor"
          onPage={setPage} onSize={setPageSize}
        />
      ) : null}
    </div>
  );
}

const TH: React.CSSProperties = { padding: '10px 12px', fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', whiteSpace: 'nowrap' };
const TH_NUM: React.CSSProperties = { ...TH, textAlign: 'right' };
const TD: React.CSSProperties = { padding: '10px 12px', verticalAlign: 'top' };
const TD_NUM: React.CSSProperties = { ...TD, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };
