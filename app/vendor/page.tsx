'use client';

import { useEffect, useState } from 'react';
import { PortalShell } from '@/components/portal/PortalShell';
import { portal, type PortalContractRow, type PortalMe } from '@/lib/portal-api';

export default function VendorPortalPage() {
  return (
    <PortalShell expectedRole="vendor">
      {(me) => <VendorDashboard me={me} />}
    </PortalShell>
  );
}

function VendorDashboard({ me }: { me: Extract<PortalMe, { role: 'vendor' }> }) {
  const [contracts, setContracts] = useState<PortalContractRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const list = await portal.contracts();
        setContracts(list);
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
        <h2 style={{ fontSize: 22, fontWeight: 800 }}>Welcome, {me.profile.name}</h2>
        <p style={{ color: 'var(--aq-text-muted)', fontSize: 14, marginTop: 4 }}>
          Your contracts, banking, and license details — all the AQ Creativity has on file for you.
        </p>
      </div>

      <section style={statsRow}>
        <Stat label="Contracts" value={contracts.length} />
        <Stat label="Bank accounts" value={me.banks.length} />
        <Stat label="Category" value={me.profile.vendor_category || '—'} />
      </section>

      {/* Profile card */}
      <section className="aq-card" style={{ padding: 22 }}>
        <h3 style={cardTitle}>Profile</h3>
        <DetailGrid fields={[
          ['Full name', me.profile.name],
          ['License #', me.profile.license_number],
          ['Category', me.profile.vendor_category || '—'],
          ['Platforms', me.profile.platforms || '—'],
          ['Phone', me.profile.phone || '—'],
          ['Email', me.profile.email || me.email],
        ]} />
      </section>

      {/* Bank accounts */}
      <section className="aq-card" style={{ padding: 22 }}>
        <h3 style={cardTitle}>Bank accounts</h3>
        {me.banks.length === 0 ? (
          <p style={{ color: 'var(--aq-text-muted)', fontSize: 13 }}>
            No bank accounts on file. Contact AQ Creativity to add one.
          </p>
        ) : (
          <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {me.banks.map((b) => (
              <li key={b.id} style={bankRow}>
                <div>
                  <strong>{b.bank_name}</strong>
                  <div style={{ fontSize: 12, color: 'var(--aq-text-muted)' }}>{b.account_name}</div>
                </div>
                <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontSize: 12 }}>
                  {b.iban}
                </div>
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
          <p style={{ color: 'var(--aq-text-muted)', fontSize: 13 }}>
            No contracts yet. New contracts will appear here as soon as AQ generates them.
          </p>
        ) : (
          <ContractsTable rows={contracts} />
        )}
      </section>
    </div>
  );
}

// ─── Shared bits also used by the client dashboard ─────────────────────────

export function ContractsTable({ rows }: { rows: PortalContractRow[] }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={tableStyle}>
        <thead>
          <tr>
            <Th>Contract</Th>
            <Th>Brand</Th>
            <Th>Amount</Th>
            <Th>Type</Th>
            <Th>Generated</Th>
            <Th>Status</Th>
            <Th>Download</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.contract_id}>
              <Td><code style={{ fontSize: 12 }}>{c.contract_id}</code></Td>
              <Td>{c.brand_name || '—'}</Td>
              <Td>{c.amount}</Td>
              <Td>{c.contract_type}</Td>
              <Td>{c.generated_at}</Td>
              <Td>
                <span className={`aq-badge ${c.has_pdf ? 'aq-badge-success' : 'aq-badge-warning'}`}>
                  {c.has_pdf ? 'DOCX + PDF' : 'DOCX only'}
                </span>
              </Td>
              <Td>
                <div style={{ display: 'flex', gap: 6 }}>
                  <DownloadBtn contractId={c.contract_id} kind="pdf" disabled={!c.has_pdf} />
                  <DownloadBtn contractId={c.contract_id} kind="docx" disabled={!c.has_docx} />
                </div>
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DownloadBtn({
  contractId, kind, disabled,
}: { contractId: string; kind: 'pdf' | 'docx'; disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="aq-btn aq-btn-secondary"
      style={{ padding: '6px 10px', fontSize: 12 }}
      disabled={disabled || busy}
      onClick={async () => {
        setBusy(true);
        try {
          // Need to attach the JWT manually since this isn't an <a href>.
          const { createClient } = await import('@/lib/supabase-browser');
          const supabase = createClient();
          const { data: { session } } = await supabase.auth.getSession();
          if (!session?.access_token) throw new Error('Sign in again.');
          const url = portal.downloadUrl(contractId, kind);
          const r = await fetch(url, { headers: { Authorization: `Bearer ${session.access_token}` } });
          if (!r.ok) {
            const t = await r.text();
            throw new Error(t || `Download failed (${r.status})`);
          }
          const blob = await r.blob();
          const blobUrl = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = blobUrl;
          a.download = `${contractId}.${kind}`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(blobUrl);
        } catch (e: any) {
          window.alert(e?.message ?? 'Download failed.');
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? '…' : kind.toUpperCase()}
    </button>
  );
}

export function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="aq-card" style={{ padding: 18 }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--aq-text-muted)' }}>
        {label}
      </div>
      <div style={{ marginTop: 6, fontSize: 26, fontWeight: 800 }}>{value}</div>
    </div>
  );
}

export function DetailGrid({ fields }: { fields: Array<[string, string | number | null | undefined]> }) {
  return (
    <ul style={{ listStyle: 'none', display: 'grid', gridTemplateColumns: '140px 1fr', gap: '6px 14px', fontSize: 13 }}>
      {fields.map(([k, v]) => (
        <li key={k} style={{ display: 'contents' }}>
          <span style={{ color: 'var(--aq-text-muted)', fontWeight: 600 }}>{k}</span>
          <span style={{ wordBreak: 'break-word' }}>{v ?? '—'}</span>
        </li>
      ))}
    </ul>
  );
}

const Th = ({ children }: { children: React.ReactNode }) => (
  <th style={{ textAlign: 'left', fontSize: 11, fontWeight: 800, color: 'var(--aq-text-muted)', padding: '8px 10px', borderBottom: '1px solid var(--aq-border-light)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{children}</th>
);
const Td = ({ children }: { children: React.ReactNode }) => (
  <td style={{ padding: '10px', borderBottom: '1px solid var(--aq-border-light)', fontSize: 13 }}>{children}</td>
);

const cardTitle: React.CSSProperties = { fontSize: 15, fontWeight: 800, margin: '0 0 12px' };
const statsRow: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12,
};
const tableStyle: React.CSSProperties = { width: '100%', borderCollapse: 'collapse' };
const bankRow: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', gap: 10,
  padding: '10px 12px',
  border: '1px solid var(--aq-border-light)',
  borderRadius: 'var(--aq-radius)',
};
const errorBlock: React.CSSProperties = {
  fontSize: 13, color: 'var(--aq-error)',
  padding: '12px 14px', background: '#fef2f2',
  borderRadius: 'var(--aq-radius)',
};
