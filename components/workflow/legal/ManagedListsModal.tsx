'use client';

import { useState } from 'react';
import { useManagedLists } from '@/hooks/use-legal';
import {
  DEPTS, deptLabel, validatePlaceholderKey, validateListValue, sortListValues,
  type Dept, type ManagedListValue,
} from '@/lib/legal';

/**
 * The managed-list editor: the workspace's dropdown enumerations and their
 * values. "Legal chooses, it does not write" - a list-type field draws from one
 * of these. Owned by a department (metadata for the later permissions slice).
 */
export function ManagedListsModal({
  workspaceId, onClose,
}: { workspaceId?: string; onClose: () => void }) {
  const m = useManagedLists(workspaceId ?? null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = m.lists.find((l) => l.id === selectedId) ?? null;

  return (
    <div role="dialog" aria-modal="true" style={{
      position: 'fixed', inset: 0, background: 'var(--aq-backdrop, rgba(0,0,0,0.4))',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 16,
    }} onClick={onClose}>
      <div className="aq-card" style={{ padding: 20, width: 'min(760px, 100%)', maxHeight: '86vh', overflow: 'auto' }}
        onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
          <h3 style={{ flex: 1, fontSize: 16, fontWeight: 700 }}>Managed lists</h3>
          <button className="aq-btn aq-btn-ghost" onClick={onClose}>Close</button>
        </div>

        {m.error && <div className="aq-badge aq-badge-error" style={{ display: 'block', padding: 10, marginBottom: 12 }}>{m.error}</div>}

        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div style={{ flex: '1 1 260px', minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--aq-text-muted)', marginBottom: 8 }}>Lists</div>
            {m.loading ? (
              <div style={{ fontSize: 13, color: 'var(--aq-text-muted)' }}>{'Loading\u2026'}</div>
            ) : m.lists.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--aq-text-muted)' }}>No lists yet.</div>
            ) : (
              <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
                {m.lists.map((l) => (
                  <li key={l.id}>
                    <button onClick={() => setSelectedId(l.id)}
                      className={`aq-btn ${selectedId === l.id ? 'aq-btn-secondary' : 'aq-btn-ghost'}`}
                      style={{ width: '100%', justifyContent: 'flex-start', textAlign: 'left', padding: '8px 10px' }}>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, display: 'block' }}>{l.name}</span>
                        <span style={{ fontSize: 11, color: 'var(--aq-text-muted)', fontFamily: 'monospace' }}>{l.key}</span>
                      </span>
                      <span className="aq-badge aq-badge-muted" style={{ fontSize: 10 }}>{deptLabel(l.owner_dept)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <NewListForm onCreate={(k, n, d) => m.createList(k, n, d)} existingKeys={m.lists.map((l) => l.key)}
              onCreated={(id) => setSelectedId(id)} />
          </div>

          <div style={{ flex: '1 1 340px', minWidth: 0, borderInlineStart: '1px solid var(--aq-border-light)', paddingInlineStart: 16 }}>
            {!selected ? (
              <div style={{ fontSize: 13, color: 'var(--aq-text-muted)', paddingTop: 24, textAlign: 'center' }}>
                Pick a list to edit its values, or create one.
              </div>
            ) : (
              <ListValues
                key={selected.id}
                name={selected.name}
                values={sortListValues(m.valuesByList[selected.id] ?? [])}
                onRename={(name) => m.updateList(selected.id, { name })}
                onDept={(d) => m.updateList(selected.id, { owner_dept: d })}
                dept={selected.owner_dept}
                onDeleteList={async () => { await m.removeList(selected.id); setSelectedId(null); }}
                onAdd={(v, l) => m.addValue(selected.id, v, l)}
                onSaveValue={(id, patch) => m.updateValue(id, patch)}
                onDeleteValue={(id) => m.removeValue(id)} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function NewListForm({
  onCreate, onCreated, existingKeys,
}: {
  onCreate: (key: string, name: string, dept: Dept) => Promise<string>;
  onCreated: (id: string) => void;
  existingKeys: string[];
}) {
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [dept, setDept] = useState<Dept>('legal');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const v = validatePlaceholderKey(key);
    if (v) { setErr(v); return; }
    if (existingKeys.includes(key.trim())) { setErr('That list key already exists.'); return; }
    if (!name.trim()) { setErr('A list needs a name.'); return; }
    setBusy(true); setErr('');
    try { const id = await onCreate(key, name, dept); setKey(''); setName(''); setDept('legal'); onCreated(id); }
    catch (e: any) { setErr(e?.message ?? 'Could not create the list.'); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ borderTop: '1px solid var(--aq-border-light)', marginTop: 12, paddingTop: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--aq-text-muted)', marginBottom: 6 }}>New list</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <input className="aq-input" value={key} onChange={(e) => setKey(e.target.value)} placeholder="key (e.g. platform)" />
        <input className="aq-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="name (e.g. Platforms)" />
        <select className="aq-select" value={dept} onChange={(e) => setDept(e.target.value as Dept)}>
          {DEPTS.map((d) => <option key={d.key} value={d.key}>Owner: {d.label}</option>)}
        </select>
        {err && <div className="aq-badge aq-badge-error" style={{ display: 'block', padding: 8 }}>{err}</div>}
        <button className="aq-btn aq-btn-secondary" disabled={busy || !key.trim() || !name.trim()} onClick={submit}>Add list</button>
      </div>
    </div>
  );
}

function ListValues({
  name, dept, values, onRename, onDept, onDeleteList, onAdd, onSaveValue, onDeleteValue,
}: {
  name: string; dept: Dept; values: ManagedListValue[];
  onRename: (name: string) => Promise<void> | void;
  onDept: (d: Dept) => Promise<void> | void;
  onDeleteList: () => Promise<void> | void;
  onAdd: (value: string, label: string) => Promise<void> | void;
  onSaveValue: (id: string, patch: { value?: string; label?: string; active?: boolean }) => Promise<void> | void;
  onDeleteValue: (id: string) => Promise<void> | void;
}) {
  const [nm, setNm] = useState(name);
  const [nv, setNv] = useState('');
  const [nl, setNl] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const add = async () => {
    const v = validateListValue(nv);
    if (v) { setErr(v); return; }
    setBusy(true); setErr('');
    try { await onAdd(nv, nl); setNv(''); setNl(''); }
    catch (e: any) { setErr(e?.message ?? 'Could not add the value.'); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input className="aq-input" value={nm} onChange={(e) => setNm(e.target.value)}
          onBlur={() => { if (nm.trim() && nm !== name) onRename(nm); }} style={{ flex: 1, fontWeight: 600 }} />
        <select className="aq-select" value={dept} onChange={(e) => onDept(e.target.value as Dept)} style={{ width: 130 }}>
          {DEPTS.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
        </select>
      </div>

      {values.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--aq-text-muted)' }}>No values yet - add the choices below.</div>
      ) : (
        <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {values.map((v) => (
            <ValueRow key={v.id} v={v}
              onSave={(patch) => onSaveValue(v.id, patch)}
              onDelete={() => onDeleteValue(v.id)} />
          ))}
        </ul>
      )}

      <div style={{ borderTop: '1px solid var(--aq-border-light)', paddingTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <input dir="auto" className="aq-input" value={nv} onChange={(e) => setNv(e.target.value)}
          placeholder="value" style={{ flex: '1 1 120px' }} />
        <input dir="auto" className="aq-input" value={nl} onChange={(e) => setNl(e.target.value)}
          placeholder="label (optional)" style={{ flex: '1 1 120px' }} />
        <button className="aq-btn aq-btn-secondary" disabled={busy || !nv.trim()} onClick={add}>Add value</button>
      </div>
      {err && <div className="aq-badge aq-badge-error" style={{ display: 'block', padding: 8 }}>{err}</div>}

      <button className="aq-btn aq-btn-danger" style={{ alignSelf: 'flex-start', marginTop: 4 }}
        onClick={onDeleteList} title="Delete this whole list">Delete list</button>
    </div>
  );
}

function ValueRow({
  v, onSave, onDelete,
}: {
  v: ManagedListValue;
  onSave: (patch: { value?: string; label?: string; active?: boolean }) => Promise<void> | void;
  onDelete: () => void;
}) {
  const [value, setValue] = useState(v.value);
  const [label, setLabel] = useState(v.label);
  return (
    <li style={{ display: 'flex', gap: 6, alignItems: 'center', opacity: v.active ? 1 : 0.55 }}>
      <input dir="auto" className="aq-input" value={value} onChange={(e) => setValue(e.target.value)}
        onBlur={() => { if (value.trim() && value !== v.value) onSave({ value }); }} style={{ flex: '1 1 40%' }} />
      <input dir="auto" className="aq-input" value={label} onChange={(e) => setLabel(e.target.value)}
        onBlur={() => { if (label !== v.label) onSave({ label }); }} placeholder="label" style={{ flex: 1 }} />
      <button className="aq-btn aq-btn-ghost" onClick={() => onSave({ active: !v.active })}
        title={v.active ? 'Hide from the dropdown' : 'Show in the dropdown'} style={{ padding: '4px 8px' }}>
        {v.active ? 'On' : 'Off'}
      </button>
      <button className="aq-btn aq-btn-danger" onClick={onDelete} title="Delete value" style={{ padding: '4px 8px' }}>&times;</button>
    </li>
  );
}
