'use client';

import { useState } from 'react';
import { useLegalPlaceholders } from '@/hooks/use-legal';
import { validatePlaceholderKey, type Placeholder } from '@/lib/legal';
import { ManagedListsModal } from '@/components/workflow/legal/ManagedListsModal';

/**
 * The workspace's merge-field registry, shown beside the block editor. Fields
 * are the {{ placeholders }} the wording may reference; they are filled per
 * contract at generation time. Clicking a field inserts {{ key }} at the caret
 * of the block being edited. Keys used in the wording but not registered are
 * surfaced here so a typo can be caught (or the field added) before publish.
 */
export function FieldsPanel({
  reg, usedKeys, editable, onInsert, workspaceId,
}: {
  reg: ReturnType<typeof useLegalPlaceholders>;
  usedKeys: string[];
  editable: boolean;
  onInsert: (key: string) => void;
  workspaceId?: string;
}) {
  const registeredKeys = reg.placeholders.map((p) => p.key);
  const unknown = usedKeys.filter((k) => !registeredKeys.includes(k));

  const [key, setKey] = useState('');
  const [label, setLabel] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [listsOpen, setListsOpen] = useState(false);

  const add = async (k: string, l: string) => {
    const v = validatePlaceholderKey(k);
    if (v) { setErr(v); return; }
    if (registeredKeys.includes(k.trim())) { setErr('That field already exists.'); return; }
    setBusy(true); setErr('');
    try { await reg.create(k, l || k); setKey(''); setLabel(''); }
    catch (e: any) { setErr(e?.message ?? 'Could not add the field.'); }
    finally { setBusy(false); }
  };

  return (
    <aside className="aq-card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ flex: 1, fontSize: 13, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
          color: 'var(--aq-text-muted)' }}>Fields</div>
        <button className="aq-btn aq-btn-ghost" style={{ padding: '4px 8px', fontSize: 12 }}
          onClick={() => setListsOpen(true)} title="Manage the dropdown lists fields can draw from">Manage lists</button>
      </div>
      {listsOpen && <ManagedListsModal workspaceId={workspaceId} onClose={() => setListsOpen(false)} />}

      {unknown.length > 0 && (
        <div className="aq-badge aq-badge-warning" style={{ display: 'block', padding: 10, fontSize: 12 }}>
          <div style={{ marginBottom: 6 }}>Used in the wording but not defined:</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {unknown.map((k) => (
              <button key={k} className="aq-btn aq-btn-ghost" disabled={busy} onClick={() => add(k, k)}
                style={{ padding: '2px 8px', fontSize: 12 }} title="Add this field to the registry">
                + {`{{ ${k} }}`}
              </button>
            ))}
          </div>
        </div>
      )}

      {reg.error && <div className="aq-badge aq-badge-error" style={{ display: 'block', padding: 8 }}>{reg.error}</div>}

      {reg.loading ? (
        <div style={{ fontSize: 13, color: 'var(--aq-text-muted)' }}>{'Loading fields\u2026'}</div>
      ) : reg.placeholders.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--aq-text-muted)' }}>
          No fields yet. Add the ones your contracts fill in - a name, an amount, an IBAN.
        </div>
      ) : (
        <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {reg.placeholders.map((p) => (
            <FieldRow key={p.id} p={p} used={usedKeys.includes(p.key)} editable={editable}
              onInsert={() => onInsert(p.key)}
              onSave={(k, l) => reg.update(p.id, { key: k, label: l })}
              onDelete={() => reg.remove(p.id)} />
          ))}
        </ul>
      )}

      <div style={{ borderTop: '1px solid var(--aq-border-light)', paddingTop: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--aq-text-muted)', marginBottom: 6 }}>New field</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <input className="aq-input" value={key} onChange={(e) => setKey(e.target.value)}
            placeholder="key (e.g. brand_name)" style={{ width: '100%' }} />
          <input className="aq-input" value={label} onChange={(e) => setLabel(e.target.value)}
            placeholder="label (e.g. Brand name)" style={{ width: '100%' }} />
          {err && <div className="aq-badge aq-badge-error" style={{ display: 'block', padding: 8 }}>{err}</div>}
          <button className="aq-btn aq-btn-secondary" disabled={busy || !key.trim()} onClick={() => add(key, label)}>
            Add field
          </button>
        </div>
      </div>
    </aside>
  );
}

function FieldRow({
  p, used, editable, onInsert, onSave, onDelete,
}: {
  p: Placeholder; used: boolean; editable: boolean;
  onInsert: () => void;
  onSave: (key: string, label: string) => Promise<void> | void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [key, setKey] = useState(p.key);
  const [label, setLabel] = useState(p.label);
  const [err, setErr] = useState('');

  if (editing) {
    return (
      <li className="aq-card" style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <input className="aq-input" value={key} onChange={(e) => setKey(e.target.value)} placeholder="key" />
        <input className="aq-input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="label" />
        {err && <div className="aq-badge aq-badge-error" style={{ display: 'block', padding: 6 }}>{err}</div>}
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
          <button className="aq-btn aq-btn-ghost" onClick={() => { setEditing(false); setKey(p.key); setLabel(p.label); setErr(''); }}>Cancel</button>
          <button className="aq-btn aq-btn-secondary" onClick={async () => {
            const v = validatePlaceholderKey(key);
            if (v) { setErr(v); return; }
            try { await onSave(key, label); setEditing(false); } catch (e: any) { setErr(e?.message ?? 'Could not save.'); }
          }}>Save</button>
        </div>
      </li>
    );
  }

  return (
    <li style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <button className="aq-btn aq-btn-ghost" disabled={!editable} onMouseDown={(e) => e.preventDefault()}
        onClick={onInsert} title={editable ? 'Insert into the focused block' : 'Read-only'}
        style={{ flex: 1, minWidth: 0, justifyContent: 'flex-start', textAlign: 'left', padding: '6px 8px' }}>
        <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{`{{ ${p.key} }}`}</span>
        <span style={{ fontSize: 12, color: 'var(--aq-text-muted)', marginInlineStart: 8 }}>{p.label}</span>
        {used ? <span style={{ fontSize: 10, color: 'var(--aq-text-muted)', marginInlineStart: 'auto' }}>used</span> : null}
      </button>
      <button className="aq-btn aq-btn-ghost" onClick={() => setEditing(true)} title="Edit"
        style={{ padding: '4px 8px' }}>Edit</button>
      <button className="aq-btn aq-btn-danger" onClick={onDelete} title="Delete field"
        style={{ padding: '4px 8px' }}>&times;</button>
    </li>
  );
}
