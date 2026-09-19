'use client';

/**
 * Vendor Performance — who delivers on time, who needs chasing, who is worth
 * rebooking, from the ad lines the app already keeps.
 *
 * An ad line has no vendor of its own; it belongs to a booking subtask that
 * names the vendor. `useVendorPerformanceLines` does that join and hands back
 * flat, vendor-tagged lines; `vendorPerformance` (pure, tested) rolls them up
 * per vendor and sorts the ones needing action to the top. This screen only
 * puts names to the ids and draws the table.
 *
 * Delivery first — on-time posting, proof attached, what is overdue — then the
 * money beside it: what each vendor is owed (the booking net, summed) against
 * what has been paid, so "who to chase" reads on both axes at once. The money
 * is the booking-level figure across all their bookings, which is the vendor
 * relationship; the Finance Liability ledger is the stricter completed-only
 * view of the same numbers.
 */

import { useMemo, useState } from 'react';
import { useVendorPerformanceLines, useLegacyVendors, type WorkspaceRole } from '@/hooks/use-workflow';
import {
  vendorPerformance, reliabilityBand, vendorMoney, type VendorPerf,
} from '@/lib/vendor-performance';
import { AqDrawingBlock } from '@/components/AQLoading';
import { RegistryHeader, RegistryToolbar, Chip } from './RegistryTable';

const BAND_COLOR: Record<'reliable' | 'ok' | 'shaky' | 'none', string> = {
  reliable: 'var(--aq-green-strong, #15803d)',
  ok: 'var(--aq-text)',
  shaky: 'var(--aq-red, #dc2626)',
  none: 'var(--aq-text-muted)',
};

interface Named extends VendorPerf {
  name: string;
  category: string | null;
  owed: number;
  paid: number;
  outstanding: number;
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
  const { lines, money, loading: linesLoading } = useVendorPerformanceLines(workspaceId);
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

  const moneyByVendor = useMemo(() => vendorMoney(money), [money]);

  const ranked: Named[] = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return vendorPerformance(lines, today).map((p) => {
      const meta = nameById.get(p.vendorId);
      const m = moneyByVendor.get(p.vendorId);
      return {
        ...p,
        name: meta?.name ?? `Vendor ${p.vendorId}`,
        category: meta?.category ?? null,
        owed: m?.owed ?? 0,
        paid: m?.paid ?? 0,
        outstanding: m?.outstanding ?? 0,
      };
    });
  }, [lines, nameById, moneyByVendor]);

  const needChasing = useMemo(() => ranked.filter((r) => r.needsChasing > 0).length, [ranked]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ranked.filter((r) => {
      if (chaseOnly && r.needsChasing === 0) return false;
      if (!q) return true;
      return `${r.name} ${r.category ?? ''}`.toLowerCase().includes(q);
    });
  }, [ranked, query, chaseOnly]);

  const loading = linesLoading || vendorsLoading;
  const line = ranked.length === 0
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
              shown.map((r) => {
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
    </div>
  );
}

const TH: React.CSSProperties = { padding: '10px 12px', fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', whiteSpace: 'nowrap' };
const TH_NUM: React.CSSProperties = { ...TH, textAlign: 'right' };
const TD: React.CSSProperties = { padding: '10px 12px', verticalAlign: 'top' };
const TD_NUM: React.CSSProperties = { ...TD, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };
