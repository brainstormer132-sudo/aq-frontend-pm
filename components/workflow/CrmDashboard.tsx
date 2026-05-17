'use client';

import { useMemo, useState } from 'react';
import {
  useClients, useLegacyVendors, useCrmRecentActivities,
  type CrmActivity, type ClientRow, type LegacyVendor,
} from '@/hooks/use-workflow';

/**
 * CRM Dashboard — company-wide view.
 *
 * Top: 4 stat cards (Total clients, Total vendors, Activity 30d, Dormant 60d+).
 * Middle: Activity by kind (donut) + Most active contacts (top 5).
 * Bottom: Dormant contacts (top 5 longest-quiet) + Recent activity feed.
 *
 * Search box at the very top filters which contacts contribute to all
 * stats below — pick a vendor name or client CR and the whole dashboard
 * narrows to just that contact.
 */

const ACTIVE_WINDOW_DAYS = 30;
const DORMANT_AFTER_DAYS = 60;

interface NormalizedContact {
  type: 'client' | 'vendor';
  id: string;
  name: string;
  meta: string;
}

export function CrmDashboard({
  workspaceId,
  onOpenContact,
}: {
  workspaceId: string;
  onOpenContact: (c: NormalizedContact) => void;
}) {
  const [query, setQuery] = useState('');

  const { clients } = useClients();
  const { vendors } = useLegacyVendors();
  // Pull a large recent window once; everything else is derived client-side
  // so the dashboard responds instantly to filter changes.
  const { items: activities, loading } = useCrmRecentActivities(workspaceId, 500);

  const contacts: NormalizedContact[] = useMemo(() => {
    const cs = (clients || []).map((c: ClientRow) => ({
      type: 'client' as const,
      id: c.id,
      name: c.company_name,
      meta: c.cr_number ? `CR ${c.cr_number}` : (c.city || ''),
    }));
    const vs = (vendors || []).map((v: LegacyVendor) => ({
      type: 'vendor' as const,
      id: String(v.id),
      name: v.name,
      meta: v.license_number ? `License ${v.license_number}` : '',
    }));
    return [...cs, ...vs];
  }, [clients, vendors]);

  // Apply the search filter
  const q = query.trim().toLowerCase();
  const scopedContacts = useMemo(() => {
    if (!q) return contacts;
    return contacts.filter((c) =>
      [c.name, c.meta, c.id].some((v) => String(v || '').toLowerCase().includes(q)),
    );
  }, [contacts, q]);

  const scopeKey = useMemo(
    () => new Set(scopedContacts.map((c) => `${c.type}:${c.id}`)),
    [scopedContacts],
  );

  const scopedActivities = useMemo(() => {
    if (!q) return activities;
    return activities.filter((a) => scopeKey.has(`${a.target_type}:${a.target_id}`));
  }, [activities, scopeKey, q]);

  // Stats
  const now = Date.now();
  const activeWindow  = now - ACTIVE_WINDOW_DAYS * 86_400_000;
  const dormantBefore = now - DORMANT_AFTER_DAYS * 86_400_000;

  const recent = useMemo(
    () => scopedActivities.filter((a) => new Date(a.occurred_at).getTime() >= activeWindow),
    [scopedActivities, activeWindow],
  );

  // Map: contactKey → last activity timestamp (ms)
  const lastByContact = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of scopedActivities) {
      const k = `${a.target_type}:${a.target_id}`;
      const t = new Date(a.occurred_at).getTime();
      if (!m.has(k) || m.get(k)! < t) m.set(k, t);
    }
    return m;
  }, [scopedActivities]);

  // Map: contactKey → count of activities in last 30 days
  const countByContact = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of recent) {
      const k = `${a.target_type}:${a.target_id}`;
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }, [recent]);

  // Activity by kind (last 30d)
  const byKind = useMemo(() => {
    const m: Record<string, number> = { note: 0, call: 0, meeting: 0, email: 0, status_change: 0 };
    for (const a of recent) m[a.kind] = (m[a.kind] ?? 0) + 1;
    return m;
  }, [recent]);

  // Top contacts (sorted by activity count in last 30d, desc)
  const mostActive = useMemo(() => {
    return scopedContacts
      .map((c) => ({ contact: c, count: countByContact.get(`${c.type}:${c.id}`) ?? 0 }))
      .filter((r) => r.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);
  }, [scopedContacts, countByContact]);

  // Dormant contacts: never contacted, OR last contact older than 60d.
  // Sort by oldest-last-contact-first.
  const dormant = useMemo(() => {
    return scopedContacts
      .map((c) => ({ contact: c, lastMs: lastByContact.get(`${c.type}:${c.id}`) ?? 0 }))
      .filter((r) => r.lastMs === 0 || r.lastMs < dormantBefore)
      .sort((a, b) => a.lastMs - b.lastMs)
      .slice(0, 6);
  }, [scopedContacts, lastByContact, dormantBefore]);

  // Stats numbers
  const totalClients = scopedContacts.filter((c) => c.type === 'client').length;
  const totalVendors = scopedContacts.filter((c) => c.type === 'vendor').length;
  const totalRecent  = recent.length;
  const totalDormant = dormant.length;

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Search bar */}
      <div className="aq-card" style={{ padding: 14 }}>
        <input
          className="aq-input"
          placeholder="Filter the whole dashboard — vendor name, client name, CR number, license, ID…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {q && (
          <p style={{ marginTop: 6, fontSize: 12, color: 'var(--aq-text-muted)' }}>
            Scoped to {scopedContacts.length} contact{scopedContacts.length === 1 ? '' : 's'} matching "{q}"
            <button
              type="button"
              className="aq-btn aq-btn-ghost"
              onClick={() => setQuery('')}
              style={{ marginLeft: 8, padding: '2px 8px', fontSize: 11 }}
            >clear</button>
          </p>
        )}
      </div>

      {/* Top stat cards */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: 12,
      }}>
        <StatCard label="Clients" value={totalClients} />
        <StatCard label="Vendors" value={totalVendors} />
        <StatCard
          label={`Activity (${ACTIVE_WINDOW_DAYS}d)`}
          value={totalRecent}
          tone={totalRecent > 0 ? 'info' : 'default'}
        />
        <StatCard
          label={`Dormant ${DORMANT_AFTER_DAYS}d+`}
          value={totalDormant}
          tone={totalDormant > 0 ? 'warn' : 'good'}
        />
      </div>

      {/* Middle row */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.4fr)',
        gap: 16,
        alignItems: 'start',
      }}>
        {/* Activity by kind */}
        <section className="aq-card" style={{ padding: 22 }}>
          <header style={{ marginBottom: 14 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700 }}>Activity by type</h3>
            <p style={{ fontSize: 12, color: 'var(--aq-text-muted)', marginTop: 2 }}>
              Last {ACTIVE_WINDOW_DAYS} days.
            </p>
          </header>
          <KindDonut byKind={byKind} />
        </section>

        {/* Most active contacts */}
        <section className="aq-card" style={{ padding: 22 }}>
          <header style={{ marginBottom: 14 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700 }}>Most active contacts</h3>
            <p style={{ fontSize: 12, color: 'var(--aq-text-muted)', marginTop: 2 }}>
              Top contacts by activity count in the last {ACTIVE_WINDOW_DAYS} days.
            </p>
          </header>
          {loading ? (
            <p style={{ color: 'var(--aq-text-muted)', fontSize: 13 }}>Loading…</p>
          ) : mostActive.length === 0 ? (
            <p style={{ color: 'var(--aq-text-muted)', fontSize: 13 }}>
              No activity in this window yet. Log a call or note on a contact to start tracking.
            </p>
          ) : (
            <BarList
              rows={mostActive.map((r) => ({
                label: r.contact.name,
                sub: `${r.contact.type === 'client' ? '🏢' : '🧑‍💼'} ${r.contact.meta || r.contact.type}`,
                value: r.count,
                onClick: () => onOpenContact(r.contact),
              }))}
              suffix={(v) => `${v} ${v === 1 ? 'item' : 'items'}`}
            />
          )}
        </section>
      </div>

      {/* Bottom row */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
        gap: 16,
        alignItems: 'start',
      }}>
        {/* Dormant contacts */}
        <section className="aq-card" style={{ padding: 22 }}>
          <header style={{ marginBottom: 14 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700 }}>Dormant contacts</h3>
            <p style={{ fontSize: 12, color: 'var(--aq-text-muted)', marginTop: 2 }}>
              No activity in the last {DORMANT_AFTER_DAYS} days. These need a check-in.
            </p>
          </header>
          {loading ? (
            <p style={{ color: 'var(--aq-text-muted)', fontSize: 13 }}>Loading…</p>
          ) : dormant.length === 0 ? (
            <p style={{ color: 'var(--aq-text-muted)', fontSize: 13 }}>
              Everyone has been contacted recently. Nice.
            </p>
          ) : (
            <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {dormant.map((r) => (
                <li key={`${r.contact.type}:${r.contact.id}`}>
                  <button
                    type="button"
                    onClick={() => onOpenContact(r.contact)}
                    style={dormantRowStyle}
                  >
                    <div style={{ flex: 1, textAlign: 'left' }}>
                      <strong style={{ fontSize: 13 }}>{r.contact.name}</strong>
                      <div style={{ fontSize: 11, color: 'var(--aq-text-muted)' }}>
                        {r.contact.type} · {r.contact.meta || '—'}
                      </div>
                    </div>
                    <span className="aq-badge aq-badge-warning" style={{ fontSize: 11 }}>
                      {r.lastMs ? `${Math.floor((now - r.lastMs) / 86_400_000)}d quiet` : 'never contacted'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Recent activity feed */}
        <section className="aq-card" style={{ padding: 22 }}>
          <header style={{ marginBottom: 14 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700 }}>Recent activity</h3>
            <p style={{ fontSize: 12, color: 'var(--aq-text-muted)', marginTop: 2 }}>
              The last 10 things logged.
            </p>
          </header>
          {loading ? (
            <p style={{ color: 'var(--aq-text-muted)', fontSize: 13 }}>Loading…</p>
          ) : scopedActivities.length === 0 ? (
            <p style={{ color: 'var(--aq-text-muted)', fontSize: 13 }}>
              No activity yet for this scope.
            </p>
          ) : (
            <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {scopedActivities.slice(0, 10).map((a) => {
                const contact = contacts.find((c) => c.type === a.target_type && c.id === a.target_id);
                return (
                  <li key={a.id} style={{
                    padding: '10px 12px', borderRadius: 'var(--aq-radius)',
                    background: 'var(--aq-bg-sunken)',
                    cursor: contact ? 'pointer' : 'default',
                  }}
                    onClick={() => contact && onOpenContact(contact)}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                      <strong style={{ fontSize: 13 }}>
                        {kindIcon(a.kind)} {contact?.name ?? `(${a.target_type} ${a.target_id})`}
                      </strong>
                      <span style={{ fontSize: 11, color: 'var(--aq-text-muted)' }}>
                        {timeAgo(a.occurred_at)}
                      </span>
                    </div>
                    {a.body && (
                      <p style={{ marginTop: 2, fontSize: 12, color: 'var(--aq-text-secondary)' }}>
                        {a.body.length > 140 ? `${a.body.slice(0, 140)}…` : a.body}
                      </p>
                    )}
                    <span style={{ fontSize: 11, color: 'var(--aq-text-muted)' }}>
                      by {a.author_name || 'someone'}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

// ── Stat card ───────────────────────────────────────────────────────────────
function StatCard({
  label, value, tone = 'default',
}: {
  label: string; value: number; tone?: 'default' | 'info' | 'good' | 'warn';
}) {
  const toneColor =
    tone === 'info' ? 'var(--aq-accent)'
    : tone === 'good' ? '#16a34a'
    : tone === 'warn' ? '#b45309'
    : 'var(--aq-text)';
  return (
    <div className="aq-card" style={{ padding: 18 }}>
      <p style={{
        fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em',
        fontWeight: 700, color: 'var(--aq-text-muted)', margin: 0,
      }}>{label}</p>
      <p style={{
        marginTop: 6, fontSize: 32, fontWeight: 800, color: toneColor, lineHeight: 1,
      }}>{value.toLocaleString()}</p>
    </div>
  );
}

// ── Donut for activity by kind ──────────────────────────────────────────────
function KindDonut({ byKind }: { byKind: Record<string, number> }) {
  const entries = Object.entries(byKind).filter(([, v]) => v > 0);
  const total = entries.reduce((s, [, v]) => s + v, 0);
  const colors: Record<string, string> = {
    note: '#0ea5e9', call: '#22c55e', meeting: '#a855f7',
    email: '#f59e0b', status_change: '#6b7280',
  };
  const radius = 60;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  if (total === 0) {
    return (
      <p style={{ color: 'var(--aq-text-muted)', fontSize: 13, textAlign: 'center', padding: 28 }}>
        No activity yet in this window.
      </p>
    );
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
      <svg viewBox="0 0 160 160" width="140" height="140" style={{ transform: 'rotate(-90deg)' }}>
        {entries.map(([k, v]) => {
          const pct = v / total;
          const dash = pct * circumference;
          const el = (
            <circle
              key={k}
              cx={80} cy={80} r={radius}
              fill="none"
              stroke={colors[k] || '#999'}
              strokeWidth={20}
              strokeDasharray={`${dash} ${circumference - dash}`}
              strokeDashoffset={-offset}
            />
          );
          offset += dash;
          return el;
        })}
        <text x={80} y={80} textAnchor="middle" dy="0.35em" transform="rotate(90 80 80)"
              fontSize="20" fontWeight="800" fill="currentColor">{total}</text>
      </svg>
      <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
        {entries.map(([k, v]) => (
          <li key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
            <span style={{
              width: 10, height: 10, borderRadius: 999,
              background: colors[k] || '#999', flexShrink: 0,
            }} />
            <span style={{ flex: 1, textTransform: 'capitalize' }}>{k.replace('_', ' ')}</span>
            <strong>{v}</strong>
            <span style={{ color: 'var(--aq-text-muted)', fontSize: 11 }}>
              {Math.round((v / total) * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Horizontal bar list (most active) ───────────────────────────────────────
function BarList({
  rows, suffix,
}: {
  rows: { label: string; sub?: string; value: number; onClick?: () => void }[];
  suffix: (v: number) => string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
      {rows.map((r, i) => (
        <li key={i}>
          <button
            type="button"
            onClick={r.onClick}
            style={{
              width: '100%', textAlign: 'left',
              border: 'none', background: 'transparent', padding: 0,
              cursor: r.onClick ? 'pointer' : 'default',
              fontFamily: 'inherit',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{r.label}</span>
              <span style={{ fontSize: 12, color: 'var(--aq-text-muted)' }}>{suffix(r.value)}</span>
            </div>
            {r.sub && (
              <div style={{ fontSize: 11, color: 'var(--aq-text-muted)', marginBottom: 4 }}>{r.sub}</div>
            )}
            <div style={{ height: 6, background: 'var(--aq-bg-sunken)', borderRadius: 999, overflow: 'hidden' }}>
              <div style={{
                width: `${(r.value / max) * 100}%`,
                height: '100%',
                background: 'var(--aq-accent)',
                borderRadius: 999,
              }} />
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

const dormantRowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10,
  width: '100%', textAlign: 'left',
  background: 'var(--aq-bg-sunken)',
  border: 'none', padding: '10px 12px',
  borderRadius: 'var(--aq-radius)',
  cursor: 'pointer',
  fontFamily: 'inherit',
};

function kindIcon(kind: string) {
  const m: Record<string, string> = {
    note: '📝', call: '📞', meeting: '🤝', email: '✉️', status_change: '⚑',
  };
  return m[kind] || '•';
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
