'use client';

import { useEffect, useState } from 'react';
import { portal, type PortalBrandRow, type PortalMe } from '@/lib/portal-api';
import { DetailGrid, CopyButton } from './PortalUI';

/**
 * Profile tab. Two cards:
 *  - Primary details (Company for client, Personal for vendor)
 *  - Entities — Brands for client (fetched), Bank accounts for vendor (on `me`)
 */
export function PortalProfile({
  me,
  onRequestChange,
}: {
  me: PortalMe;
  onRequestChange: () => void;
}) {
  return me.role === 'client'
    ? <ClientProfile me={me} onRequestChange={onRequestChange} />
    : <VendorProfile me={me} onRequestChange={onRequestChange} />;
}

function ClientProfile({
  me, onRequestChange,
}: {
  me: Extract<PortalMe, { role: 'client' }>;
  onRequestChange: () => void;
}) {
  const p = me.profile;
  const [brands, setBrands] = useState<PortalBrandRow[] | null>(null);

  useEffect(() => {
    portal.brands().then(setBrands).catch(() => setBrands([]));
  }, []);

  const active = (brands ?? []).filter((b) => (b.status || 'active') === 'active').length;
  const paused = (brands?.length ?? 0) - active;

  return (
    <>
      <div className="portal-section-head">
        <div>
          <h2>Company &amp; brands</h2>
          <p>Everything AQ Creativity has on file. Something out of date? Send us a note in Help.</p>
        </div>
        <button type="button" className="aq-btn aq-btn-secondary aq-btn-sm" onClick={onRequestChange}>
          Request a change
        </button>
      </div>

      <div className="portal-card" style={{ marginBottom: 16 }}>
        <h3>Company details</h3>
        <DetailGrid fields={[
          { k: 'Company name', v: p.company_name },
          { k: 'Signatory',    v: p.contact_name },
          { k: 'CR number',    v: p.cr_number, copyable: true },
          { k: 'VAT number',   v: p.vat_number, copyable: true },
          { k: 'Phone',        v: p.contact_phone, copyable: true },
          { k: 'Company email', v: p.company_email || me.email, copyable: true },
          { k: 'Personal email', v: p.contact_email, copyable: true },
          { k: 'City / country', v: [p.city, p.country].filter(Boolean).join(', ') },
        ]} />
      </div>

      <div className="portal-card">
        <h3>
          <span>Brands</span>
          <span className="aq-badge aq-badge-muted">
            {brands == null ? 'loading…' :
             brands.length === 0 ? 'None on file' :
             paused > 0 ? `${active} active · ${paused} paused` : `${active} active`}
          </span>
        </h3>
        {brands == null ? (
          <p style={{ color: 'var(--aq-text-muted)', fontSize: 13 }}>Loading…</p>
        ) : brands.length === 0 ? (
          <p style={{ color: 'var(--aq-text-muted)', fontSize: 13 }}>
            No brands on file yet. Talk to your AQ contact to add one.
          </p>
        ) : (
          <div className="portal-entity-grid">
            {brands.map((b) => (
              <div key={b.id} className="portal-entity-card">
                <div className="head">
                  <div className="name">{b.brand_name}</div>
                  <span className={`aq-badge ${b.status === 'paused' ? 'aq-badge-muted' : 'aq-badge-success'}`}>
                    {b.status || 'active'}
                  </span>
                </div>
                {b.description && <div className="desc">{b.description}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function VendorProfile({
  me, onRequestChange,
}: {
  me: Extract<PortalMe, { role: 'vendor' }>;
  onRequestChange: () => void;
}) {
  const p = me.profile;
  return (
    <>
      <div className="portal-section-head">
        <div>
          <h2>Profile &amp; banking</h2>
          <p>Everything AQ Creativity has on file. Something out of date? Send us a note in Help.</p>
        </div>
        <button type="button" className="aq-btn aq-btn-secondary aq-btn-sm" onClick={onRequestChange}>
          Request a change
        </button>
      </div>

      <div className="portal-card" style={{ marginBottom: 16 }}>
        <h3>Personal details</h3>
        <DetailGrid fields={[
          { k: 'Full name',  v: p.name },
          { k: 'License #',  v: p.license_number, copyable: true },
          { k: 'Category',   v: p.vendor_category },
          { k: 'Platforms',  v: p.platforms },
          { k: 'Phone',      v: p.phone, copyable: true },
          { k: 'Email',      v: p.email || me.email, copyable: true },
        ]} />
      </div>

      <div className="portal-card">
        <h3>
          <span>Bank accounts</span>
          <span className="aq-badge aq-badge-muted">
            {me.banks.length === 0 ? 'None on file' : `${me.banks.length} on file`}
          </span>
        </h3>
        {me.banks.length === 0 ? (
          <p style={{ color: 'var(--aq-text-muted)', fontSize: 13 }}>
            No bank accounts on file. Contact AQ to add one before your next payout.
          </p>
        ) : (
          <div className="portal-entity-grid">
            {me.banks.map((b) => (
              <div key={b.id} className="portal-entity-card">
                <div className="head">
                  <div className="name">{b.bank_name}</div>
                  <span className="aq-badge aq-badge-muted">{b.account_name}</span>
                </div>
                <div className="iban">
                  <span>{b.iban}</span>
                  <CopyButton value={b.iban} />
                </div>
                <div className="desc">
                  SWIFT {b.swift_code || '—'} · Acct {b.account_number || '—'}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
