'use client';

import { useEffect, useState } from 'react';
import { portal, type PortalContractRow, type PortalBrandRow, type PortalMe } from '@/lib/portal-api';
import { Stat, StatusBadge, DownloadBtn, sumByCurrency, fmtMoney } from './PortalUI';
import { AQContactCard } from './AQContactCard';

/**
 * Overview tab. Renders a greeting hero, four stat tiles, a recent-contracts
 * preview, and the AQ contact card. Role-aware — switches stats and copy.
 */
export function PortalOverview({
  me,
  onSeeAll,
}: {
  me: PortalMe;
  onSeeAll: () => void;
}) {
  const [contracts, setContracts] = useState<PortalContractRow[]>([]);
  const [brands, setBrands] = useState<PortalBrandRow[]>([]);

  useEffect(() => {
    portal.contracts().then(setContracts).catch(() => setContracts([]));
    if (me.role === 'client') {
      portal.brands().then(setBrands).catch(() => setBrands([]));
    }
  }, [me.role]);

  const firstName =
    me.role === 'client'
      ? (me.profile.contact_name?.split(' ')[0] ?? me.profile.company_name)
      : me.profile.name.split(' ')[0];

  const heroTitle = `Welcome back, ${firstName}.`;
  const heroSub =
    me.role === 'client'
      ? `Here are the brands, contracts and contact details AQ Creativity has on file for ${me.profile.company_name}.`
      : 'Here are your contracts, payment details, and the AQ team contact info — everything AQ Creativity has on file for you.';

  return (
    <>
      <div className="portal-hero">
        <div className="portal-hero-tag">Signed in</div>
        <h1>{heroTitle}</h1>
        <p>{heroSub}</p>
        <div className="portal-hero-cta">
          <button type="button" className="aq-btn aq-btn-primary" onClick={onSeeAll}>
            View all contracts
          </button>
        </div>
      </div>

      <div className="portal-stats">{renderStats({ me, contracts, brands })}</div>

      <div className="portal-dash-grid">
        <div className="portal-card">
          <h3>
            Recent contracts
            <button type="button" className="linklike" onClick={onSeeAll}>
              See all →
            </button>
          </h3>
          {contracts.length === 0 ? (
            <p style={{ color: 'var(--aq-text-muted)', fontSize: 13 }}>
              No contracts yet. They&apos;ll show up here as soon as AQ generates them.
            </p>
          ) : (
            <ul className="portal-contract-list">
              {contracts.slice(0, 4).map((c) => (
                <li key={c.contract_id} className="portal-contract-row">
                  <div>
                    <div className="portal-contract-id">{c.contract_id}</div>
                    <div className="portal-contract-type">{c.contract_type}</div>
                  </div>
                  <div className="portal-contract-brand">{c.brand_name || '—'}</div>
                  <div className="portal-contract-amount">{c.amount}</div>
                  <div><StatusBadge row={c} /></div>
                  <div className="portal-contract-actions">
                    <DownloadBtn contractId={c.contract_id} kind="pdf"  disabled={!c.has_pdf}  />
                    <DownloadBtn contractId={c.contract_id} kind="docx" disabled={!c.has_docx} variant="ghost" />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <AQContactCard />
      </div>
    </>
  );
}

function renderStats({
  me, contracts, brands,
}: {
  me: PortalMe;
  contracts: PortalContractRow[];
  brands: PortalBrandRow[];
}) {
  const totals = sumByCurrency(contracts);
  const primary = totals[0];
  const others = totals.slice(1);

  const ytdValue = primary ? fmtMoney(primary.total, primary.currency) : '—';
  const ytdSub = others.length
    ? `+ ${others.map((o) => fmtMoney(o.total, o.currency)).join(' · ')}`
    : 'Across all contracts';

  const last = contracts[0]?.generated_at ?? '—';
  const lastSub =
    contracts[0]
      ? `${contracts[0].contract_type}${contracts[0].brand_name ? ` · ${contracts[0].brand_name}` : ''}`
      : 'No activity yet';

  if (me.role === 'client') {
    const active = brands.filter((b) => (b.status || 'active') === 'active').length;
    const paused = brands.length - active;
    return (
      <>
        <Stat label="Active contracts" value={contracts.length} sub={contracts.length ? 'Generated for your brands' : 'None yet'} />
        <Stat label="Brands on file"   value={brands.length}    sub={brands.length ? `${active} active · ${paused} paused` : 'Talk to AQ to add one'} />
        <Stat label="YTD contract value" value={ytdValue} sub={ytdSub} />
        <Stat label="Last activity"    value={last} sub={lastSub} />
      </>
    );
  }

  return (
    <>
      <Stat label="Active contracts" value={contracts.length}  sub={contracts.length ? 'Generated for you' : 'None yet'} />
      <Stat label="Bank accounts"    value={me.banks.length}   sub={me.banks.length ? 'On file for payment' : 'Contact AQ to add one'} />
      <Stat label="YTD earnings (gross)" value={ytdValue} sub={ytdSub} />
      <Stat label="Last activity"    value={last} sub={lastSub} />
    </>
  );
}
