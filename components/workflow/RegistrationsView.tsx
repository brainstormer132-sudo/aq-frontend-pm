'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  pendingVendors, pendingClients, externalInvites,
  type PendingVendorRow, type PendingClientRow, type ExternalInvite,
} from '@/lib/contract-api';
import { InviteLinkModal } from '@/components/workflow/InviteLinkModal';

type Tab = 'vendors' | 'clients';
type StatusFilter = 'pending' | 'approved' | 'rejected' | 'all';

/**
 * Approve / reject queue for the Netlify-submitted vendor + client forms.
 * The PM dashboard talks to the contract backend via the /contracts/api/...
 * proxy, using the user's Supabase JWT.
 */
export function RegistrationsView() {
  const [tab, setTab] = useState<Tab>('vendors');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('pending');
  const [vendors, setVendors] = useState<PendingVendorRow[]>([]);
  const [clients, setClients] = useState<PendingClientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<number | null>(null);
  const [toast, setToast] = useState('');
  const [selectedVendorId, setSelectedVendorId] = useState<number | null>(null);
  const [selectedClientId, setSelectedClientId] = useState<number | null>(null);
  const [activeInvite, setActiveInvite] = useState<ExternalInvite | null>(null);

  const refresh = async () => {
    setLoading(true);
    setError('');
    try {
      const filter = statusFilter === 'all' ? undefined : statusFilter;
      const [v, c] = await Promise.all([
        pendingVendors.list(filter).catch(() => []),
        pendingClients.list(filter).catch(() => []),
      ]);
      setVendors(v);
      setClients(c);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, [statusFilter]);

  const onAction = async (
    kind: 'vendor' | 'client',
    id: number,
    action: 'approved' | 'rejected',
    alsoIssueInvite = false,
  ) => {
    setBusyId(id);
    setError('');
    setToast('');
    try {
      if (kind === 'vendor') {
        const result = await pendingVendors.action(id, action);
        if (alsoIssueInvite && action === 'approved' && result.vendor_id) {
          const v = vendors.find((x) => x.id === id);
          if (v?.email) {
            const inv = await externalInvites.issue({
              role: 'vendor',
              email: v.email,
              vendor_id: Number(result.vendor_id),
            });
            setActiveInvite(inv);
          } else {
            setToast('Approved. No email on file — issue an invite manually from the Vendors view.');
          }
        }
      } else {
        const result = await pendingClients.action(id, action);
        if (alsoIssueInvite && action === 'approved' && result.client_id) {
          const c = clients.find((x) => x.id === id);
          const email = c?.company_email || c?.email;
          if (email) {
            const inv = await externalInvites.issue({
              role: 'client',
              email,
              client_id: String(result.client_id),
            });
            setActiveInvite(inv);
          } else {
            setToast('Approved. No email on file — issue an invite manually from Clients & Brands.');
          }
        }
      }
      if (!activeInvite) {
        setToast(`${kind === 'vendor' ? 'Vendor' : 'Client'} ${action}.`);
      }
      await refresh();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusyId(null);
    }
  };

  const selectedVendor = useMemo(
    () => vendors.find((v) => v.id === selectedVendorId) ?? null,
    [vendors, selectedVendorId],
  );
  const selectedClient = useMemo(
    () => clients.find((c) => c.id === selectedClientId) ?? null,
    [clients, selectedClientId],
  );

  const counts = {
    vendors: vendors.length,
    clients: clients.length,
  };

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16 }}>
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 800 }}>Registrations</h2>
          <p style={{ color: 'var(--aq-text-muted)', fontSize: 13, marginTop: 4 }}>
            Approve or reject vendors and clients submitted through the public Netlify forms.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <select
            className="aq-select"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          >
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="all">All</option>
          </select>
          <button className="aq-btn aq-btn-secondary" onClick={refresh} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </header>

      {error && <div className="aq-badge aq-badge-error" style={{ display: 'block', whiteSpace: 'normal' }}>{error}</div>}
      {toast && <div className="aq-badge aq-badge-success" style={{ display: 'block' }}>{toast}</div>}

      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--aq-border-light)' }}>
        <TabButton active={tab === 'vendors'} onClick={() => setTab('vendors')}>
          Vendors <span style={countPillStyle}>{counts.vendors}</span>
        </TabButton>
        <TabButton active={tab === 'clients'} onClick={() => setTab('clients')}>
          Clients <span style={countPillStyle}>{counts.clients}</span>
        </TabButton>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 360px', gap: 16, alignItems: 'start' }}>
        {/* List */}
        <section className="aq-card" style={{ padding: 16, minHeight: 300 }}>
          {loading ? (
            <p style={{ color: 'var(--aq-text-muted)' }}>Loading…</p>
          ) : tab === 'vendors' ? (
            vendors.length === 0 ? (
              <p style={{ color: 'var(--aq-text-muted)' }}>No vendor registrations match this filter.</p>
            ) : (
              <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
                {vendors.map((v) => (
                  <li key={v.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedVendorId(v.id)}
                      style={rowBtn(v.id === selectedVendorId)}
                    >
                      <div>
                        <strong>{v.full_name}</strong>
                        <div style={{ fontSize: 11, color: 'var(--aq-text-muted)' }}>
                          {v.vendor_category || '—'} · {v.email || 'no email'} · {v.phone || 'no phone'}
                        </div>
                      </div>
                      <span className={statusPillClass(v.status)}>{v.status}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : (
            clients.length === 0 ? (
              <p style={{ color: 'var(--aq-text-muted)' }}>No client registrations match this filter.</p>
            ) : (
              <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
                {clients.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedClientId(c.id)}
                      style={rowBtn(c.id === selectedClientId)}
                    >
                      <div>
                        <strong>{c.company_name}</strong>
                        <div style={{ fontSize: 11, color: 'var(--aq-text-muted)' }}>
                          CR {c.cr_number || '—'} · VAT {c.vat_number || '—'} · {c.city || '—'}
                        </div>
                      </div>
                      <span className={statusPillClass(c.status)}>{c.status}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )
          )}
        </section>

        {/* Detail panel */}
        <aside className="aq-card" style={{ padding: 18, position: 'sticky', top: 20 }}>
          {tab === 'vendors' ? (
            selectedVendor ? (
              <VendorDetail
                v={selectedVendor}
                busy={busyId === selectedVendor.id}
                onAction={(act, withInvite) => onAction('vendor', selectedVendor.id, act, withInvite)}
              />
            ) : (
              <p style={{ color: 'var(--aq-text-muted)', fontSize: 13 }}>
                Pick a vendor on the left to see their full submission.
              </p>
            )
          ) : (
            selectedClient ? (
              <ClientDetail
                c={selectedClient}
                busy={busyId === selectedClient.id}
                onAction={(act, withInvite) => onAction('client', selectedClient.id, act, withInvite)}
              />
            ) : (
              <p style={{ color: 'var(--aq-text-muted)', fontSize: 13 }}>
                Pick a client on the left to see their full submission.
              </p>
            )
          )}
        </aside>
      </div>

      <InviteLinkModal invite={activeInvite} onClose={() => setActiveInvite(null)} />
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────

function VendorDetail({
  v, busy, onAction,
}: {
  v: PendingVendorRow;
  busy: boolean;
  onAction: (action: 'approved' | 'rejected', alsoIssueInvite?: boolean) => void;
}) {
  const fields: Array<[string, string | undefined | null]> = [
    ['Full name', v.full_name],
    ['License #', v.license_number],
    ['License expiry', v.license_expiry || '—'],
    ['Category', v.vendor_category],
    ['Platforms', v.platforms],
    ['Email', v.email],
    ['Phone', v.phone],
    ['IBAN', v.iban],
    ['Bank', v.bank_name],
    ['Account name', v.account_name],
    ['Account #', v.account_number],
    ['SWIFT', v.swift_code],
    ['Submitted', v.submitted_at || '—'],
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h3 style={{ fontSize: 15, fontWeight: 800, margin: 0 }}>{v.full_name}</h3>
      <DetailFields fields={fields} />
      <ActionRow status={v.status} busy={busy} onAction={onAction} />
    </div>
  );
}

function ClientDetail({
  c, busy, onAction,
}: {
  c: PendingClientRow;
  busy: boolean;
  onAction: (action: 'approved' | 'rejected', alsoIssueInvite?: boolean) => void;
}) {
  const fields: Array<[string, string | undefined | null]> = [
    ['Company', c.company_name],
    ['Signatory', c.signatory_name],
    ['CR', c.cr_number],
    ['VAT', c.vat_number],
    ['Phone', c.phone],
    ['Personal email', c.email],
    ['Company email', c.company_email],
    ['Street', c.street],
    ['City', c.city],
    ['Postcode', c.postcode],
    ['Country', c.country],
    ['National address', c.national_address],
    ['Submitted', c.submitted_at || '—'],
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h3 style={{ fontSize: 15, fontWeight: 800, margin: 0 }}>{c.company_name}</h3>
      <DetailFields fields={fields} />
      {(c.permit_doc || c.vat_doc || c.national_address_doc) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
          <strong style={{ fontSize: 12, color: 'var(--aq-text-muted)' }}>Documents</strong>
          {c.permit_doc && <a href={c.permit_doc} target="_blank" rel="noopener noreferrer" style={linkStyle}>Commercial permit</a>}
          {c.vat_doc && <a href={c.vat_doc} target="_blank" rel="noopener noreferrer" style={linkStyle}>VAT certificate</a>}
          {c.national_address_doc && <a href={c.national_address_doc} target="_blank" rel="noopener noreferrer" style={linkStyle}>National address</a>}
        </div>
      )}
      <ActionRow status={c.status} busy={busy} onAction={onAction} />
    </div>
  );
}

function DetailFields({ fields }: { fields: Array<[string, string | undefined | null]> }) {
  return (
    <ul style={{ listStyle: 'none', display: 'grid', gridTemplateColumns: '110px 1fr', gap: '6px 12px', fontSize: 13 }}>
      {fields.map(([k, val]) => (
        <li key={k} style={{ display: 'contents' }}>
          <span style={{ color: 'var(--aq-text-muted)', fontWeight: 600 }}>{k}</span>
          <span style={{ wordBreak: 'break-word' }}>{val || '—'}</span>
        </li>
      ))}
    </ul>
  );
}

function ActionRow({
  status, busy, onAction,
}: {
  status: string;
  busy: boolean;
  onAction: (action: 'approved' | 'rejected', alsoIssueInvite?: boolean) => void;
}) {
  const isPending = status === 'pending';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          className="aq-btn aq-btn-primary"
          disabled={busy || !isPending}
          onClick={() => onAction('approved', true)}
          style={{ flex: 1 }}
          title={isPending ? 'Approve and immediately issue a portal invite' : `Already ${status}`}
        >
          {busy ? 'Working…' : 'Approve + invite'}
        </button>
        <button
          type="button"
          className="aq-btn aq-btn-secondary"
          disabled={busy || !isPending}
          onClick={() => onAction('approved', false)}
          style={{ flex: 1 }}
          title="Approve without issuing a portal invite"
        >
          Approve only
        </button>
      </div>
      <button
        type="button"
        className="aq-btn aq-btn-ghost"
        disabled={busy || !isPending}
        onClick={() => onAction('rejected')}
        style={{ color: 'var(--aq-error)' }}
      >
        Reject
      </button>
    </div>
  );
}

function TabButton({
  active, onClick, children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '10px 18px',
        background: 'transparent',
        border: 'none',
        borderBottom: `2px solid ${active ? 'var(--aq-accent)' : 'transparent'}`,
        color: active ? 'var(--aq-text)' : 'var(--aq-text-muted)',
        fontWeight: active ? 700 : 600,
        fontSize: 14,
        cursor: 'pointer',
        fontFamily: 'inherit',
      }}
    >
      {children}
    </button>
  );
}

function statusPillClass(status: string): string {
  if (status === 'approved') return 'aq-badge aq-badge-success';
  if (status === 'rejected') return 'aq-badge aq-badge-error';
  return 'aq-badge aq-badge-warning';
}

const countPillStyle: React.CSSProperties = {
  marginLeft: 6,
  padding: '1px 7px',
  borderRadius: 9999,
  background: 'var(--aq-border-light)',
  fontSize: 11,
  fontWeight: 700,
};

const linkStyle: React.CSSProperties = {
  color: 'var(--aq-accent)',
  fontSize: 13,
  textDecoration: 'underline',
  wordBreak: 'break-all',
};

function rowBtn(active: boolean): React.CSSProperties {
  return {
    width: '100%',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    padding: '10px 12px',
    border: '1px solid var(--aq-border-light)',
    borderRadius: 'var(--aq-radius)',
    background: active ? 'var(--aq-bg-elevated)' : 'transparent',
    cursor: 'pointer',
    fontFamily: 'inherit',
    textAlign: 'left',
  };
}
