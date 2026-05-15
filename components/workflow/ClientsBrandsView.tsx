'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClient as createSupabase } from '@/lib/supabase-browser';
import {
  brands as brandsApi, externalInvites,
  type BrandRow, type ExternalInvite,
} from '@/lib/contract-api';
import { InviteLinkModal } from '@/components/workflow/InviteLinkModal';

const supabase = createSupabase();

interface ClientRow {
  id: string;
  company_name: string;
  contact_name?: string | null;
  contact_email?: string | null;
  city?: string | null;
  cr_number?: string | null;
  vat_number?: string | null;
  invite_status?: string | null;
  status?: string | null;
}

/**
 * Two-pane view: list of approved clients on the left, brand manager on the
 * right. Brand CRUD goes through /api/brands on the contract backend (cross-app
 * Supabase JWT auth).
 */
export function ClientsBrandsView() {
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busyInviteId, setBusyInviteId] = useState<string | null>(null);
  const [activeInvite, setActiveInvite] = useState<ExternalInvite | null>(null);

  const refresh = async () => {
    setLoading(true);
    setError('');
    const { data, error: e } = await supabase
      .from('clients')
      .select('id, company_name, contact_name, contact_email, city, cr_number, vat_number, invite_status, status')
      .eq('status', 'active')
      .order('company_name');
    if (e) setError(e.message);
    setClients((data as ClientRow[] | null) ?? []);
    setLoading(false);
  };

  useEffect(() => { refresh(); }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter((c) =>
      c.company_name.toLowerCase().includes(q) ||
      (c.cr_number || '').toLowerCase().includes(q) ||
      (c.city || '').toLowerCase().includes(q),
    );
  }, [clients, search]);

  const selected = clients.find((c) => c.id === selectedId) ?? null;

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16 }}>
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 800 }}>Clients & Brands</h2>
          <p style={{ color: 'var(--aq-text-muted)', fontSize: 13, marginTop: 4 }}>
            Manage approved clients and the brands that live under each one.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            className="aq-input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search company / CR / city"
            style={{ width: 260 }}
          />
          <button className="aq-btn aq-btn-secondary" onClick={refresh} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </header>

      {error && (
        <div className="aq-badge aq-badge-error" style={{ display: 'block', whiteSpace: 'normal' }}>
          {error}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 420px', gap: 16, alignItems: 'start' }}>
        {/* Clients */}
        <section className="aq-card" style={{ padding: 16, minHeight: 320 }}>
          {loading ? (
            <p style={{ color: 'var(--aq-text-muted)' }}>Loading…</p>
          ) : filtered.length === 0 ? (
            <p style={{ color: 'var(--aq-text-muted)' }}>
              {clients.length === 0
                ? 'No approved clients yet. Approve registrations or create one in Manual Entry.'
                : 'No clients match this search.'}
            </p>
          ) : (
            <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
              {filtered.map((c) => (
                <li key={c.id}>
                  <div
                    onClick={() => setSelectedId(c.id)}
                    style={rowBtn(c.id === selectedId)}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <strong>{c.company_name}</strong>
                      <div style={{ fontSize: 11, color: 'var(--aq-text-muted)' }}>
                        {c.cr_number ? `CR ${c.cr_number}` : 'no CR'} · {c.city || '—'} · {c.contact_email || 'no email'}
                      </div>
                    </div>
                    <span className={inviteStatusClass(c.invite_status)}>
                      {prettyInviteStatus(c.invite_status)}
                    </span>
                    <button
                      type="button"
                      className="aq-btn aq-btn-secondary"
                      style={{ padding: '6px 10px', fontSize: 12 }}
                      disabled={busyInviteId === c.id || !c.contact_email}
                      title={c.contact_email ? 'Issue or re-issue a portal invite' : 'No email on file'}
                      onClick={async (e) => {
                        e.stopPropagation();
                        if (!c.contact_email) return;
                        setBusyInviteId(c.id);
                        setError('');
                        try {
                          const inv = await externalInvites.issue({
                            role: 'client',
                            email: c.contact_email,
                            client_id: c.id,
                          });
                          setActiveInvite(inv);
                          await refresh();
                        } catch (err: any) {
                          setError(err?.message ?? String(err));
                        } finally {
                          setBusyInviteId(null);
                        }
                      }}
                    >
                      {c.invite_status === 'accepted' ? 'Reset' : 'Invite'}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Brand manager */}
        <aside className="aq-card" style={{ padding: 18, position: 'sticky', top: 20 }}>
          {selected ? (
            <BrandManager client={selected} key={selected.id} />
          ) : (
            <p style={{ color: 'var(--aq-text-muted)', fontSize: 13 }}>
              Pick a client on the left to add or rename brands.
            </p>
          )}
        </aside>
      </div>

      <InviteLinkModal invite={activeInvite} onClose={() => setActiveInvite(null)} />
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────

function BrandManager({ client }: { client: ClientRow }) {
  const [brands, setBrands] = useState<BrandRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');

  const refresh = async () => {
    setLoading(true);
    setError('');
    try {
      const list = await brandsApi.withCounts(client.id);
      setBrands(list);
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setBrands([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, [client.id]);

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setBusy('create');
    setError('');
    try {
      await brandsApi.create(client.id, newName.trim(), newDescription.trim() || undefined);
      setNewName('');
      setNewDescription('');
      await refresh();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(null);
    }
  };

  const onRename = async (b: BrandRow) => {
    const next = window.prompt('Rename brand', b.brand_name);
    if (next === null) return;
    const trimmed = next.trim();
    if (!trimmed || trimmed === b.brand_name) return;
    setBusy(b.id);
    setError('');
    try {
      await brandsApi.update(b.id, { brand_name: trimmed });
      await refresh();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(null);
    }
  };

  const onDelete = async (b: BrandRow) => {
    if (!window.confirm(`Delete brand "${b.brand_name}"? This cannot be undone.`)) return;
    setBusy(b.id);
    setError('');
    try {
      await brandsApi.remove(b.id);
      await refresh();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <h3 style={{ fontSize: 15, fontWeight: 800, margin: 0 }}>{client.company_name}</h3>
        <p style={{ fontSize: 11, color: 'var(--aq-text-muted)', marginTop: 4 }}>
          Brands managed under this client
        </p>
      </div>

      {error && (
        <div className="aq-badge aq-badge-error" style={{ display: 'block', whiteSpace: 'normal' }}>{error}</div>
      )}

      <form onSubmit={onCreate} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <input
          className="aq-input"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New brand name"
          required
        />
        <input
          className="aq-input"
          value={newDescription}
          onChange={(e) => setNewDescription(e.target.value)}
          placeholder="Description (optional)"
        />
        <button
          type="submit"
          className="aq-btn aq-btn-primary"
          disabled={busy === 'create' || !newName.trim()}
        >
          {busy === 'create' ? 'Adding…' : 'Add brand'}
        </button>
      </form>

      <hr style={{ border: 0, borderTop: '1px solid var(--aq-border-light)', margin: '4px 0' }} />

      {loading ? (
        <p style={{ color: 'var(--aq-text-muted)', fontSize: 13 }}>Loading brands…</p>
      ) : brands.length === 0 ? (
        <p style={{ color: 'var(--aq-text-muted)', fontSize: 13 }}>No brands yet. Add one above.</p>
      ) : (
        <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {brands.map((b) => (
            <li key={b.id} style={brandRow}>
              <div style={{ flex: 1 }}>
                <strong style={{ fontSize: 13 }}>{b.brand_name}</strong>
                {b.description && (
                  <div style={{ fontSize: 11, color: 'var(--aq-text-muted)' }}>{b.description}</div>
                )}
              </div>
              <span className="aq-badge aq-badge-muted" style={{ fontSize: 11 }}>
                {b.contract_count ?? 0} contract{(b.contract_count ?? 0) === 1 ? '' : 's'}
              </span>
              <button
                type="button"
                className="aq-btn aq-btn-ghost"
                disabled={busy === b.id}
                onClick={() => onRename(b)}
                style={miniBtn}
              >
                Rename
              </button>
              <button
                type="button"
                className="aq-btn aq-btn-ghost"
                disabled={busy === b.id || (b.contract_count ?? 0) > 0}
                title={(b.contract_count ?? 0) > 0 ? 'Brand has generated contracts; rename instead' : ''}
                onClick={() => onDelete(b)}
                style={{ ...miniBtn, color: 'var(--aq-error)' }}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────

function inviteStatusClass(status: string | null | undefined) {
  switch (status) {
    case 'accepted':       return 'aq-badge aq-badge-success';
    case 'invite_sent':    return 'aq-badge aq-badge-info';
    case 'pending_invite': return 'aq-badge aq-badge-warning';
    case 'revoked':        return 'aq-badge aq-badge-error';
    default:               return 'aq-badge aq-badge-muted';
  }
}

function prettyInviteStatus(status: string | null | undefined): string {
  switch (status) {
    case 'accepted':       return 'Portal active';
    case 'invite_sent':    return 'Invite sent';
    case 'pending_invite': return 'Invite pending';
    case 'revoked':        return 'Revoked';
    default:               return 'No portal';
  }
}

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

const brandRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 10px',
  border: '1px solid var(--aq-border-light)',
  borderRadius: 'var(--aq-radius)',
};

const miniBtn: React.CSSProperties = {
  padding: '4px 10px',
  fontSize: 12,
};
