'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  useNotifications, markNotificationRead, markAllNotificationsRead,
} from '@/hooks/use-workflow';
import {
  INBOX_KINDS, classify, kindMeta, countByKind, totalCount, filterInbox,
  taskIdOf, relativeTime, emptyMessage,
  type InboxKind, type InboxRow,
} from '@/lib/inbox';
import { SkeletonRows, SkeletonLine } from '@/components/Skeleton';

/**
 * Inbox — the triage rail.
 *
 * Rebuilt Aug 2026, second screen of the UI pass. It was one flat list where
 * every row was the same size, unread rows were washed in green, and the
 * kind was printed raw — a row could read `contract_request_status_changed`.
 * There was nothing to do from the list except open the task.
 *
 * Now: kinds down the left with their counts, so approving contracts is a
 * different sitting from answering somebody who tagged you; the list on the
 * right stays calm, and each row can be dealt with where it is.
 *
 * The kind is worked out from the title — the database does not store one,
 * every trigger writes the same `type`. That logic, and the whole cast of
 * real trigger phrases, lives in lib/inbox.ts with tests.
 *
 * Two rules carried over from the Dashboard:
 *   • Unread is a dot and weight, never a colour wash. Colour stays free to
 *     mean urgent.
 *   • The clock is read after mount, never during render.
 */
export function InboxView({ onOpenTask }: { onOpenTask: (taskId: string) => void }) {
  const { items, unreadCount, refetch, loading } = useNotifications({ pollMs: 20_000 });

  const [kind, setKind] = useState<InboxKind | null>(null);
  const [query, setQuery] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);

  // Ticks every half minute so "18m ago" does not sit there saying 18m for
  // an hour. Set after mount: the server has no clock the client agrees with.
  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => {
    setNowMs(Date.now());
    const t = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const rows = items as InboxRow[];
  const counts = useMemo(() => countByKind(rows), [rows]);
  const all = useMemo(() => totalCount(rows), [rows]);
  const filter = { kind, query, unreadOnly };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const shown = useMemo(() => filterInbox(rows, filter), [rows, kind, query, unreadOnly]);

  const open = async (n: InboxRow) => {
    const taskId = taskIdOf(n);
    if (!n.read) { try { await markNotificationRead(n.id); } catch { /* keep going */ } }
    if (taskId) onOpenTask(taskId);
    refetch();
  };

  const markRead = async (n: InboxRow) => {
    setBusyId(n.id);
    try { await markNotificationRead(n.id); await refetch(); }
    catch { /* it stays unread, which is the safe way to be wrong */ }
    finally { setBusyId(null); }
  };

  const markAll = async () => {
    setMarkingAll(true);
    try { await markAllNotificationsRead(); await refetch(); }
    finally { setMarkingAll(false); }
  };

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: 20, fontWeight: 700 }}>Inbox</h2>
        <span style={{ fontSize: 13, color: 'var(--aq-text-muted)' }}>
          {loading && !rows.length
            ? 'Loading…'
            : unreadCount > 0
              ? `${unreadCount} unread of ${all.total}`
              : `${all.total} — all read`}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            type="button"
            className="aq-btn aq-btn-ghost"
            onClick={() => setUnreadOnly((v) => !v)}
            aria-pressed={unreadOnly}
            style={{
              fontSize: 12.5, padding: '6px 12px',
              color: unreadOnly ? 'var(--aq-text)' : 'var(--aq-text-secondary)',
              background: unreadOnly ? 'var(--aq-bg-sunken)' : 'transparent',
            }}
          >Unread only</button>
          {unreadCount > 0 && (
            <button
              type="button"
              className="aq-btn aq-btn-secondary"
              onClick={markAll}
              disabled={markingAll}
              style={{ fontSize: 12.5, padding: '6px 12px' }}
            >{markingAll ? 'Marking…' : 'Mark all read'}</button>
          )}
        </div>
      </header>

      <div style={{
        display: 'grid', gridTemplateColumns: 'minmax(0, 216px) minmax(0, 1fr)',
        gap: 16, alignItems: 'start',
      }}>
        {/* ── The rail ─────────────────────────────────────────────
            Counts live here so the list itself does not have to shout.
            A kind with nothing in it stays listed, greyed: an entry that
            vanishes when it empties makes the rail jump under the cursor
            every time somebody reads something. */}
        <nav
          className="aq-card"
          style={{ padding: 6, display: 'flex', flexDirection: 'column', gap: 1 }}
          aria-label="Filter by kind"
        >
          <RailItem label="All" count={all} on={kind === null} onClick={() => setKind(null)} />
          <div style={{ height: 1, background: 'var(--aq-border-light)', margin: '5px 8px' }} />
          {INBOX_KINDS.map((k) => (
            <RailItem
              key={k.key}
              label={k.label}
              count={counts[k.key]}
              on={kind === k.key}
              onClick={() => setKind(kind === k.key ? null : k.key)}
            />
          ))}
        </nav>

        <div>
          <input
            className="aq-input"
            placeholder="Search mentions, task names, anyone who tagged you…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ marginBottom: 10 }}
          />

          {loading && rows.length === 0 ? (
            <SkeletonRows rows={5} height={62} gap={0} label="Loading your inbox" />
          ) : shown.length === 0 ? (
            <div className="aq-card" style={{
              padding: 30, textAlign: 'center', color: 'var(--aq-text-muted)', fontSize: 13.5,
            }}>
              {emptyMessage(filter, all.total)}
            </div>
          ) : (
            <div className="aq-card" style={{ overflow: 'hidden' }}>
              <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column' }}>
                {shown.map((n, i) => (
                  <li key={n.id}>
                    <Row
                      row={n}
                      first={i === 0}
                      nowMs={nowMs}
                      busy={busyId === n.id}
                      onOpen={() => open(n)}
                      onMarkRead={() => markRead(n)}
                    />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function RailItem({
  label, count, on, onClick,
}: {
  label: string;
  count: { total: number; unread: number };
  on: boolean;
  onClick: () => void;
}) {
  const empty = count.total === 0;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, width: '100%',
        padding: '7px 11px', borderRadius: 'var(--aq-radius)',
        border: 'none', background: on ? 'var(--aq-bg-sunken)' : 'transparent',
        font: 'inherit', fontSize: 13, fontWeight: on ? 600 : 400,
        color: empty && !on ? 'var(--aq-text-muted)' : 'var(--aq-text)',
        textAlign: 'left', cursor: 'pointer',
      }}
    >
      <span style={{
        flex: 1, minWidth: 0, overflow: 'hidden',
        textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{label}</span>
      {/* Unread is the number worth seeing; the total is the quiet one. */}
      {count.unread > 0 && (
        <span style={{
          fontSize: 11, fontWeight: 700, color: 'var(--aq-accent)',
          fontVariantNumeric: 'tabular-nums',
        }}>{count.unread}</span>
      )}
      <span style={{
        fontSize: 11.5, color: 'var(--aq-text-muted)',
        fontVariantNumeric: 'tabular-nums', minWidth: 18, textAlign: 'right',
      }}>{count.total}</span>
    </button>
  );
}

function Row({
  row, first, nowMs, busy, onOpen, onMarkRead,
}: {
  row: InboxRow;
  first: boolean;
  nowMs: number | null;
  busy: boolean;
  onOpen: () => void;
  onMarkRead: () => void;
}) {
  const meta = kindMeta(classify(row));
  const unread = !row.read;
  const opens = taskIdOf(row) != null;

  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 12,
      padding: '12px 14px',
      borderTop: first ? 'none' : '1px solid var(--aq-border-light)',
      opacity: busy ? 0.55 : 1,
    }}>
      {/* A dot, not a green wash across the whole row. */}
      <span
        aria-hidden
        style={{
          width: 7, height: 7, borderRadius: '50%', marginTop: 7, flexShrink: 0,
          background: unread ? 'var(--aq-accent)' : 'transparent',
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 13.5, fontWeight: unread ? 600 : 500,
          color: unread ? 'var(--aq-text)' : 'var(--aq-text-secondary)',
        }}>
          {row.title}
          {unread && <span style={SR_ONLY}> (unread)</span>}
        </div>
        {row.body && (
          <div style={{ fontSize: 12, color: 'var(--aq-text-muted)', marginTop: 2 }}>
            {row.body}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        {/* The kind, in English. This is where the raw column name used to
            be printed straight onto the screen. */}
        <span className="aq-badge aq-badge-muted" style={{ fontSize: 10.5 }}>{meta.pill}</span>
        <span style={{
          fontSize: 11, color: 'var(--aq-text-muted)', whiteSpace: 'nowrap',
          minWidth: 62, textAlign: 'right',
        }}>
          {nowMs == null
            ? <SkeletonLine width={44} height={9} />
            : relativeTime(row.created_at, nowMs)}
        </span>
        {opens && (
          <button
            type="button"
            className="aq-btn aq-btn-secondary"
            onClick={onOpen}
            disabled={busy}
            style={{ fontSize: 12, padding: '4px 11px' }}
          >Open</button>
        )}
        {/* Dealing with a row without leaving the list is the point of the
            rail. Gone once it is read, rather than disabled — a dead button
            is still a thing to read and decide about. */}
        {unread && (
          <button
            type="button"
            className="aq-btn aq-btn-ghost"
            onClick={onMarkRead}
            disabled={busy}
            style={{ fontSize: 12, padding: '4px 8px', color: 'var(--aq-text-secondary)' }}
          >Mark read</button>
        )}
      </div>
    </div>
  );
}

const SR_ONLY: React.CSSProperties = {
  position: 'absolute', width: 1, height: 1, padding: 0, margin: -1,
  overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
};
