'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  useClients, useLegacyVendors, useCrmRecentActivities,
  type ClientRow, type LegacyVendor,
} from '@/hooks/use-workflow';
import { CrmContactDetail } from './CrmContactDetail';

/**
 * Top-level CRM view.
 *
 * Layout: master/detail.
 *   - LEFT: tabs for Clients / Vendors + search + scrollable list of contacts.
 *   - RIGHT: detail panel — profile snapshot + activity timeline + add-activity
 *     form. If no contact is selected, shows recent activity across the
 *     workspace.
 */

export type CrmTab = 'clients' | 'vendors';

export interface CrmContact {
  type: 'client' | 'vendor';
  id: string;
  name: string;
  subtitle?: string;
  meta?: string;
}

export function CrmView({
  workspaceId, currentUserId, currentUserName,
}: {
  workspaceId: string;
  currentUserId: string;
  currentUserName: string;
}) {
  const [tab, setTab] = useState<CrmTab>('clients');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<CrmContact | null>(null);

  const { clients } = useClients();
  const { vendors } = useLegacyVendors();
  const { items: recent, loading: loadingRecent, refetch: refetchRecent } = useCrmRecentActivities(workspaceId, 25);

  const contacts: CrmContact[] = useMemo(() => {
    if (tab === 'clients') {
      return (clients || []).map((c: ClientRow) => ({
        type: 'client' as const,
        id: c.id,
        name: c.company_name,
        subtitle: c.signatory_name || c.contact_email || '—',
        meta: c.cr_number ? `CR ${c.cr_number}` : (c.city || ''),
      }));
    }
    return (vendors || []).map((v: LegacyVendor) => ({
      type: 'vendor' as const,
      id: String(v.id),
      name: v.name,
      subtitle: v.license_number ? `License ${v.license_number}` : '—',
      meta: v.created_at ? new Date(v.created_at).toLocaleDateString() : '',
    }));
  }, [tab, clients, vendors]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter((c) =>
      [c.name, c.subtitle, c.meta, c.id].some((v) => String(v || '').toLowerCase().includes(q)),
    );
  }, [contacts, query]);

  // When the tab changes, clear the selection so the right panel resets to
  // the recent-activity view.
  useEffect(() => { setSelected(null); }, [tab]);

  return (
    <div className="animate-fade-in" style={{
      display: 'grid',
      gridTemplateColumns: 'minmax(0, 360px) minmax(0, 1fr)',
      gap: 16,
      alignItems: 'start',
    }}>
      {/* LEFT: tabs + search + list */}
      <aside className="aq-card" style={{ padding: 0, display: 'flex', flexDirection: 'column', maxHeight: 'calc(100vh - 200px)' }}>
        <div style={{ padding: 14, borderBottom: '1px solid var(--aq-border-light)', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', gap: 6, background: 'var(--aq-bg-sunken)', padding: 4, borderRadius: 999 }}>
            <TabButton active={tab === 'clients'} onClick={() => setTab('clients')}>
              Clients <span style={pillCount}>{clients?.length ?? 0}</span>
            </TabButton>
            <TabButton active={tab === 'vendors'} onClick={() => setTab('vendors')}>
              Vendors <span style={pillCount}>{vendors?.length ?? 0}</span>
            </TabButton>
          </div>
          <input
            className="aq-input"
            placeholder={`Search ${tab}…`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <ul style={{ listStyle: 'none', overflowY: 'auto', flex: 1 }}>
          {filtered.length === 0 ? (
            <li style={{ padding: 24, fontSize: 13, color: 'var(--aq-text-muted)', textAlign: 'center' }}>
              No {tab} match that search.
            </li>
          ) : filtered.map((c) => {
            const isSel = selected?.type === c.type && selected.id === c.id;
            return (
              <li key={`${c.type}-${c.id}`}>
                <button
                  type="button"
                  onClick={() => setSelected(c)}
                  style={{
                    display: 'flex', flexDirection: 'column', gap: 2,
                    width: '100%', textAlign: 'left',
                    padding: '12px 14px', border: 'none',
                    background: isSel ? 'var(--aq-accent-light)' : 'transparent',
                    borderLeft: isSel ? '3px solid var(--aq-accent)' : '3px solid transparent',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  <strong style={{ fontSize: 13, color: 'var(--aq-text)' }}>{c.name}</strong>
                  <span style={{ fontSize: 11, color: 'var(--aq-text-muted)' }}>
                    {c.subtitle}{c.meta ? ` · ${c.meta}` : ''}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </aside>

      {/* RIGHT: detail or recent-activity feed */}
      <main>
        {selected ? (
          <CrmContactDetail
            contact={selected}
            workspaceId={workspaceId}
            currentUserId={currentUserId}
            currentUserName={currentUserName}
            onChanged={() => { refetchRecent(); }}
            onClose={() => setSelected(null)}
          />
        ) : (
          <RecentActivityFeed
            items={recent}
            loading={loadingRecent}
            onOpenContact={(c) => {
              // Try to resolve the contact from our lists; if not found, fall
              // back to a minimal stub so the detail panel can still load
              // activities for that target.
              const list = c.type === 'client' ? contacts : contacts;
              const found = list.find((x) => x.type === c.type && x.id === c.id);
              setSelected(found ?? c);
              setTab(c.type === 'client' ? 'clients' : 'vendors');
            }}
          />
        )}
      </main>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: 1, padding: '8px 14px',
        background: active ? '#0b0b0e' : 'transparent',
        color: active ? '#fff' : 'var(--aq-text-muted)',
        border: 'none', borderRadius: 999,
        fontWeight: 700, fontSize: 13,
        cursor: 'pointer', fontFamily: 'inherit',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
      }}
    >{children}</button>
  );
}

const pillCount: React.CSSProperties = {
  background: 'rgba(255,255,255,0.18)',
  padding: '1px 8px', borderRadius: 999,
  fontSize: 11, fontWeight: 700,
};

function RecentActivityFeed({
  items, loading, onOpenContact,
}: {
  items: any[];
  loading: boolean;
  onOpenContact: (c: CrmContact) => void;
}) {
  return (
    <div className="aq-card" style={{ padding: 22 }}>
      <header style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 800 }}>Recent CRM activity</h2>
        <p style={{ fontSize: 13, color: 'var(--aq-text-muted)', marginTop: 4 }}>
          The last 25 things logged across all clients and vendors. Pick a contact on the left to see their full timeline.
        </p>
      </header>
      {loading ? (
        <p style={{ color: 'var(--aq-text-muted)' }}>Loading…</p>
      ) : items.length === 0 ? (
        <p style={{ color: 'var(--aq-text-muted)' }}>
          Nothing logged yet. Pick a client or vendor on the left and add the first note.
        </p>
      ) : (
        <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {items.map((a) => (
            <li key={a.id} style={{
              padding: '10px 12px', borderRadius: 'var(--aq-radius)',
              background: 'var(--aq-bg-sunken)',
              cursor: 'pointer',
            }}
              onClick={() => onOpenContact({ type: a.target_type, id: a.target_id, name: a.target_id })}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <strong style={{ fontSize: 13 }}>
                  <KindIcon kind={a.kind} /> {a.author_name || 'Someone'}
                </strong>
                <span style={{ fontSize: 11, color: 'var(--aq-text-muted)' }}>
                  {timeAgo(a.occurred_at)} · {a.target_type}
                </span>
              </div>
              {a.body && (
                <p style={{ marginTop: 4, fontSize: 13, color: 'var(--aq-text-secondary)' }}>{a.body}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function KindIcon({ kind }: { kind: string }) {
  const map: Record<string, string> = {
    note: '📝', call: '📞', meeting: '🤝', email: '✉️', status_change: '⚑',
  };
  return <span aria-hidden style={{ marginRight: 4 }}>{map[kind] || '•'}</span>;
}

function timeAgo(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7)  return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}
