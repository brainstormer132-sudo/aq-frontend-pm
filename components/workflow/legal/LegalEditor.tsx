'use client';

import { useEffect, useRef, useState } from 'react';
import { useDocEditor, useLegalPlaceholders } from '@/hooks/use-legal';
import {
  EDITOR_BLOCK_TYPES, blockTypeLabel, isEditableBlockType, blockText, blockKV, blockSig, canPublish,
  kindLabel, statusLabel, statusBadge, detectDir, usedPlaceholderKeys, unknownPlaceholders,
  tableColumns, tableRowSource,
  type EditorBlockType, type TemplateBlock, type Dir, type Placeholder, type TableColumn,
  type TableRowSource,
} from '@/lib/legal';
import { AqDrawingBlock } from '@/components/AQLoading';
import { FieldsPanel } from '@/components/workflow/legal/FieldsPanel';

/**
 * The block editor for one template's newest version. A draft is editable
 * (add / edit / reorder / delete blocks, then Publish); a published version is
 * read-only and offers "Start new draft", which clones it to v+1. The freeze is
 * enforced in the database (migration 098) - this UI just mirrors it.
 */
export function LegalEditor({
  workspaceId, templateId, onBack,
}: { workspaceId?: string; templateId: string; onBack: () => void }) {
  const ed = useDocEditor(workspaceId ?? null, templateId);
  const { version, blocks, loading, error, busy, editable } = ed;

  // Writing direction: detected from the content (an Arabic contract reads
  // right-to-left), overridable by the toggle. Individual fields still use
  // dir="auto" so a Latin name or number inside Arabic text sits correctly.
  const detected = detectDir(blocks);
  const [dirOverride, setDirOverride] = useState<Dir | null>(null);
  const dir: Dir = dirOverride ?? detected;

  // Merge-field registry and validation. `unknown` are {{ fields }} the wording
  // uses that are not registered - a typo or a field yet to be defined; Publish
  // is blocked until they resolve so a contract never ships a broken merge tag.
  const reg = useLegalPlaceholders(workspaceId ?? null);
  const usedKeys = usedPlaceholderKeys(blocks);
  const unknown = unknownPlaceholders(usedKeys, reg.placeholders.map((p) => p.key));
  // Set on focus by the block being edited; the Fields panel inserts here.
  const insertApi = useRef<((s: string) => void) | null>(null);

  return (
    <div className="aq-view" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button className="aq-btn aq-btn-ghost" onClick={onBack}>&larr; Documents</button>
        <span style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 16, fontWeight: 700 }}>{ed.name || 'Template'}</span>
          {ed.docKind ? (
            <span style={{ fontSize: 12, color: 'var(--aq-text-muted)' }}>{kindLabel(ed.docKind)}</span>
          ) : null}
          {version ? (
            <>
              <span style={{ fontSize: 12, color: 'var(--aq-text-muted)' }}>v{version.version}</span>
              <span className={`aq-badge ${statusBadge(version.status)}`}>{statusLabel(version.status)}</span>
            </>
          ) : null}
        </span>
        <div style={{ display: 'flex', border: '1px solid var(--aq-border)', borderRadius: 8, overflow: 'hidden' }}
          title="Reading direction">
          {(['ltr', 'rtl'] as Dir[]).map((d) => (
            <button key={d} onClick={() => setDirOverride(d)}
              style={{
                padding: '4px 10px', fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer',
                background: dir === d ? 'var(--aq-ink-btn)' : 'transparent',
                color: dir === d ? 'var(--aq-ink-btn-text)' : 'var(--aq-text-muted)',
              }}>
              {d === 'rtl' ? 'RTL' : 'LTR'}
            </button>
          ))}
        </div>
        {version && editable && (
          <button className="aq-btn aq-btn-primary" disabled={busy || !canPublish(blocks) || unknown.length > 0}
            onClick={ed.publish}
            title={unknown.length > 0 ? `Define these fields first: ${unknown.join(', ')}`
              : canPublish(blocks) ? 'Freeze this version' : 'Add a block first'}>
            Publish v{version.version}
          </button>
        )}
        {version && !editable && (
          <button className="aq-btn aq-btn-secondary" disabled={busy} onClick={ed.startNewDraft}>
            Start new draft (v{version.version + 1})
          </button>
        )}
      </div>

      {error && <div className="aq-badge aq-badge-error" style={{ display: 'block', padding: 10 }}>{error}</div>}

      {!editable && version && (
        <div className="aq-card" style={{ padding: 12, fontSize: 13, color: 'var(--aq-text-secondary)' }}>
          This version is {statusLabel(version.status).toLowerCase()} and frozen. Start a new draft to change the wording;
          the published version stays exactly as it was issued.
        </div>
      )}

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 440px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
      {loading ? (
        <div className="aq-card" style={{ padding: 8 }}><AqDrawingBlock label={'Loading the template\u2026'} /></div>
      ) : !version ? (
        <div className="aq-card" style={{ padding: 24, textAlign: 'center', color: 'var(--aq-text-muted)' }}>
          This template has no version yet.
        </div>
      ) : blocks.length === 0 ? (
        <div className="aq-card" style={{ padding: 24, textAlign: 'center' }}>
          <p style={{ color: 'var(--aq-text-secondary)', fontSize: 14 }}>Empty draft.</p>
          <p style={{ color: 'var(--aq-text-muted)', fontSize: 13, marginTop: 4 }}>Add the first block below.</p>
        </div>
      ) : (
        <ul dir={dir} style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {blocks.map((b, i) => (
            <BlockRow key={b.id} block={b} index={i} total={blocks.length} editable={!!editable} busy={busy}
              regFields={reg.placeholders}
              onSave={(content) => ed.saveBlock(b.id, content)}
              onMove={(mv) => ed.moveBlock(b.id, mv)}
              onDelete={() => ed.deleteBlock(b.id)}
              onToggleOptional={(v) => ed.setBlockOptional(b.id, v)}
              registerInsert={(fn) => { insertApi.current = fn; }} />
          ))}
        </ul>
      )}

      {editable && version && (
        <div className="aq-card" style={{ padding: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--aq-text-muted)', marginBottom: 8 }}>Add a block</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {EDITOR_BLOCK_TYPES.map((t) => (
              <button key={t.key} className="aq-btn aq-btn-ghost" disabled={busy}
                title={t.hint} onClick={() => ed.addBlock(t.key)}>
                + {t.label}
              </button>
            ))}
          </div>
        </div>
      )}
        </div>
        {version && (
          <div style={{ flex: '1 1 260px', minWidth: 0 }}>
            <FieldsPanel reg={reg} usedKeys={usedKeys} editable={!!editable} workspaceId={workspaceId}
              onInsert={(k) => insertApi.current?.(`{{ ${k} }}`)} />
          </div>
        )}
      </div>
    </div>
  );
}

function BlockRow({
  block, index, total, editable, busy, regFields, onSave, onMove, onDelete, onToggleOptional, registerInsert,
}: {
  block: TemplateBlock; index: number; total: number; editable: boolean; busy: boolean;
  regFields: Placeholder[];
  onSave: (content: Record<string, unknown>) => void;
  onMove: (dir: -1 | 1) => void;
  onDelete: () => void;
  onToggleOptional: (optional: boolean) => void;
  registerInsert: (fn: (s: string) => void) => void;
}) {
  const known = isEditableBlockType(block.block_type);
  return (
    <li className="aq-card" style={{ padding: 14, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
      <span style={{ minWidth: 74, paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
          color: 'var(--aq-text-muted)' }}>{blockTypeLabel(block.block_type)}</span>
        {block.optional && <span className="aq-badge aq-badge-warning" style={{ fontSize: 9 }}>Optional</span>}
      </span>

      <div style={{ flex: 1, minWidth: 0 }}>
        {!known ? (
          <div style={{ fontSize: 13, color: 'var(--aq-text-muted)' }}>
            This block type is not editable here yet.
          </div>
        ) : block.block_type === 'kv' ? (
          <KVEditor block={block} editable={editable} onSave={onSave} registerInsert={registerInsert} />
        ) : block.block_type === 'sig' ? (
          <SigEditor block={block} editable={editable} onSave={onSave} registerInsert={registerInsert} />
        ) : block.block_type === 'table' ? (
          <TableColumnsEditor block={block} editable={editable} regFields={regFields} onSave={onSave} />
        ) : (
          <TextEditor block={block} editable={editable} onSave={onSave} registerInsert={registerInsert} />
        )}
      </div>

      {editable && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <button className="aq-btn aq-btn-ghost" disabled={busy || index === 0}
            title="Move up" onClick={() => onMove(-1)} style={{ padding: '2px 8px' }}>&uarr;</button>
          <button className="aq-btn aq-btn-ghost" disabled={busy || index === total - 1}
            title="Move down" onClick={() => onMove(1)} style={{ padding: '2px 8px' }}>&darr;</button>
          <button className={`aq-btn ${block.optional ? 'aq-btn-secondary' : 'aq-btn-ghost'}`} disabled={busy}
            title={block.optional ? 'Optional clause - click to make it required' : 'Make this clause optional (can be switched off per contract)'}
            onClick={() => onToggleOptional(!block.optional)} style={{ padding: '2px 8px', fontSize: 11 }}>Opt</button>
          <button className="aq-btn aq-btn-danger" disabled={busy}
            title="Delete block" onClick={onDelete} style={{ padding: '2px 8px' }}>&times;</button>
        </div>
      )}
    </li>
  );
}

/** The template side of a table block: pick which registry fields are its
 *  columns, and their order. Rows are filled per contract, not here. */
function TableColumnsEditor({
  block, editable, regFields, onSave,
}: {
  block: TemplateBlock; editable: boolean; regFields: Placeholder[];
  onSave: (content: Record<string, unknown>) => void;
}) {
  const cols = tableColumns(block);
  const [addKey, setAddKey] = useState('');
  const used = new Set(cols.map((c) => c.key));
  const available = regFields.filter((f) => !used.has(f.key));

  const src = tableRowSource(block);
  const setCols = (next: TableColumn[]) => onSave({ ...block.content, columns: next });
  const setSrc = (next: TableRowSource) =>
    onSave({ ...block.content, columns: cols, row_source: next });
  const addCol = () => {
    const f = regFields.find((x) => x.key === addKey);
    if (!f) return;
    setCols([...cols, { key: f.key, label: f.label || f.key }]);
    setAddKey('');
  };
  const move = (i: number, dir: -1 | 1) => {
    const to = i + dir; if (to < 0 || to >= cols.length) return;
    const next = cols.slice(); const [x] = next.splice(i, 1); next.splice(to, 0, x); setCols(next);
  };

  if (!editable) {
    return (
      <div style={{ fontSize: 13 }}>
        <span style={{ color: 'var(--aq-text-muted)' }}>
          {src === 'fields' ? 'One row, filled from the fields: ' : 'Table columns: '}
        </span>
        {cols.length ? cols.map((c) => c.label).join(', ') : <span style={{ color: 'var(--aq-text-muted)' }}>(none)</span>}
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ fontSize: 12, fontWeight: 600 }}>How this table gets its rows</div>
        <label style={{ display: 'flex', gap: 6, alignItems: 'flex-start', fontSize: 12.5 }}>
          <input type="radio" name={`rs-${block.id}`} checked={src === 'fields'}
            onChange={() => setSrc('fields')} style={{ marginTop: 3 }} />
          <span>
            <b>One row, from the fields.</b> The table is a header and a single row;
            each column is an ordinary field on the contract. This is what a vendor
            contract wants - one contract per vendor, so the row describes that vendor.
          </span>
        </label>
        <label style={{ display: 'flex', gap: 6, alignItems: 'flex-start', fontSize: 12.5 }}>
          <input type="radio" name={`rs-${block.id}`} checked={src === 'rows'}
            onChange={() => setSrc('rows')} style={{ marginTop: 3 }} />
          <span>
            <b>Rows added per contract.</b> The operator adds as many rows as the job
            needs. This is what a client contract wants, where one document covers
            several vendors.
          </span>
        </label>
      </div>
      <div style={{ fontSize: 12, color: 'var(--aq-text-muted)' }}>Columns (each is a typed field):</div>
      {cols.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--aq-text-muted)' }}>No columns yet - add fields below.</div>
      ) : (
        <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {cols.map((c, i) => (
            <li key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{c.label}</span>
                <span style={{ fontSize: 11, color: 'var(--aq-text-muted)', fontFamily: 'monospace', marginInlineStart: 6 }}>{c.key}</span>
              </span>
              <button className="aq-btn aq-btn-ghost" disabled={i === 0} onClick={() => move(i, -1)} style={{ padding: '2px 6px' }}>&uarr;</button>
              <button className="aq-btn aq-btn-ghost" disabled={i === cols.length - 1} onClick={() => move(i, 1)} style={{ padding: '2px 6px' }}>&darr;</button>
              <button className="aq-btn aq-btn-danger" onClick={() => setCols(cols.filter((x) => x.key !== c.key))} style={{ padding: '2px 6px' }}>&times;</button>
            </li>
          ))}
        </ul>
      )}
      <div style={{ display: 'flex', gap: 6 }}>
        <select className="aq-select" value={addKey} onChange={(e) => setAddKey(e.target.value)} style={{ flex: 1 }}>
          <option value="">{available.length ? 'Add a column' : 'All fields are already columns'}</option>
          {available.map((f) => <option key={f.key} value={f.key}>{(f.label || f.key)} ({f.field_type})</option>)}
        </select>
        <button className="aq-btn aq-btn-secondary" disabled={!addKey} onClick={addCol}>Add</button>
      </div>
      {regFields.length === 0 && (
        <div style={{ fontSize: 11, color: 'var(--aq-text-muted)' }}>Define fields in the Fields panel first, then add them as columns.</div>
      )}
    </div>
  );
}

const PLACEHOLDER: Record<string, string> = {
  title: 'Document title', h: 'Section heading', p: 'Paragraph text', li: 'Bullet text',
};

function TextEditor({
  block, editable, onSave, registerInsert,
}: {
  block: TemplateBlock; editable: boolean;
  onSave: (c: Record<string, unknown>) => void;
  registerInsert: (fn: (s: string) => void) => void;
}) {
  const ref = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const [text, setText] = useState(blockText(block));
  useEffect(() => { setText(blockText(block)); }, [block]);
  const commit = () => { if (text !== blockText(block)) onSave({ ...block.content, text }); };

  // Insert a snippet at the caret (reading the live DOM value, not stale state).
  const insert = (s: string) => {
    const el = ref.current; if (!el) return;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    const next = el.value.slice(0, start) + s + el.value.slice(end);
    setText(next);
    onSave({ ...block.content, text: next });
    requestAnimationFrame(() => { const e2 = ref.current; if (e2) { const p = start + s.length; e2.focus(); e2.setSelectionRange(p, p); } });
  };

  if (!editable) {
    return <div dir="auto" style={{ fontSize: 14, whiteSpace: 'pre-wrap', color: 'var(--aq-text)' }}>
      {text || <span style={{ color: 'var(--aq-text-muted)' }}>(empty)</span>}
    </div>;
  }
  const big = block.block_type === 'p';
  return big ? (
    <textarea ref={ref as any} dir="auto" className="aq-textarea" value={text} onFocus={() => registerInsert(insert)}
      onChange={(e) => setText(e.target.value)} onBlur={commit}
      placeholder={PLACEHOLDER[block.block_type]} rows={3} style={{ width: '100%', resize: 'vertical' }} />
  ) : (
    <input ref={ref as any} dir="auto" className="aq-input" value={text} onFocus={() => registerInsert(insert)}
      onChange={(e) => setText(e.target.value)} onBlur={commit}
      placeholder={PLACEHOLDER[block.block_type] ?? 'Text'} style={{ width: '100%',
        fontWeight: block.block_type === 'title' ? 700 : block.block_type === 'h' ? 600 : 400,
        fontSize: block.block_type === 'title' ? 16 : 14 }} />
  );
}

function KVEditor({
  block, editable, onSave, registerInsert,
}: {
  block: TemplateBlock; editable: boolean;
  onSave: (c: Record<string, unknown>) => void;
  registerInsert: (fn: (s: string) => void) => void;
}) {
  const kv = blockKV(block);
  const labelRef = useRef<HTMLInputElement | null>(null);
  const valueRef = useRef<HTMLInputElement | null>(null);
  const [label, setLabel] = useState(kv.label);
  const [value, setValue] = useState(kv.value);
  useEffect(() => { const k = blockKV(block); setLabel(k.label); setValue(k.value); }, [block]);
  const commit = () => {
    const k = blockKV(block);
    if (label !== k.label || value !== k.value) onSave({ ...block.content, label, value });
  };

  // Insert at the caret of the focused field, saving both fields from the live
  // DOM so an unsaved edit in the other field is not lost.
  const mkInsert = (ref: { current: HTMLInputElement | null }, field: 'label' | 'value') => (s: string) => {
    const el = ref.current; if (!el) return;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    const inserted = el.value.slice(0, start) + s + el.value.slice(end);
    const lab = field === 'label' ? inserted : (labelRef.current?.value ?? label);
    const val = field === 'value' ? inserted : (valueRef.current?.value ?? value);
    setLabel(lab); setValue(val);
    onSave({ ...block.content, label: lab, value: val });
    requestAnimationFrame(() => { const e2 = ref.current; if (e2) { const p = start + s.length; e2.focus(); e2.setSelectionRange(p, p); } });
  };

  if (!editable) {
    return <div dir="auto" style={{ fontSize: 14 }}>
      <span style={{ fontWeight: 600 }}>{label || '(label)'}:</span>{' '}
      <span>{value || <span style={{ color: 'var(--aq-text-muted)' }}>(value)</span>}</span>
    </div>;
  }
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <input ref={labelRef} dir="auto" className="aq-input" value={label} onFocus={() => registerInsert(mkInsert(labelRef, 'label'))}
        onChange={(e) => setLabel(e.target.value)} onBlur={commit}
        placeholder="Label (e.g. Term)" style={{ flex: '0 0 40%' }} />
      <input ref={valueRef} dir="auto" className="aq-input" value={value} onFocus={() => registerInsert(mkInsert(valueRef, 'value'))}
        onChange={(e) => setValue(e.target.value)} onBlur={commit}
        placeholder="Value (e.g. 12 months)" style={{ flex: 1 }} />
    </div>
  );
}

/**
 * The two signing lines. Same shape as KVEditor, over {right, left} instead of
 * {label, value}: `right` is the first party, `left` the second, named for
 * where each sits on the page. Until now a sig block said "not editable here
 * yet" and printed as nothing at all.
 */
function SigEditor({
  block, editable, onSave, registerInsert,
}: {
  block: TemplateBlock; editable: boolean;
  onSave: (c: Record<string, unknown>) => void;
  registerInsert: (fn: (s: string) => void) => void;
}) {
  const sig = blockSig(block);
  const rightRef = useRef<HTMLInputElement | null>(null);
  const leftRef = useRef<HTMLInputElement | null>(null);
  const [right, setRight] = useState(sig.right);
  const [left, setLeft] = useState(sig.left);
  useEffect(() => { const s = blockSig(block); setRight(s.right); setLeft(s.left); }, [block]);
  const commit = () => {
    const s = blockSig(block);
    if (right !== s.right || left !== s.left) onSave({ ...block.content, right, left });
  };

  const mkInsert = (ref: { current: HTMLInputElement | null }, field: 'right' | 'left') => (s: string) => {
    const el = ref.current; if (!el) return;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    const inserted = el.value.slice(0, start) + s + el.value.slice(end);
    const r = field === 'right' ? inserted : (rightRef.current?.value ?? right);
    const l = field === 'left' ? inserted : (leftRef.current?.value ?? left);
    setRight(r); setLeft(l);
    onSave({ ...block.content, right: r, left: l });
    requestAnimationFrame(() => { const e2 = ref.current; if (e2) { const p = start + s.length; e2.focus(); e2.setSelectionRange(p, p); } });
  };

  if (!editable) {
    return <div dir="auto" style={{ display: 'flex', gap: 24, fontSize: 14 }}>
      <span style={{ flex: 1 }}>{right || <span style={{ color: 'var(--aq-text-muted)' }}>(first party)</span>}</span>
      <span style={{ flex: 1 }}>{left || <span style={{ color: 'var(--aq-text-muted)' }}>(second party)</span>}</span>
    </div>;
  }
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <input ref={rightRef} dir="auto" className="aq-input" value={right} onFocus={() => registerInsert(mkInsert(rightRef, 'right'))}
        onChange={(e) => setRight(e.target.value)} onBlur={commit}
        placeholder="First party (right)" style={{ flex: 1 }} />
      <input ref={leftRef} dir="auto" className="aq-input" value={left} onFocus={() => registerInsert(mkInsert(leftRef, 'left'))}
        onChange={(e) => setLeft(e.target.value)} onBlur={commit}
        placeholder="Second party (left)" style={{ flex: 1 }} />
    </div>
  );
}
