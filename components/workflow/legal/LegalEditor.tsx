'use client';

import { useEffect, useState } from 'react';
import { useDocEditor } from '@/hooks/use-legal';
import {
  EDITOR_BLOCK_TYPES, blockTypeLabel, isEditableBlockType, blockText, blockKV, canPublish,
  kindLabel, statusLabel, statusBadge, detectDir,
  type EditorBlockType, type TemplateBlock, type Dir,
} from '@/lib/legal';
import { AqDrawingBlock } from '@/components/AQLoading';

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
          <button className="aq-btn aq-btn-primary" disabled={busy || !canPublish(blocks)}
            onClick={ed.publish} title={canPublish(blocks) ? 'Freeze this version' : 'Add a block first'}>
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
              onSave={(content) => ed.saveBlock(b.id, content)}
              onMove={(mv) => ed.moveBlock(b.id, mv)}
              onDelete={() => ed.deleteBlock(b.id)} />
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
  );
}

function BlockRow({
  block, index, total, editable, busy, onSave, onMove, onDelete,
}: {
  block: TemplateBlock; index: number; total: number; editable: boolean; busy: boolean;
  onSave: (content: Record<string, unknown>) => void;
  onMove: (dir: -1 | 1) => void;
  onDelete: () => void;
}) {
  const known = isEditableBlockType(block.block_type);
  return (
    <li className="aq-card" style={{ padding: 14, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
        color: 'var(--aq-text-muted)', minWidth: 74, paddingTop: 8 }}>{blockTypeLabel(block.block_type)}</span>

      <div style={{ flex: 1, minWidth: 0 }}>
        {!known ? (
          <div style={{ fontSize: 13, color: 'var(--aq-text-muted)' }}>
            This block type is not editable here yet.
          </div>
        ) : block.block_type === 'kv' ? (
          <KVEditor block={block} editable={editable} onSave={onSave} />
        ) : (
          <TextEditor block={block} editable={editable} onSave={onSave} />
        )}
      </div>

      {editable && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <button className="aq-btn aq-btn-ghost" disabled={busy || index === 0}
            title="Move up" onClick={() => onMove(-1)} style={{ padding: '2px 8px' }}>&uarr;</button>
          <button className="aq-btn aq-btn-ghost" disabled={busy || index === total - 1}
            title="Move down" onClick={() => onMove(1)} style={{ padding: '2px 8px' }}>&darr;</button>
          <button className="aq-btn aq-btn-danger" disabled={busy}
            title="Delete block" onClick={onDelete} style={{ padding: '2px 8px' }}>&times;</button>
        </div>
      )}
    </li>
  );
}

const PLACEHOLDER: Record<string, string> = {
  title: 'Document title', h: 'Section heading', p: 'Paragraph text', li: 'Bullet text',
};

function TextEditor({
  block, editable, onSave,
}: { block: TemplateBlock; editable: boolean; onSave: (c: Record<string, unknown>) => void }) {
  const [text, setText] = useState(blockText(block));
  useEffect(() => { setText(blockText(block)); }, [block]);
  const commit = () => { if (text !== blockText(block)) onSave({ ...block.content, text }); };

  if (!editable) {
    return <div dir="auto" style={{ fontSize: 14, whiteSpace: 'pre-wrap', color: 'var(--aq-text)' }}>
      {text || <span style={{ color: 'var(--aq-text-muted)' }}>(empty)</span>}
    </div>;
  }
  const big = block.block_type === 'p';
  return big ? (
    <textarea dir="auto" className="aq-textarea" value={text} onChange={(e) => setText(e.target.value)} onBlur={commit}
      placeholder={PLACEHOLDER[block.block_type]} rows={3} style={{ width: '100%', resize: 'vertical' }} />
  ) : (
    <input dir="auto" className="aq-input" value={text} onChange={(e) => setText(e.target.value)} onBlur={commit}
      placeholder={PLACEHOLDER[block.block_type] ?? 'Text'} style={{ width: '100%',
        fontWeight: block.block_type === 'title' ? 700 : block.block_type === 'h' ? 600 : 400,
        fontSize: block.block_type === 'title' ? 16 : 14 }} />
  );
}

function KVEditor({
  block, editable, onSave,
}: { block: TemplateBlock; editable: boolean; onSave: (c: Record<string, unknown>) => void }) {
  const kv = blockKV(block);
  const [label, setLabel] = useState(kv.label);
  const [value, setValue] = useState(kv.value);
  useEffect(() => { const k = blockKV(block); setLabel(k.label); setValue(k.value); }, [block]);
  const commit = () => {
    const k = blockKV(block);
    if (label !== k.label || value !== k.value) onSave({ ...block.content, label, value });
  };

  if (!editable) {
    return <div dir="auto" style={{ fontSize: 14 }}>
      <span style={{ fontWeight: 600 }}>{label || '(label)'}:</span>{' '}
      <span>{value || <span style={{ color: 'var(--aq-text-muted)' }}>(value)</span>}</span>
    </div>;
  }
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <input dir="auto" className="aq-input" value={label} onChange={(e) => setLabel(e.target.value)} onBlur={commit}
        placeholder="Label (e.g. Term)" style={{ flex: '0 0 40%' }} />
      <input dir="auto" className="aq-input" value={value} onChange={(e) => setValue(e.target.value)} onBlur={commit}
        placeholder="Value (e.g. 12 months)" style={{ flex: 1 }} />
    </div>
  );
}
