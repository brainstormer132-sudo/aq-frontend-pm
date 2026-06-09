'use client';

/**
 * Admin screen for the two operations-workflow lookup tables added in
 * migration 028: task_sources (e.g. "AQ", "Inf.", "Referral") and
 * client_categories (e.g. "F&B", "Retail", "Beauty"). These show up as
 * dropdown options on every parent campaign in the task drawer.
 *
 * RLS allows read for any workspace member and write only for
 * owner/admin. We still gate the UI by role for clearer UX.
 */

import { useState } from 'react';
import {
  useTaskSources, useClientCategories,
  createTaskSource, updateTaskSource, deleteTaskSource,
  createClientCategory, updateClientCategory, deleteClientCategory,
  type TaskSource, type ClientCategory, type WorkspaceRole,
} from '@/hooks/use-workflow';

export function OperationsLookupsPanel({
  workspaceId, role,
}: {
  workspaceId: string;
  role: WorkspaceRole | null;
}) {
  const canEdit = role === 'owner' || role === 'admin';
  const { items: sources, refetch: refetchSources } = useTaskSources(workspaceId);
  const { items: categories, refetch: refetchCategories } = useClientCategories(workspaceId);

  if (!canEdit) {
    return null;  // hide entirely for non-admins; they don't need to see this card
  }

  return (
    <div className="aq-card" style={{ padding: 24 }}>
      <header style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700 }}>Operations lookups</h2>
        <p style={{ color: 'var(--aq-text-muted)', fontSize: 13, marginTop: 4 }}>
          Dropdown options for the Source and Client Category fields on every
          campaign. Add what your team actually uses; ordering controls how
          they appear in the picker.
        </p>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
        <LookupList
          title="Task sources"
          subtitle="Where does this work come from? AQ / Inf. / Referral …"
          items={sources}
          onCreate={async (name) => {
            const nextPos = (sources[sources.length - 1]?.position ?? 0) + 1;
            await createTaskSource(workspaceId, name, nextPos);
            await refetchSources();
          }}
          onRename={async (id, name) => {
            await updateTaskSource(id, { name });
            await refetchSources();
          }}
          onReorder={async (id, position) => {
            await updateTaskSource(id, { position });
            await refetchSources();
          }}
          onDelete={async (id) => {
            await deleteTaskSource(id);
            await refetchSources();
          }}
        />

        <LookupList
          title="Client categories"
          subtitle="What industry/segment is the client in? F&B / Retail / Beauty …"
          items={categories}
          onCreate={async (name) => {
            const nextPos = (categories[categories.length - 1]?.position ?? 0) + 1;
            await createClientCategory(workspaceId, name, nextPos);
            await refetchCategories();
          }}
          onRename={async (id, name) => {
            await updateClientCategory(id, { name });
            await refetchCategories();
          }}
          onReorder={async (id, position) => {
            await updateClientCategory(id, { position });
            await refetchCategories();
          }}
          onDelete={async (id) => {
            await deleteClientCategory(id);
            await refetchCategories();
          }}
        />
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   Shared list editor for both lookup tables. Add / rename inline /
   reorder via the up-down arrows / delete with confirm.
   ───────────────────────────────────────────────────────────────── */

interface LookupItem {
  id: string;
  name: string;
  position: number;
}

function LookupList<T extends LookupItem>({
  title, subtitle, items,
  onCreate, onRename, onReorder, onDelete,
}: {
  title: string;
  subtitle: string;
  items: T[];
  onCreate: (name: string) => Promise<void>;
  onRename: (id: string, name: string) => Promise<void>;
  onReorder: (id: string, position: number) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string>('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setCreating(true); setError('');
    try {
      await onCreate(name);
      setNewName('');
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setCreating(false);
    }
  };

  const startEditing = (item: T) => {
    setEditingId(item.id);
    setEditingDraft(item.name);
  };

  const saveEdit = async () => {
    if (!editingId) return;
    const name = editingDraft.trim();
    if (!name) { setEditingId(null); return; }
    try {
      await onRename(editingId, name);
      setEditingId(null);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  };

  const move = async (item: T, dir: -1 | 1) => {
    const idx = items.findIndex((x) => x.id === item.id);
    const swap = items[idx + dir];
    if (!swap) return;
    try {
      // Swap positions.
      await onReorder(item.id, swap.position);
      await onReorder(swap.id, item.position);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  };

  return (
    <div style={{
      border: '1px solid var(--aq-border-light)',
      borderRadius: 'var(--aq-radius)',
      padding: 16,
    }}>
      <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 2 }}>{title}</h3>
      <p style={{ fontSize: 11, color: 'var(--aq-text-muted)', marginBottom: 12 }}>{subtitle}</p>

      {error && (
        <div className="aq-badge aq-badge-error" style={{ marginBottom: 10 }}>{error}</div>
      )}

      {/* Add form */}
      <form onSubmit={handleAdd} style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input
          className="aq-input"
          style={{ flex: 1 }}
          placeholder={`Add a new ${title.replace(/s$/, '').toLowerCase()}…`}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          disabled={creating}
        />
        <button
          type="submit"
          className="aq-btn aq-btn-secondary"
          disabled={creating || !newName.trim()}
        >
          {creating ? 'Adding…' : 'Add'}
        </button>
      </form>

      {/* List */}
      {items.length === 0 ? (
        <p style={{ fontSize: 12, color: 'var(--aq-text-muted)' }}>
          No entries yet. Add the first one above.
        </p>
      ) : (
        <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {items.map((item, idx) => (
            <li
              key={item.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '8px 10px',
                borderRadius: 'var(--aq-radius-sm)',
                border: '1px solid var(--aq-border-light)',
              }}
            >
              <span style={{ fontSize: 11, color: 'var(--aq-text-muted)', width: 24 }}>
                {idx + 1}
              </span>

              {editingId === item.id ? (
                <input
                  className="aq-input"
                  style={{ flex: 1 }}
                  value={editingDraft}
                  onChange={(e) => setEditingDraft(e.target.value)}
                  onBlur={saveEdit}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); saveEdit(); }
                    if (e.key === 'Escape') setEditingId(null);
                  }}
                  autoFocus
                />
              ) : (
                <button
                  type="button"
                  onClick={() => startEditing(item)}
                  style={{
                    flex: 1, textAlign: 'left', fontSize: 13,
                    background: 'transparent', border: 'none', cursor: 'text',
                    color: 'var(--aq-text)', padding: 0,
                  }}
                >
                  {item.name}
                </button>
              )}

              <button
                type="button"
                className="aq-btn aq-btn-ghost"
                style={{ padding: '2px 8px', fontSize: 12 }}
                onClick={() => move(item, -1)}
                disabled={idx === 0}
                title="Move up"
              >↑</button>
              <button
                type="button"
                className="aq-btn aq-btn-ghost"
                style={{ padding: '2px 8px', fontSize: 12 }}
                onClick={() => move(item, 1)}
                disabled={idx === items.length - 1}
                title="Move down"
              >↓</button>
              {confirmDeleteId === item.id ? (
                <>
                  <button
                    type="button"
                    className="aq-btn aq-btn-danger"
                    style={{ padding: '2px 8px', fontSize: 11 }}
                    onClick={async () => {
                      try {
                        await onDelete(item.id);
                      } catch (e: any) {
                        setError(e?.message ?? String(e));
                      } finally {
                        setConfirmDeleteId(null);
                      }
                    }}
                  >Confirm</button>
                  <button
                    type="button"
                    className="aq-btn aq-btn-ghost"
                    style={{ padding: '2px 8px', fontSize: 11 }}
                    onClick={() => setConfirmDeleteId(null)}
                  >Cancel</button>
                </>
              ) : (
                <button
                  type="button"
                  className="aq-btn aq-btn-ghost"
                  style={{ padding: '2px 8px', fontSize: 12, color: 'var(--aq-error)' }}
                  onClick={() => setConfirmDeleteId(item.id)}
                  title="Delete"
                >×</button>
              )}
            </li>
          ))}
        </ul>
      )}

      <p style={{ marginTop: 12, fontSize: 11, color: 'var(--aq-text-muted)' }}>
        Tip: click an entry to rename it. Tasks already using a deleted entry
        will keep their value but it won't appear in the picker anymore.
      </p>
    </div>
  );
}
