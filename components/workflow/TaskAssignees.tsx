'use client';

import { useState } from 'react';
import {
  useTaskMembers, addTaskMember, removeTaskMember,
  type Profile, type WorkspaceRole,
} from '@/hooks/use-workflow';

/**
 * Section embedded in TaskDetailPanel that shows + manages
 * `task_members` for this task.
 */
export function TaskAssignees({
  taskId, currentUserId, role, profiles, canEdit,
}: {
  taskId: string;
  currentUserId: string;
  role: WorkspaceRole | null;
  profiles: (Profile & { role: WorkspaceRole })[];
  canEdit: boolean;
}) {
  const { members, refetch } = useTaskMembers(taskId);
  const [pickId, setPickId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const assignedIds = new Set(members.map((m) => m.user_id));
  const choices = profiles.filter((p) => !assignedIds.has(p.id));

  const handleAdd = async () => {
    if (!pickId) return;
    setBusy(true); setError('');
    try {
      await addTaskMember(taskId, pickId, currentUserId, 'collaborator');
      setPickId('');
      await refetch();
    } catch (e: any) { setError(e?.message ?? String(e)); }
    finally { setBusy(false); }
  };

  const handleRemove = async (id: string) => {
    setBusy(true); setError('');
    try { await removeTaskMember(id); await refetch(); }
    catch (e: any) { setError(e?.message ?? String(e)); }
    finally { setBusy(false); }
  };

  return (
    <section className="aq-card" style={{ padding: 18 }}>
      <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>
        Assigned ({members.length})
      </h3>

      {error && <div className="aq-badge aq-badge-error" style={{ marginBottom: 10 }}>{error}</div>}

      {members.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--aq-text-muted)' }}>
          No one assigned yet.
        </p>
      ) : (
        <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6, marginBottom: canEdit ? 12 : 0 }}>
          {members.map((m) => (
            <li key={m.id} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '8px 12px', borderRadius: 'var(--aq-radius)',
              background: 'var(--aq-bg-sunken)',
            }}>
              <div>
                <strong style={{ fontSize: 13 }}>{m.user?.full_name ?? '(no profile)'}</strong>
                <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--aq-text-muted)' }}>
                  {m.role === 'key_account' ? 'Key account' : m.role}
                </span>
              </div>
              {canEdit && (
                <button
                  type="button"
                  className="aq-btn aq-btn-ghost"
                  disabled={busy}
                  onClick={() => handleRemove(m.id)}
                  style={{ padding: '2px 8px', fontSize: 12 }}
                  aria-label="Remove member"
                >Remove</button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <div style={{ display: 'flex', gap: 8 }}>
          <select
            className="aq-select"
            value={pickId}
            onChange={(e) => setPickId(e.target.value)}
          >
            <option value="">— Add a teammate —</option>
            {choices.map((p) => (
              <option key={p.id} value={p.id}>{p.full_name} ({p.role === 'key_account' ? 'Key account' : p.role})</option>
            ))}
          </select>
          <button
            type="button"
            className="aq-btn aq-btn-secondary"
            onClick={handleAdd}
            disabled={busy || !pickId}
          >Add</button>
        </div>
      )}
    </section>
  );
}
