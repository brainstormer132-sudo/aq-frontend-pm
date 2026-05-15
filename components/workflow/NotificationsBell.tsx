'use client';

import { useEffect, useRef, useState } from 'react';
import {
  useNotifications, markNotificationRead, markAllNotificationsRead,
  type AppNotification,
} from '@/hooks/use-workflow';

/**
 * Bell icon in the topbar with an unread count and a popover panel.
 * Polls every 20s. Click a notification → marks it read and (if it carries
 * a /dashboard?task=... link) opens that task in the panel via onOpenTask.
 */
export function NotificationsBell({ onOpenTask }: { onOpenTask: (taskId: string) => void }) {
  const { items, unreadCount, refetch } = useNotifications({ pollMs: 20_000 });
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  // Click outside closes.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const click = async (n: AppNotification) => {
    try {
      if (!n.read) await markNotificationRead(n.id);
      // links look like "/dashboard/workflow?task=<uuid>" or older "/dashboard?task=<uuid>"
      const m = n.link?.match(/task=([0-9a-f-]+)/i);
      if (m) onOpenTask(m[1]);
      setOpen(false);
      refetch();
    } catch (e) { /* swallow */ }
  };

  const allRead = async () => { await markAllNotificationsRead(); refetch(); };

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="aq-btn aq-btn-ghost"
        aria-label="Notifications"
        style={{ padding: '8px 12px', position: 'relative' }}
      >
        <span aria-hidden style={{ fontSize: 18 }}>🔔</span>
        {unreadCount > 0 && (
          <span style={{
            position: 'absolute', top: 4, right: 6,
            background: 'var(--aq-error)', color: '#fff',
            minWidth: 16, height: 16, borderRadius: 999,
            fontSize: 10, fontWeight: 800,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            padding: '0 4px',
          }}>{unreadCount > 99 ? '99+' : unreadCount}</span>
        )}
      </button>

      {open && (
        <div
          className="aq-card animate-fade-in"
          role="menu"
          style={{
            position: 'absolute', right: 0, top: 'calc(100% + 8px)',
            width: 380, maxHeight: 480, overflow: 'auto',
            background: 'var(--aq-bg-elevated)',
            zIndex: 60,
          }}
        >
          <header style={{
            padding: '12px 16px', display: 'flex',
            justifyContent: 'space-between', alignItems: 'center',
            borderBottom: '1px solid var(--aq-border-light)',
            position: 'sticky', top: 0, background: 'var(--aq-bg-elevated)',
          }}>
            <strong style={{ fontSize: 14 }}>Notifications</strong>
            {unreadCount > 0 && (
              <button type="button" onClick={allRead} className="aq-btn aq-btn-ghost"
                      style={{ padding: '4px 10px', fontSize: 12 }}>
                Mark all read
              </button>
            )}
          </header>
          {items.length === 0 ? (
            <p style={{ padding: 24, fontSize: 13, color: 'var(--aq-text-muted)', textAlign: 'center' }}>
              You're all caught up.
            </p>
          ) : (
            <ul style={{ listStyle: 'none' }}>
              {items.map((n) => (
                <li key={n.id} style={{ borderBottom: '1px solid var(--aq-border-light)' }}>
                  <button
                    type="button"
                    onClick={() => click(n)}
                    style={{
                      width: '100%', textAlign: 'left',
                      padding: '10px 14px',
                      background: n.read ? 'transparent' : 'var(--aq-accent-light)',
                      border: 'none', cursor: 'pointer',
                      fontFamily: 'inherit',
                      display: 'flex', flexDirection: 'column', gap: 2,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                      <strong style={{ fontSize: 13 }}>{n.title}</strong>
                      <span style={{ fontSize: 10, color: 'var(--aq-text-muted)' }}>
                        {timeAgo(n.created_at)}
                      </span>
                    </div>
                    {n.body && (
                      <span style={{ fontSize: 12, color: 'var(--aq-text-secondary)' }}>{n.body}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
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
