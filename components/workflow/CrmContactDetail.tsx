'use client';

import { useState } from 'react';
import {
  useCrmActivities, addCrmActivity, deleteCrmActivity,
  type CrmActivityKind,
} from '@/hooks/use-workflow';
import { KindIcon, type CrmContact } from './CrmView';

/**
 * Right-hand detail panel for the CRM.
 * Shows: profile snapshot (name, ids, contact info passed in) +
 * activity timeline (fetched live) + add-activity form.
 */
export function CrmContactDetail({
  contact, workspaceId, currentUserId, currentUserName, onChanged, onClose,
}: {
  contact: CrmContact;
  workspaceId: string;
  currentUserId: string;
  currentUserName: string;
  onChanged?: () => void;
  onClose?: () => void;
}) {
  const { items, refetch, loading } = useCrmActivities(workspaceId, contact.type, contact.id);

  const [kind, setKind] = useState<CrmActivityKind>('note');
  const [body, setBody] = useState('');
  const [occurredAt, setOccurredAt] = useState<string>(toInputValue(new Date()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!body.trim()) {
      setError('Type something before logging the activity.');
      return;
    }
    setBusy(true); setError('');
    try {
      await addCrmActivity({
        workspace_id: workspaceId,
        target_type: contact.type,
        target_id: contact.id,
        kind,
        body: body.trim(),
        author_id: currentUserId,
        author_name: currentUserName,
        occurred_at: new Date(occurredAt).toISOString(),
      });
      setBody('');
      setOccurredAt(toInputValue(new Date()));
      await refetch();
      onChanged?.();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this activity?')) return;
    try {
      await deleteCrmActivity(id);
      await refetch();
      onChanged?.();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Profile snapshot */}
      <section className="aq-card" style={{ padding: 22 }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
              <span className="aq-badge aq-badge-muted" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                {contact.type}
              </span>
              {items.length > 0 && (
                <span style={{ fontSize: 11, color: 'var(--aq-text-muted)' }}>
                  last activity {timeAgo(items[0].occurred_at)}
                </span>
              )}
            </div>
            <h2 style={{ fontSize: 22, fontWeight: 800 }}>{contact.name}</h2>
            <p style={{ fontSize: 13, color: 'var(--aq-text-muted)', marginTop: 4 }}>
              {contact.subtitle}{contact.meta ? ` · ${contact.meta}` : ''}
            </p>
          </div>
          {onClose && (
            <button
              type="button"
              className="aq-btn aq-btn-ghost"
              onClick={onClose}
              aria-label="Back to recent"
              style={{ fontSize: 12 }}
            >← Back</button>
          )}
        </header>
      </section>

      {/* Add activity form */}
      <section className="aq-card" style={{ padding: 22 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Log an activity</h3>
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 10 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, fontWeight: 600, color: 'var(--aq-text-muted)' }}>
              Type
              <select
                className="aq-select"
                value={kind}
                onChange={(e) => setKind(e.target.value as CrmActivityKind)}
              >
                <option value="note">📝 Note</option>
                <option value="call">📞 Call</option>
                <option value="meeting">🤝 Meeting</option>
                <option value="email">✉️ Email</option>
                <option value="status_change">⚑ Status change</option>
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, fontWeight: 600, color: 'var(--aq-text-muted)' }}>
              When
              <input
                className="aq-input"
                type="datetime-local"
                value={occurredAt}
                onChange={(e) => setOccurredAt(e.target.value)}
              />
            </label>
          </div>
          <textarea
            className="aq-textarea"
            rows={3}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="What happened? Decisions, next steps, anything the team should know."
            required
          />
          {error && (
            <div style={{ background: 'var(--aq-error)', color: '#fff', padding: '8px 12px', borderRadius: 'var(--aq-radius)', fontSize: 13 }}>
              {error}
            </div>
          )}
          <button
            type="submit"
            className="aq-btn aq-btn-primary"
            disabled={busy || !body.trim()}
            style={{ alignSelf: 'flex-start' }}
          >{busy ? 'Logging…' : 'Log activity'}</button>
        </form>
      </section>

      {/* Timeline */}
      <section className="aq-card" style={{ padding: 22 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>
          Timeline ({items.length})
        </h3>
        {loading ? (
          <p style={{ color: 'var(--aq-text-muted)', fontSize: 13 }}>Loading…</p>
        ) : items.length === 0 ? (
          <p style={{ color: 'var(--aq-text-muted)', fontSize: 13 }}>
            Nothing logged yet for this {contact.type}. Use the form above to add the first one.
          </p>
        ) : (
          <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {items.map((a) => {
              const canDelete = a.author_id === currentUserId;
              return (
                <li key={a.id} style={{
                  padding: '10px 14px',
                  borderRadius: 'var(--aq-radius)',
                  background: 'var(--aq-bg-sunken)',
                  display: 'flex', flexDirection: 'column', gap: 4,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                    <strong style={{ fontSize: 13 }}>
                      <KindIcon kind={a.kind} />
                      {a.author_name || 'Someone'}
                    </strong>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <span style={{ fontSize: 11, color: 'var(--aq-text-muted)' }}>
                        {new Date(a.occurred_at).toLocaleString()}
                      </span>
                      {canDelete && (
                        <button
                          type="button"
                          className="aq-btn aq-btn-ghost"
                          onClick={() => handleDelete(a.id)}
                          style={{ padding: '2px 6px', fontSize: 11 }}
                          aria-label="Delete activity"
                        >✕</button>
                      )}
                    </div>
                  </div>
                  <p style={{ marginTop: 2, fontSize: 13, whiteSpace: 'pre-wrap' }}>{a.body}</p>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function toInputValue(d: Date): string {
  // datetime-local input wants "YYYY-MM-DDTHH:mm" in LOCAL time, no TZ suffix.
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
