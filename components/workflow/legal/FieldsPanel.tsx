'use client';

import { useState } from 'react';
import { useLegalPlaceholders, useManagedLists } from '@/hooks/use-legal';
import {
  validatePlaceholderKey, validateFieldDef, describeField, FIELD_TYPES,
  type Placeholder, type FieldDef, type FieldType, type ManagedList,
} from '@/lib/legal';
import { ManagedListsModal } from '@/components/workflow/legal/ManagedListsModal';

/** A fresh field definition, defaulting to free text. */
function blankField(key = ''): FieldDef {
  return {
    key, label: '', field_type: 'text', required: false, default_value: '',
    num_min: null, num_max: null, list_id: null, owner_dept: 'legal', alert_days: null,
  };
}

/**
 * The workspace's merge-field registry, shown beside the block editor. Each
 * field is typed (migration 099): list draws from a managed list, number is
 * bounded, text is free entry. Clicking a field inserts {{ key }} at the caret.
 * Keys used in the wording but not registered are surfaced so a typo is caught
 * (or the field added) before publish.
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
  const mlists = useManagedLists(workspaceId ?? null);
  const registeredKeys = reg.placeholders.map((p) => p.key);
  const unknown = usedKeys.filter((k) => !registeredKeys.includes(k));

  const [err, setErr] = useState('');
  const [listsOpen, setListsOpen] = useState(false);

  const addQuick = async (k: string) => {
    setErr('');
    try { await reg.create(blankField(k)); }
    catch (e: any) { setErr(e?.message ?? 'Could not add the field.'); }
  };

  return (
    <aside className="aq-card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ flex: 1, fontSize: 13, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
          color: 'var(--aq-text-muted)' }}>Fields</div>
        <button className="aq-btn aq-btn-ghost" style={{ padding: '4px 8px', fontSize: 12 }}
          onClick={() => setListsOpen(true)} title="Manage the dropdown lists fields can draw from">Manage lists</button>
      </div>
      {listsOpen && <ManagedListsModal m={mlists} onClose={() => setListsOpen(false)} />}

      {unknown.length > 0 && (
        <div className="aq-badge aq-badge-warning" style={{ display: 'block', padding: 10, fontSize: 12 }}>
          <div style={{ marginBottom: 6 }}>Used in the wording but not defined:</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {unknown.map((k) => (
              <button key={k} className="aq-btn aq-btn-ghost" onClick={() => addQuick(k)}
                style={{ padding: '2px 8px', fontSize: 12 }} title="Add this field to the registry (as text)">
                + {`{{ ${k} }}`}
              </button>
            ))}
          </div>
        </div>
      )}

      {(err || reg.error) && <div className="aq-badge aq-badge-error" style={{ display: 'block', padding: 8 }}>{err || reg.error}</div>}

      {reg.loading ? (
        <div style={{ fontSize: 13, color: 'var(--aq-text-muted)' }}>{'Loading fields\u2026'}</div>
      ) : reg.placeholders.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--aq-text-muted)' }}>
          No fields yet. Add the ones your contracts fill in - a name, an amount, an IBAN.
        </div>
      ) : (
        <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {reg.placeholders.map((p) => (
            <FieldRow key={p.id} p={p} used={usedKeys.includes(p.key)} editable={editable} lists={mlists.lists}
              existingKeys={registeredKeys}
              onInsert={() => onInsert(p.key)}
              onSave={(f) => reg.update(p.id, f)}
              onDelete={() => reg.remove(p.id)} />
          ))}
        </ul>
      )}

      <div style={{ borderTop: '1px solid var(--aq-border-light)', paddingTop: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--aq-text-muted)', marginBottom: 6 }}>New field</div>
        <FieldForm initial={blankField()} lists={mlists.lists} existingKeys={registeredKeys} submitLabel="Add field"
          onSubmit={(f) => reg.create(f)} />
      </div>
    </aside>
  );
}

function FieldRow({
  p, used, editable, lists, existingKeys, onInsert, onSave, onDelete,
}: {
  p: Placeholder; used: boolean; editable: boolean;
  lists: ManagedList[]; existingKeys: string[];
  onInsert: () => void;
  onSave: (f: FieldDef) => Promise<void> | void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <li className="aq-card" style={{ padding: 10 }}>
        <FieldForm initial={p} lists={lists} existingKeys={existingKeys.filter((k) => k !== p.key)} submitLabel="Save"
          onSubmit={async (f) => { await onSave(f); setEditing(false); }}
          onCancel={() => setEditing(false)} />
      </li>
    );
  }

  return (
    <li style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <button className="aq-btn aq-btn-ghost" disabled={!editable} onMouseDown={(e) => e.preventDefault()}
        onClick={onInsert} title={editable ? 'Insert into the focused block' : 'Read-only'}
        style={{ flex: 1, minWidth: 0, justifyContent: 'flex-start', textAlign: 'left', padding: '6px 8px' }}>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block' }}>
            <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{`{{ ${p.key} }}`}</span>
            {p.label ? <span style={{ fontSize: 12, color: 'var(--aq-text-muted)', marginInlineStart: 8 }}>{p.label}</span> : null}
          </span>
          <span style={{ fontSize: 11, color: 'var(--aq-text-muted)' }}>{describeField(p, lists)}</span>
        </span>
        {used ? <span style={{ fontSize: 10, color: 'var(--aq-text-muted)' }}>used</span> : null}
      </button>
      <button className="aq-btn aq-btn-ghost" onClick={() => setEditing(true)} title="Edit"
        style={{ padding: '4px 8px' }}>Edit</button>
      <button className="aq-btn aq-btn-danger" onClick={onDelete} title="Delete field"
        style={{ padding: '4px 8px' }}>&times;</button>
    </li>
  );
}

/** The typed new/edit field form: key, label, type, and per-type extras. */
function FieldForm({
  initial, lists, existingKeys, submitLabel, onSubmit, onCancel,
}: {
  initial: FieldDef; lists: ManagedList[]; existingKeys: string[]; submitLabel: string;
  onSubmit: (f: FieldDef) => Promise<void> | void;
  onCancel?: () => void;
}) {
  const [key, setKey] = useState(initial.key);
  const [label, setLabel] = useState(initial.label);
  const [fieldType, setFieldType] = useState<FieldType>(initial.field_type);
  const [required, setRequired] = useState(initial.required);
  const [defaultValue, setDefaultValue] = useState(initial.default_value);
  const [listId, setListId] = useState<string>(initial.list_id ?? '');
  const [minS, setMinS] = useState(initial.num_min == null ? '' : String(initial.num_min));
  const [maxS, setMaxS] = useState(initial.num_max == null ? '' : String(initial.num_max));
  // Date alert: '' = off, '0' = expiry (must be future), 'N' = warn within N days.
  const [alertS, setAlertS] = useState(initial.alert_days == null ? '' : String(initial.alert_days));
  const [alertOn, setAlertOn] = useState(initial.alert_days != null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const numOrNull = (s: string): number | null => (s.trim() === '' ? null : Number(s));

  const submit = async () => {
    const kv = validatePlaceholderKey(key);
    if (kv) { setErr(kv); return; }
    if (existingKeys.includes(key.trim())) { setErr('That field already exists.'); return; }
    const num_min = fieldType === 'number' ? numOrNull(minS) : null;
    const num_max = fieldType === 'number' ? numOrNull(maxS) : null;
    if ((num_min != null && Number.isNaN(num_min)) || (num_max != null && Number.isNaN(num_max))) {
      setErr('Min and max must be numbers.'); return;
    }
    const list_id = fieldType === 'list' ? (listId || null) : null;
    let alert_days: number | null = null;
    if (fieldType === 'date' && alertOn) {
      const n = alertS.trim() === '' ? 0 : Number(alertS);
      if (!Number.isInteger(n) || n < 0) { setErr('Alert days must be a whole number, 0 or more.'); return; }
      alert_days = n;
    }
    const field: FieldDef = {
      key: key.trim(), label: label.trim(), field_type: fieldType, required,
      default_value: defaultValue, num_min, num_max, list_id, owner_dept: initial.owner_dept, alert_days,
    };
    const dv = validateFieldDef(field);
    if (dv) { setErr(dv); return; }
    setBusy(true); setErr('');
    try { await onSubmit(field); if (!onCancel) { setKey(''); setLabel(''); setFieldType('text'); setRequired(false); setDefaultValue(''); setListId(''); setMinS(''); setMaxS(''); setAlertOn(false); setAlertS(''); } }
    catch (e: any) { setErr(e?.message ?? 'Could not save the field.'); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <input className="aq-input" value={key} onChange={(e) => setKey(e.target.value)} placeholder="key (e.g. brand_name)" />
      <input dir="auto" className="aq-input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="label (e.g. Brand name)" />
      <select className="aq-select" value={fieldType} onChange={(e) => setFieldType(e.target.value as FieldType)}
        title={FIELD_TYPES.find((f) => f.key === fieldType)?.hint}>
        {FIELD_TYPES.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
      </select>

      {fieldType === 'list' && (
        <select className="aq-select" value={listId} onChange={(e) => setListId(e.target.value)}>
          <option value="">{'Pick a list\u2026'}</option>
          {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      )}
      {fieldType === 'number' && (
        <div style={{ display: 'flex', gap: 6 }}>
          <input className="aq-input" value={minS} onChange={(e) => setMinS(e.target.value)} placeholder="min" inputMode="decimal" style={{ flex: 1 }} />
          <input className="aq-input" value={maxS} onChange={(e) => setMaxS(e.target.value)} placeholder="max" inputMode="decimal" style={{ flex: 1 }} />
        </div>
      )}
      {(fieldType === 'text' || fieldType === 'number' || fieldType === 'date') && (
        <input dir="auto" className="aq-input" value={defaultValue} onChange={(e) => setDefaultValue(e.target.value)} placeholder="default (optional)" />
      )}
      {fieldType === 'date' && (
        <div style={{ border: '1px solid var(--aq-border-light)', borderRadius: 8, padding: 8 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--aq-text-secondary)' }}>
            <input type="checkbox" checked={alertOn} onChange={(e) => setAlertOn(e.target.checked)} /> Track as a deadline / expiry
          </label>
          {alertOn && (
            <div style={{ marginTop: 6 }}>
              <input className="aq-input" value={alertS} onChange={(e) => setAlertS(e.target.value)}
                placeholder="warn within N days (0 = must be future)" inputMode="numeric" />
              <div style={{ fontSize: 11, color: 'var(--aq-text-muted)', marginTop: 4 }}>
                A past date blocks issuing; 0 means it must be today or later.
              </div>
            </div>
          )}
        </div>
      )}

      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--aq-text-secondary)' }}>
        <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} /> Required
      </label>

      {err && <div className="aq-badge aq-badge-error" style={{ display: 'block', padding: 8 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        {onCancel && <button className="aq-btn aq-btn-ghost" onClick={onCancel} disabled={busy}>Cancel</button>}
        <button className="aq-btn aq-btn-secondary" disabled={busy || !key.trim()} onClick={submit}>{submitLabel}</button>
      </div>
    </div>
  );
}
