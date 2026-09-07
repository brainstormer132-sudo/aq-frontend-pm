'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  useClients, useLegacyVendors, useCrmRecentActivities, useCrmActivityIndex,
  type CrmActivity, type ClientRow, type LegacyVendor,
} from '@/hooks/use-workflow';
import {
  lastContactIndex, countsSince, kindCountsSince, countSince,
  dormantContacts, dormantSummary, mostActive,
  scopeContacts, scopeActivities, timeAgo, DAY_MS,
} from '@/lib/crm';

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

  // Two reads, deliberately different shapes.
  //
  //   index — every activity in the workspace, four columns wide, paged. All
  //           the arithmetic on this page comes from here.
  //   feed  — the newest 25 WITH their bodies, for the list at the bottom.
  //
  // It used to be one read of the 500 most recent rows, used for both. That is
  // fine for a feed and wrong for the maths: a contact whose newest note fell
  // past row 500 came back with no last-contact date at all, which this page
  // read as *never contacted* — and never sorts first, so the accounts we
  // speak to most often were being listed as the ones nobody had called.
  const { items: index, loading } = useCrmActivityIndex(workspaceId);
  const { items: feed, loading: loadingFeed } = useCrmRecentActivities(workspaceId, 25);

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
  const scopedContacts = useMemo(() => scopeContacts(contacts, q), [contacts, q]);
  const scopedIndex = useMemo(
    () => scopeActivities(index, scopedContacts, q),
    [index, scopedContacts, q],
  );
  const scopedFeed = useMemo(
    () => scopeActivities(feed, scopedContacts, q),
    [feed, scopedContacts, q],
  );

  // The clock is read after mount, never during render: the server does not
  // know what day it is where you are. It was `const now = Date.now()` in the
  // render body, which also meant every window below it was a new number on
  // every render, so none of these useMemos memoised anything.
  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => { setNowMs(Date.now()); }, []);

  const activeWindow  = (nowMs ?? 0) - ACTIVE_WINDOW_DAYS * DAY_MS;

  const lastByContact = useMemo(() => lastContactIndex(scopedIndex), [scopedIndex]);
  const countByContact = useMemo(
    () => (nowMs ? countsSince(scopedIndex, activeWindow) : new Map<string, number>()),
    [scopedIndex, activeWindow, nowMs],
  );
  const byKind = useMemo(
    () => (nowMs ? kindCountsSince(scopedIndex, activeWindow) : {}),
    [scopedIndex, activeWindow, nowMs],
  );
  const topContacts = useMemo(
    () => mostActive(scopedContacts, countByContact, 6),
    [scopedContacts, countByContact],
  );

  // The whole dormant list, and the six shown beside it. Kept apart on
  // purpose: the stat card used to read `dormant.length` on a list that had
  // already been sliced to six, so a workspace with forty cold contacts
  // reported six.
  const dormantAll = useMemo(
    () => (nowMs
      ? dormantContacts({
          contacts: scopedContacts, last: lastByContact,
          nowMs, afterDays: DORMANT_AFTER_DAYS,
        })
      : []),
    [scopedContacts, lastByContact, nowMs],
  );
  const dormant = useMemo(() => dormantAll.slice(0, 6), [dormantAll]);
  const dormantLine = useMemo(
    () => dormantSummary(dormantAll, DORMANT_AFTER_DAYS),
    [dormantAll],
  );

  // Stats numbers
  const totalClients = scopedContacts.filter((c) => c.type === 'client').length;
  const totalVendors = scopedContacts.filter((c) => c.type === 'vendor').length;
  const totalRecent  = nowMs ? countSince(scopedIndex, activeWindow) : 0;
  const totalDormant = dormantAll.length;

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
          {loading || !nowMs ? (
            <p style={{ color: 'var(--aq-text-muted)', fontSize: 13 }}>Loading…</p>
          ) : topContacts.length === 0 ? (
            <p style={{ color: 'var(--aq-text-muted)', fontSize: 13 }}>
              No activity in this window yet. Log a call or note on a contact to start tracking.
            </p>
          ) : (
            <BarList
              rows={topContacts.map((r) => ({
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
              {loading || !nowMs
                ? `No activity in the last ${DORMANT_AFTER_DAYS} days. These need a check-in.`
                : dormantLine.label}
              {totalDormant > dormant.length && ` — showing the ${dormant.length} quietest.`}
            </p>
          </header>
          {loading || !nowMs ? (
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
                    <span
                      className={`aq-badge ${r.state === 'never' ? 'aq-badge-muted' : 'aq-badge-warning'}`}
                      style={{ fontSize: 11 }}
                    >{r.label}</span>
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
          {loadingFeed ? (
            <p style={{ color: 'var(--aq-text-muted)', fontSize: 13 }}>Loading…</p>
          ) : scopedFeed.length === 0 ? (
            <p style={{ color: 'var(--aq-text-muted)', fontSize: 13 }}>
              No activity yet for this scope.
            </p>
          ) : (
            <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {scopedFeed.slice(0, 10).map((a) => {
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
                        {timeAgo(a.occurred_at, nowMs ?? 0)}
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

