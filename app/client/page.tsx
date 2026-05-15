'use client';

import { useEffect, useState } from 'react';
import { PortalShell } from '@/components/portal/PortalShell';
import {
  portal,
  type PortalContractRow, type PortalBrandRow, type PortalMe,
} from '@/lib/portal-api';
import { ContractsTable, Stat, DetailGrid } from '@/app/vendor/page';

export default function ClientPortalPage() {
  return (
    <PortalShell expectedRole="client">
      {(me) => (me.role === 'client' ? <ClientDashboard me={me} /> : null)}
    </PortalShell>
  );
}

function ClientDashboard({ me }: { me: Extract<PortalMe, { role: 'client' }> }) {
  const [contracts, setContracts] = useState<PortalContractRow[]>([]);
  const [brands, setBrands] = useState<PortalBrandRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const [c, b] = await Promise.all([
          portal.contracts().catch(() => []),
          portal.brands().catch(() => []),
        ]);
        setContracts(c);
        setBrands(b);
      } catch (e: any) {
        setError(e?.message ?? String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div>
        <h2 style={{ fontSize: 22, fontWeight: 800 }}>Welcome, {me.profile.company_name}</h2>
        <p style={{ color: 'var(--aq-text-muted)', fontSize: 14, marginTop: 4 }}>
          Your brands, contracts, and the AQ Creativity team contact details.
        </p>
      </div>

      <section style={statsRow}>
        <Stat label="Brands" value={brands.length} />
        <Stat label="Contracts" value={contracts.length} />
        <Stat label="City" value={me.profile.city || '—'} />
      </section>

      {/* Profile */}
      <section className="aq-card" style={{ padding: 22 }}>
        <h3 style={cardTitle}>Company</h3>
        <DetailGrid fields={[
          ['Company name', me.profile.company_name],
          ['Signatory', me.profile.contact_name || '—'],
          ['CR number', me.profile.cr_number || '—'],
          ['VAT number', me.profile.vat_number || '—'],
          ['Phone', me.profile.contact_phone || '—'],
          ['Company email', me.profile.company_email || me.email],
          ['Personal email', me.profile.contact_email || '—'],
          ['City', me.profile.city || '—'],
          ['Country', me.profile.country || '—'],
        ]} />
      </section>

      {/* Brands */}
      <section className="aq-card" style={{ padding: 22 }}>
        <h3 style={cardTitle}>Brands</h3>
        {brands.length === 0 ? (
          <p style={{ color: 'var(--aq-text-muted)', fontSize: 13 }}>
            No brands on file yet. Talk to your AQ contact to add one.
          </p>
        ) : (
          <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {brands.map((b) => (
              <li key={b.id} style={brandRow}>
                <div>
                  <strong>{b.brand_name}</strong>
                  {b.description && (
                    <div style={{ fontSize: 12, color: 'var(--aq-text-muted)' }}>{b.description}</div>
                  )}
                </div>
                <span className={`aq-badge ${b.status === 'active' ? 'aq-badge-success' : 'aq-badge-muted'}`}>
                  {b.status || 'active'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Contracts */}
      <section className="aq-card" style={{ padding: 22 }}>
        <h3 style={cardTitle}>Contracts</h3>
        {loading ? (
          <p style={{ color: 'var(--aq-text-muted)', fontSize: 13 }}>Loading…</p>
        ) : error ? (
          <div style={errorBlock}>{error}</div>
        ) : contracts.length === 0 ? (
          <p style={{ color: 'var(--aq-text-muted)', fontSize: 13 }}>No contracts on file yet.</p>
        ) : (
          <ContractsTable rows={contracts} />
        )}
      </section>
    </div>
  );
}

const cardTitle: React.CSSProperties = { fontSize: 15, fontWeight: 800, margin: '0 0 12px' };
const statsRow: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12,
};
const brandRow: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10,
  padding: '10px 12px',
  border: '1px solid var(--aq-border-light)',
  borderRadius: 'var(--aq-radius)',
};
const errorBlock: React.CSSProperties = {
  fontSize: 13, color: 'var(--aq-error)',
  padding: '12px 14px', background: '#fef2f2', borderRadius: 'var(--aq-radius)',
};
