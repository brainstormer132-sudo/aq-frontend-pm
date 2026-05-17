'use client';

import { useMemo, useState } from 'react';
import {
  useNotifications, markNotificationRead, markAllNotificationsRead,
  type AppNotification,
} from '@/hooks/use-workflow';

/**
 * Searchable Inbox view — replaces the old topbar notification bell.
 *
 * Lists every notification the current user has (mentions in comments,
 * task assignments, contract-request status changes, etc.). Polls every
 * 20 seconds. Clicking a row marks it read and opens the related task
 * in the side panel.
 */
export function InboxView({ onOpenTask }: { onOpenTask: (taskId: string) => void }) {
  const { items, unreadCount, refetch, loading } = useNotifications({ pollMs: 20_000 });
  const [query, setQuery] = useState('');
  const [showRead, setShowRead] = useState(true);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((n) => {
      if (!showRead && n.read) return false;
      if (!q) return true;
      return [n.title, n.body, n.type, n.link].some(
        (v) => String(v || '').toLowerCase().includes(q),
      );
    });
  }, [items, query, showRead]);

  const click = async (n: AppNotification) => {
    try {
      if (!n.read) await markNotificationRead(n.id);
      const m = n.link?.match(/task=([0-9a-f-]+)/i);
      if (m) onOpenTask(m[1]);
      refetch();
    } catch { /* swallow */ }
  };

  const allRead = async () => { await markAllNotificationsRead(); refetch(); };

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="aq-card" style={{
        padding: 16,
        display: 'grid',
        gridTemplateColumns: '2fr auto auto auto',
        gap: 10,
        alignItems: 'center',
      }}>
        <input
          className="aq-input"
          placeholder="Search your inbox — mentions, task names, anyone who tagged you…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <label style={{
          display: 'flex', gap: 6, alignItems: 'center',
          fontSize: 13, color: 'var(--aq-text-muted)', userSelect: 'none', cursor: 'pointer',
        }}>
          <input
            type="checkbox"
            checked={showRead}
            onChange={(e) => setShowRead(e.target.checked)}
          />
          Show read
        </label>
        <span className="aq-badge aq-badge-muted">
          {filtered.length} of {items.length}{unreadCount > 0 ? ` · ${unreadCount} unread` : ''}
        </span>
        {unreadCount > 0 && (
          <button
            type="button"
            className="aq-btn aq-btn-secondary"
            onClick={allRead}
            style={{ fontSize: 12, padding: '6px 12px' }}
          >Mark all read</button>
        )}
      </div>

      {loading && items.length === 0 ? (
        <div className="aq-card" style={{ padding: 32, textAlign: 'center', color: 'var(--aq-text-muted)' }}>
          Loading inbox…
        </div>
      ) : filtered.length === 0 ? (
        <div className="aq-card" style={{ padding: 32, textAlign: 'center', color: 'var(--aq-text-muted)' }}>
          {items.length === 0
            ? "You're all caught up. New mentions and assignments will land here."
            : 'Nothing matches that search.'}
        </div>
      ) : (
        <div className="aq-card" style={{ padding: 0, overflow: 'hidden' }}>
          <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column' }}>
            {filtered.map((n) => (
              <li key={n.id} style={{ borderBottom: '1px solid var(--aq-border-light)' }}>
                <button
                  type="button"
                  onClick={() => click(n)}
                  style={{
                    width: '100%', textAlign: 'left',
                    padding: '14px 18px',
                    background: n.read ? 'transparent' : 'var(--aq-accent-light)',
                    border: 'none', cursor: 'pointer',
                    fontFamily: 'inherit',
                    display: 'flex', flexDirection: 'column', gap: 4,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
                    <strong style={{ fontSize: 14 }}>
                      {!n.read && (
                        <span aria-hidden style={{
                          display: 'inline-block', width: 8, height: 8, borderRadius: 999,
                          background: 'var(--aq-accent)', marginRight: 8, verticalAlign: 'middle',
                        }} />
                      )}
                      {n.title}
                    </strong>
                    <span style={{ fontSize: 11, color: 'var(--aq-text-muted)', whiteSpace: 'nowrap' }}>
                      {timeAgo(n.created_at)}
                    </span>
                  </div>
                  {n.body && (
                    <span style={{ fontSize: 13, color: 'var(--aq-text-secondary)' }}>{n.body}</span>
                  )}
                  {n.type && (
                    <span style={{ fontSize: 11, color: 'var(--aq-text-muted)' }}>{n.type}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
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
