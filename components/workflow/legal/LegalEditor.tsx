'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useDocEditor, useLegalPlaceholders } from '@/hooks/use-legal';
import {
  blockText, blockKV, blockSig, canPublish,
  kindLabel, statusLabel, statusBadge, detectDir, usedPlaceholderKeys, unknownPlaceholders,
  tableColumns, tableRowSource,
  type TemplateBlock, type Dir, type Placeholder, type TableColumn, type TableRowSource,
  type EditorBlockType,
} from '@/lib/legal';
import {
  documentSections, sectionSummary, moveSection, moveLine,
  inlineParts, INSERT_KINDS, lineKindLabel,
  publishWarning, newDraftWarning, unknownFieldsNote, cannotPublish,
  type DocSection,
} from '@/lib/legal-doc-view';
import { AqDrawingBlock } from '@/components/AQLoading';
import { FieldsPanel } from '@/components/workflow/legal/FieldsPanel';

/**
 * The template editor, as the document.
 *
 * Siraj: "you need to rehaul the template editor and upload its unusable
 * unless you know exactly what youre doing it should be as simple as possible."
 *
 * -- WHAT WAS WRONG --------------------------------------------------
 *
 * The old screen was a list of forty-two cards. Each carried a type chip
 * ("KV", "SIG"), an up arrow, a down arrow, an "Opt" button and a delete
 * cross. Moving a clause from the end of the contract to the middle took
 * thirty-five clicks, one step at a time. Publishing froze the version
 * forever on a single click, and the reason the button was greyed out lived
 * in a `title=` tooltip you had to hover to find. Nowhere on the screen could
 * you read the contract.
 *
 * -- WHAT IT IS NOW ---------------------------------------------------
 *
 * The page reads like the printed document: the title where the title goes,
 * headings bold, paragraphs as prose, bullets with bullets, the signing lines
 * side by side, all in the contract's own direction. Four things changed the
 * feel of it:
 *
 *   1. SECTIONS. A heading owns what follows it, so forty-two rows became
 *      seven collapsible sections and a whole section moves as one decision.
 *   2. ONE LINE AT A TIME IS EDITABLE. Click a line and it becomes a box;
 *      everything else stays reading as the document. A page where every line
 *      is a form control is a form, not a document.
 *   3. FIELDS LOOK LIKE FIELDS. `{{ license_number }}` renders as a pill
 *      reading "Media licence number". The braces are still what is stored
 *      and still what you edit - the pill is the reading view only, because
 *      two representations of one string is how they come to disagree.
 *   4. THE IRREVERSIBLE THINGS ASK FIRST. Publish and "start a new version"
 *      both say in a sentence what they are about to do. The second one has
 *      already cost a day: a quiet click took version 3 of the UGC template
 *      and turned a seed written for version 3 into a permanent no-op.
 *
 * The rules are all in lib/legal-doc-view.ts and tested there. This file
 * decides what it looks like and nothing else.
 */
export function LegalEditor({
  workspaceId, templateId, onBack,
}: { workspaceId?: string; templateId: string; onBack: () => void }) {
  const ed = useDocEditor(workspaceId ?? null, templateId);
  const { version, blocks, loading, error, busy, editable } = ed;

  const detected = detectDir(blocks);
  const [dirOverride, setDirOverride] = useState<Dir | null>(null);
  const dir: Dir = dirOverride ?? detected;

  const reg = useLegalPlaceholders(workspaceId ?? null);
  const usedKeys = usedPlaceholderKeys(blocks);
  const unknown = unknownPlaceholders(usedKeys, reg.placeholders.map((p) => p.key));

  /** key -> label, so a field can render with a word on it. */
  const labels = useMemo(
    () => new Map(reg.placeholders.map((p) => [p.key, p.label || p.key])),
    [reg.placeholders],
  );
  const sections = useMemo(() => documentSections(blocks), [blocks]);

  // Which single line is open for editing, and which sections are folded.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [folded, setFolded] = useState<Record<string, boolean>>({});
  const insertApi = useRef<((s: string) => void) | null>(null);

  // A published version is read-only, so nothing should look clickable.
  useEffect(() => { if (!editable) setEditingId(null); }, [editable]);

  const blocked = cannotPublish(blocks.length, unknown, !!editable);
  const note = unknownFieldsNote(unknown);

  const doPublish = () => {
    if (!version) return;
    if (!confirm(publishWarning(version.version, blocks.length))) return;
    ed.publish();
  };
  const doNewDraft = () => {
    if (!version) return;
    if (!confirm(newDraftWarning(version.version))) return;
    ed.startNewDraft();
  };

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
              <span style={{ fontSize: 12, color: 'var(--aq-text-muted)' }}>version {version.version}</span>
              <span className={`aq-badge ${statusBadge(version.status)}`}>{statusLabel(version.status)}</span>
            </>
          ) : null}
          {busy && <span style={{ fontSize: 12, color: 'var(--aq-text-muted)' }}>{'Saving\u2026'}</span>}
        </span>
        <div style={{ display: 'flex', border: '1px solid var(--aq-border)', borderRadius: 8, overflow: 'hidden' }}
          title="Which way the document reads">
          {(['ltr', 'rtl'] as Dir[]).map((d) => (
            <button key={d} onClick={() => setDirOverride(d)}
              style={{
                padding: '4px 10px', fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer',
                background: dir === d ? 'var(--aq-ink-btn)' : 'transparent',
                color: dir === d ? 'var(--aq-ink-btn-text)' : 'var(--aq-text-muted)',
              }}>
              {d === 'rtl' ? 'Arabic' : 'English'}
            </button>
          ))}
        </div>
        {version && editable && (
          <button className="aq-btn aq-btn-primary" disabled={busy || !canPublish(blocks) || unknown.length > 0}
            onClick={doPublish}>
            Publish
          </button>
        )}
        {version && !editable && (
          <button className="aq-btn aq-btn-secondary" disabled={busy} onClick={doNewDraft}>
            Start version {version.version + 1}
          </button>
        )}
      </div>

      {error && <div className="aq-badge aq-badge-error" style={{ display: 'block', padding: 10 }}>{error}</div>}

      {/* Said out loud, not hidden on a disabled button. */}
      {editable && note && (
        <div className="aq-badge aq-badge-warning" style={{ display: 'block', padding: 10, fontSize: 13 }}>
          {note}
        </div>
      )}
      {editable && !note && blocked && (
        <div style={{ fontSize: 12.5, color: 'var(--aq-text-muted)' }}>{blocked}</div>
      )}

      {!editable && version && (
        <div className="aq-card" style={{ padding: 12, fontSize: 13, color: 'var(--aq-text-secondary)' }}>
          Version {version.version} is {statusLabel(version.status).toLowerCase()} and cannot be changed -
          that is what lets a contract made from it prove what it said. Start a new version to edit the wording.
        </div>
      )}

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 460px', minWidth: 0 }}>
          {loading ? (
            <div className="aq-card" style={{ padding: 8 }}><AqDrawingBlock label={'Loading the document\u2026'} /></div>
          ) : !version ? (
            <div className="aq-card" style={{ padding: 24, textAlign: 'center', color: 'var(--aq-text-muted)' }}>
              This template has no version yet.
            </div>
          ) : blocks.length === 0 ? (
            <div className="aq-card" style={{ padding: 28, textAlign: 'center' }}>
              <p style={{ color: 'var(--aq-text-secondary)', fontSize: 14 }}>This document is empty.</p>
              <p style={{ color: 'var(--aq-text-muted)', fontSize: 13, marginTop: 4 }}>
                Add the first line below.
              </p>
              <div style={{ marginTop: 14 }}>
                <InsertRow editable={!!editable} busy={busy} onAdd={(t) => ed.addBlockAt(t, 0)} always />
              </div>
            </div>
          ) : (
            /* The page. Padding and a white card so it reads as paper. */
            <div className="aq-card" dir={dir} style={{ padding: '26px 30px' }}>
              {sections.map((s, si) => (
                <SectionView
                  key={s.headingId || `open-${si}`}
                  section={s} index={si} total={sections.length}
                  blocks={blocks} labels={labels} dir={dir}
                  editable={!!editable} busy={busy}
                  folded={!!folded[s.headingId || '__open']}
                  onFold={() => setFolded((f) => ({
                    ...f, [s.headingId || '__open']: !f[s.headingId || '__open'],
                  }))}
                  editingId={editingId} onEdit={setEditingId}
                  regFields={reg.placeholders}
                  onSave={ed.saveBlock}
                  onDelete={ed.deleteBlock}
                  onToggleOptional={ed.setBlockOptional}
                  onAddAt={ed.addBlockAt}
                  onMoveSection={(d) => ed.reorder(moveSection(blocks, si, d))}
                  onMoveLine={(id, d) => ed.reorder(moveLine(blocks, id, d))}
                  registerInsert={(fn) => { insertApi.current = fn; }}
                />
              ))}
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

/* -- one section ------------------------------------------------------- */

function SectionView({
  section, index, total, blocks, labels, dir, editable, busy, folded, onFold,
  editingId, onEdit, regFields, onSave, onDelete, onToggleOptional, onAddAt,
  onMoveSection, onMoveLine, registerInsert,
}: {
  section: DocSection; index: number; total: number;
  blocks: TemplateBlock[]; labels: Map<string, string>; dir: Dir;
  editable: boolean; busy: boolean; folded: boolean; onFold: () => void;
  editingId: string | null; onEdit: (id: string | null) => void;
  regFields: Placeholder[];
  onSave: (id: string, c: Record<string, unknown>) => void;
  onDelete: (id: string) => void;
  onToggleOptional: (id: string, v: boolean) => void;
  onAddAt: (t: EditorBlockType, i: number) => void;
  onMoveSection: (d: -1 | 1) => void;
  onMoveLine: (id: string, d: -1 | 1) => void;
  registerInsert: (fn: (s: string) => void) => void;
}) {
  const head = section.headingId ? section.blocks[0] : null;
  const body = section.headingId ? section.blocks.slice(1) : section.blocks;
  // Where in the FLAT list each line sits, so "+" inserts where it was pressed.
  const flatIndex = (b: TemplateBlock) => blocks.findIndex((x) => x.id === b.id);
  const canUp = index > 1 || (index === 1 && !!blocks.length && !!section.headingId && index > 0);

  return (
    <section style={{ marginBottom: 18 }}>
      {head && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <button className="aq-btn aq-btn-ghost" onClick={onFold} title={folded ? 'Open' : 'Fold'}
            style={{ padding: '0 6px', fontSize: 13 }}>{folded ? '\u25b8' : '\u25be'}</button>
          <span style={{ flex: 1, minWidth: 0 }}>
            <Line block={head} labels={labels} dir={dir} editable={editable} busy={busy}
              editing={editingId === head.id} onEdit={onEdit} regFields={regFields}
              onSave={onSave} registerInsert={registerInsert} />
          </span>
          {folded && (
            <span dir="auto" style={{ fontSize: 11.5, color: 'var(--aq-text-muted)', whiteSpace: 'nowrap' }}>
              {sectionSummary(section)}
            </span>
          )}
          {editable && (
            <span style={{ display: 'flex', gap: 2, flex: '0 0 auto' }}>
              {/* One click moves the whole section, body and all. */}
              <button className="aq-btn aq-btn-ghost" disabled={busy || !canUp}
                title="Move this whole section up" onClick={() => onMoveSection(-1)}
                style={{ padding: '2px 7px' }}>&uarr;</button>
              <button className="aq-btn aq-btn-ghost" disabled={busy || index === total - 1}
                title="Move this whole section down" onClick={() => onMoveSection(1)}
                style={{ padding: '2px 7px' }}>&darr;</button>
              <OptionalToggle block={head} busy={busy} onToggle={onToggleOptional} />
              <button className="aq-btn aq-btn-ghost" disabled={busy}
                title="Delete this heading" style={{ padding: '2px 7px' }}
                onClick={() => { if (confirm(`Delete the heading "${blockText(head) || 'untitled'}"? The lines under it stay.`)) onDelete(head.id); }}>
                &times;
              </button>
            </span>
          )}
        </div>
      )}

      {!folded && (
        <div style={{ paddingInlineStart: head ? 22 : 0 }}>
          {body.map((b, i) => (
            <div key={b.id}>
              <InsertRow editable={editable} busy={busy} onAdd={(t) => onAddAt(t, flatIndex(b))} />
              <LineRow
                block={b} labels={labels} dir={dir} editable={editable} busy={busy}
                editing={editingId === b.id} onEdit={onEdit} regFields={regFields}
                onSave={onSave} onDelete={onDelete} onToggleOptional={onToggleOptional}
                canUp={i > 0} canDown={i < body.length - 1}
                onMove={(d) => onMoveLine(b.id, d)}
                registerInsert={registerInsert}
              />
            </div>
          ))}
          <InsertRow editable={editable} busy={busy}
            onAdd={(t) => onAddAt(t, body.length ? flatIndex(body[body.length - 1]) + 1 : blocks.length)} />
        </div>
      )}
    </section>
  );
}

/** The "Optional clause" switch, with the words spelled out. */
function OptionalToggle({ block, busy, onToggle }: {
  block: TemplateBlock; busy: boolean; onToggle: (id: string, v: boolean) => void;
}) {
  return (
    <button className={`aq-btn ${block.optional ? 'aq-btn-secondary' : 'aq-btn-ghost'}`} disabled={busy}
      title={block.optional
        ? 'Optional: whoever raises a contract can switch this off. Click to make it always included.'
        : 'Always included. Click to let whoever raises a contract switch it off.'}
      onClick={() => onToggle(block.id, !block.optional)}
      dir="auto" style={{ padding: '2px 7px', fontSize: 11 }}>
      {block.optional ? 'Optional' : 'Always'}
    </button>
  );
}

/* -- one line ---------------------------------------------------------- */

function LineRow({
  block, labels, dir, editable, busy, editing, onEdit, regFields,
  onSave, onDelete, onToggleOptional, canUp, canDown, onMove, registerInsert,
}: {
  block: TemplateBlock; labels: Map<string, string>; dir: Dir;
  editable: boolean; busy: boolean; editing: boolean;
  onEdit: (id: string | null) => void; regFields: Placeholder[];
  onSave: (id: string, c: Record<string, unknown>) => void;
  onDelete: (id: string) => void;
  onToggleOptional: (id: string, v: boolean) => void;
  canUp: boolean; canDown: boolean; onMove: (d: -1 | 1) => void;
  registerInsert: (fn: (s: string) => void) => void;
}) {
  const [hover, setHover] = useState(false);
  return (
    <div onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '2px 0' }}>
      <span style={{ flex: 1, minWidth: 0 }}>
        <Line block={block} labels={labels} dir={dir} editable={editable} busy={busy}
          editing={editing} onEdit={onEdit} regFields={regFields}
          onSave={onSave} registerInsert={registerInsert} />
      </span>
      {/* The controls appear on the line you are pointing at, so a page of
          forty lines is not a page of a hundred and sixty buttons. */}
      {editable && (hover || editing) && (
        <span style={{ display: 'flex', gap: 2, flex: '0 0 auto', paddingTop: 2 }}>
          <span dir="auto" style={{ fontSize: 10.5, color: 'var(--aq-text-muted)', alignSelf: 'center',
            marginInlineEnd: 4, whiteSpace: 'nowrap' }}>{lineKindLabel(block.block_type)}</span>
          <button className="aq-btn aq-btn-ghost" disabled={busy || !canUp}
            title="Move up" onClick={() => onMove(-1)} style={{ padding: '1px 6px' }}>&uarr;</button>
          <button className="aq-btn aq-btn-ghost" disabled={busy || !canDown}
            title="Move down" onClick={() => onMove(1)} style={{ padding: '1px 6px' }}>&darr;</button>
          <OptionalToggle block={block} busy={busy} onToggle={onToggleOptional} />
          <button className="aq-btn aq-btn-ghost" disabled={busy} title="Delete this line"
            style={{ padding: '1px 6px' }}
            onClick={() => { if (confirm('Delete this line?')) onDelete(block.id); }}>&times;</button>
        </span>
      )}
    </div>
  );
}

/**
 * A line, read or edited.
 *
 * Reading is the default and editing is one line at a time: a page where
 * every line is a textarea is a form, and the whole complaint was that the
 * contract was nowhere to be seen.
 */
function Line({
  block, labels, dir, editable, busy, editing, onEdit, regFields, onSave, registerInsert,
}: {
  block: TemplateBlock; labels: Map<string, string>; dir: Dir;
  editable: boolean; busy: boolean; editing: boolean;
  onEdit: (id: string | null) => void; regFields: Placeholder[];
  onSave: (id: string, c: Record<string, unknown>) => void;
  registerInsert: (fn: (s: string) => void) => void;
}) {
  const save = (c: Record<string, unknown>) => onSave(block.id, c);

  if (editing) {
    const done = () => onEdit(null);
    if (block.block_type === 'kv') {
      return <KVEditor block={block} onSave={save} onDone={done} registerInsert={registerInsert} />;
    }
    if (block.block_type === 'sig') {
      return <SigEditor block={block} onSave={save} onDone={done} registerInsert={registerInsert} />;
    }
    if (block.block_type === 'table') {
      return <TableColumnsEditor block={block} regFields={regFields} onSave={save} onDone={done} />;
    }
    return <TextEditor block={block} onSave={save} onDone={done} registerInsert={registerInsert} />;
  }

  const open = editable && !busy ? () => onEdit(block.id) : undefined;
  const clickable = editable
    ? { cursor: 'pointer', borderRadius: 4, padding: '1px 3px', marginInlineStart: -3 }
    : {};
  const common = {
    dir: 'auto' as const,
    role: editable ? 'button' : undefined,
    tabIndex: editable ? 0 : undefined,
    onClick: open,
    onKeyDown: (e: any) => {
      if (editable && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onEdit(block.id); }
    },
    title: editable ? 'Click to edit' : undefined,
  };

  const parts = <Parts text={blockText(block)} labels={labels} />;

  switch (block.block_type) {
    case 'title':
      return <div {...common} style={{ ...clickable, fontSize: 19, fontWeight: 800, textAlign: 'center', margin: '4px 0 14px' }}>
        {blockText(block) ? parts : <Empty>Document title</Empty>}
      </div>;
    case 'h':
      return <div {...common} style={{ ...clickable, fontSize: 15.5, fontWeight: 700 }}>
        {blockText(block) ? parts : <Empty>Section heading</Empty>}
      </div>;
    case 'li':
      return <div {...common} style={{ ...clickable, fontSize: 14, lineHeight: 1.7, display: 'flex', gap: 8 }}>
        <span style={{ flex: '0 0 auto', color: 'var(--aq-text-muted)' }}>{'\u2022'}</span>
        <span style={{ flex: 1, minWidth: 0 }}>{blockText(block) ? parts : <Empty>Bullet</Empty>}</span>
      </div>;
    case 'kv': {
      const kv = blockKV(block);
      return <div {...common} style={{ ...clickable, fontSize: 14, lineHeight: 1.8 }}>
        <span style={{ fontWeight: 600 }}>{kv.label || '(label)'}:</span>{' '}
        <Parts text={kv.value} labels={labels} />
      </div>;
    }
    case 'sig': {
      const sg = blockSig(block);
      return <div {...common} style={{ ...clickable, display: 'flex', gap: 28, fontSize: 14, marginTop: 20 }}>
        <span style={{ flex: 1 }}>{sg.right || <Empty>First party</Empty>}</span>
        <span style={{ flex: 1 }}>{sg.left || <Empty>Second party</Empty>}</span>
      </div>;
    }
    case 'table': {
      const cols = tableColumns(block);
      const src = tableRowSource(block);
      return (
        <div {...common} style={{ ...clickable, margin: '10px 0' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                {cols.length ? cols.map((c) => (
                  <th key={c.key} style={{ border: '1px solid var(--aq-border)', padding: '6px 8px',
                    background: 'var(--aq-surface-2, #f6f6f6)', fontWeight: 700, textAlign: 'start' }}>{c.label}</th>
                )) : <th style={{ border: '1px solid var(--aq-border)', padding: '6px 8px' }}><Empty>No columns yet</Empty></th>}
              </tr>
            </thead>
            <tbody>
              <tr>
                {(cols.length ? cols : [{ key: '_', label: '' } as TableColumn]).map((c) => (
                  <td key={c.key} style={{ border: '1px solid var(--aq-border)', padding: '6px 8px',
                    color: 'var(--aq-text-muted)' }}>
                    {src === 'fields' ? <Pill>{c.label}</Pill> : <span style={{ fontSize: 12 }}>filled per contract</span>}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
          {/* dir="auto" because this is OUR words inside THEIR document. The
              card is right-to-left for an Arabic contract, and an English
              sentence inheriting that renders with its full stop at the front.
              Found by rendering the page and looking at it. */}
          <div dir="auto" style={{ fontSize: 11.5, color: 'var(--aq-text-muted)', marginTop: 4 }}>
            {src === 'fields'
              ? 'One row, filled from the fields on each contract.'
              : 'Rows are added one by one on each contract.'}
          </div>
        </div>
      );
    }
    default:
      return <div {...common} style={{ ...clickable, fontSize: 14, lineHeight: 1.8 }}>
        {blockText(block) ? parts : <Empty>Paragraph</Empty>}
      </div>;
  }
}

function Empty({ children }: { children: React.ReactNode }) {
  return <span style={{ color: 'var(--aq-text-muted)', fontStyle: 'italic' }}>{children}</span>;
}

function Pill({ children, unknown }: { children: React.ReactNode; unknown?: boolean }) {
  return (
    <span style={{
      display: 'inline-block', padding: '0 6px', borderRadius: 5, fontSize: 12.5,
      background: unknown ? 'var(--aq-warning-bg, #fff3cd)' : 'var(--aq-surface-2, #eef1f5)',
      color: unknown ? 'var(--aq-warning-text, #7a5200)' : 'var(--aq-text-secondary)',
      border: unknown ? '1px dashed var(--aq-warning, #a86200)' : '1px solid transparent',
    }}>{children}</span>
  );
}

/** The line, with its fields shown as words rather than braces. */
function Parts({ text, labels }: { text: string; labels: Map<string, string> }) {
  const parts = inlineParts(text, labels);
  return <>{parts.map((p, i) => (p.field
    ? <Pill key={i} unknown={p.unknown}>{p.label}</Pill>
    : <span key={i}>{p.text}</span>))}</>;
}

/* -- the editors, one line at a time ----------------------------------- */

/** Shared chrome: a Done button, so leaving edit mode is a thing you do. */
function EditBox({ children, onDone }: { children: React.ReactNode; onDone: () => void }) {
  return (
    <div dir="auto" style={{ border: '1px solid var(--aq-border)', borderRadius: 8, padding: 10, margin: '4px 0',
      background: 'var(--aq-surface, #fff)' }}>
      {children}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
        <button className="aq-btn aq-btn-secondary" onClick={onDone} style={{ padding: '3px 12px' }}>Done</button>
      </div>
    </div>
  );
}

function TextEditor({ block, onSave, onDone, registerInsert }: {
  block: TemplateBlock; onSave: (c: Record<string, unknown>) => void; onDone: () => void;
  registerInsert: (fn: (s: string) => void) => void;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const [text, setText] = useState(blockText(block));
  useEffect(() => { setText(blockText(block)); }, [block]);
  useEffect(() => { const el = ref.current; if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }, []);
  const commit = () => { if (text !== blockText(block)) onSave({ ...block.content, text }); };

  const insert = (s: string) => {
    const el = ref.current; if (!el) return;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    const next = el.value.slice(0, start) + s + el.value.slice(end);
    setText(next);
    onSave({ ...block.content, text: next });
    requestAnimationFrame(() => { const e2 = ref.current; if (e2) { const p = start + s.length; e2.focus(); e2.setSelectionRange(p, p); } });
  };

  return (
    <EditBox onDone={() => { commit(); onDone(); }}>
      <div dir="auto" style={{ fontSize: 11, color: 'var(--aq-text-muted)', marginBottom: 4 }}>
        {lineKindLabel(block.block_type)}
        {' \u00b7 '}a field looks like {'{{ name }}'} - insert one from the Fields panel
      </div>
      <textarea ref={ref} dir="auto" className="aq-textarea" value={text}
        onFocus={() => registerInsert(insert)}
        onChange={(e) => setText(e.target.value)} onBlur={commit}
        rows={block.block_type === 'p' ? 4 : 2} style={{ width: '100%', resize: 'vertical' }} />
    </EditBox>
  );
}

function KVEditor({ block, onSave, onDone, registerInsert }: {
  block: TemplateBlock; onSave: (c: Record<string, unknown>) => void; onDone: () => void;
  registerInsert: (fn: (s: string) => void) => void;
}) {
  const kv = blockKV(block);
  const labelRef = useRef<HTMLInputElement | null>(null);
  const valueRef = useRef<HTMLInputElement | null>(null);
  const [label, setLabel] = useState(kv.label);
  const [value, setValue] = useState(kv.value);
  useEffect(() => { const k = blockKV(block); setLabel(k.label); setValue(k.value); }, [block]);
  useEffect(() => { labelRef.current?.focus(); }, []);
  const commit = () => {
    const k = blockKV(block);
    if (label !== k.label || value !== k.value) onSave({ ...block.content, label, value });
  };
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
  return (
    <EditBox onDone={() => { commit(); onDone(); }}>
      <div dir="auto" style={{ fontSize: 11, color: 'var(--aq-text-muted)', marginBottom: 4 }}>
        Detail line {'\u00b7'} a label and its value, like a bank row
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input ref={labelRef} dir="auto" className="aq-input" value={label}
          onFocus={() => registerInsert(mkInsert(labelRef, 'label'))}
          onChange={(e) => setLabel(e.target.value)} onBlur={commit}
          placeholder="Label" style={{ flex: '0 0 38%' }} />
        <input ref={valueRef} dir="auto" className="aq-input" value={value}
          onFocus={() => registerInsert(mkInsert(valueRef, 'value'))}
          onChange={(e) => setValue(e.target.value)} onBlur={commit}
          placeholder="Value" style={{ flex: 1 }} />
      </div>
    </EditBox>
  );
}

function SigEditor({ block, onSave, onDone, registerInsert }: {
  block: TemplateBlock; onSave: (c: Record<string, unknown>) => void; onDone: () => void;
  registerInsert: (fn: (s: string) => void) => void;
}) {
  const sig = blockSig(block);
  const rightRef = useRef<HTMLInputElement | null>(null);
  const leftRef = useRef<HTMLInputElement | null>(null);
  const [right, setRight] = useState(sig.right);
  const [left, setLeft] = useState(sig.left);
  useEffect(() => { const s = blockSig(block); setRight(s.right); setLeft(s.left); }, [block]);
  useEffect(() => { rightRef.current?.focus(); }, []);
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
  return (
    <EditBox onDone={() => { commit(); onDone(); }}>
      <div dir="auto" style={{ fontSize: 11, color: 'var(--aq-text-muted)', marginBottom: 4 }}>
        The two signing lines at the end
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input ref={rightRef} dir="auto" className="aq-input" value={right}
          onFocus={() => registerInsert(mkInsert(rightRef, 'right'))}
          onChange={(e) => setRight(e.target.value)} onBlur={commit}
          placeholder="First party" style={{ flex: 1 }} />
        <input ref={leftRef} dir="auto" className="aq-input" value={left}
          onFocus={() => registerInsert(mkInsert(leftRef, 'left'))}
          onChange={(e) => setLeft(e.target.value)} onBlur={commit}
          placeholder="Second party" style={{ flex: 1 }} />
      </div>
    </EditBox>
  );
}

/** Which registry fields are the table's columns, and where its rows come from. */
function TableColumnsEditor({ block, regFields, onSave, onDone }: {
  block: TemplateBlock; regFields: Placeholder[];
  onSave: (c: Record<string, unknown>) => void; onDone: () => void;
}) {
  const cols = tableColumns(block);
  const [addKey, setAddKey] = useState('');
  const used = new Set(cols.map((c) => c.key));
  const available = regFields.filter((f) => !used.has(f.key));
  const src = tableRowSource(block);
  const setCols = (next: TableColumn[]) => onSave({ ...block.content, columns: next });
  const setSrc = (next: TableRowSource) => onSave({ ...block.content, columns: cols, row_source: next });
  const addCol = () => {
    const f = regFields.find((x) => x.key === addKey);
    if (!f) return;
    setCols([...cols, { key: f.key, label: f.label || f.key }]);
    setAddKey('');
  };
  const move = (i: number, d: -1 | 1) => {
    const to = i + d; if (to < 0 || to >= cols.length) return;
    const next = cols.slice(); const [x] = next.splice(i, 1); next.splice(to, 0, x); setCols(next);
  };
  return (
    <EditBox onDone={onDone}>
      <div dir="auto" style={{ fontSize: 11, color: 'var(--aq-text-muted)', marginBottom: 6 }}>Table</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
        <label style={{ display: 'flex', gap: 6, alignItems: 'flex-start', fontSize: 12.5 }}>
          <input type="radio" name={`rs-${block.id}`} checked={src === 'fields'}
            onChange={() => setSrc('fields')} style={{ marginTop: 3 }} />
          <span><b>One row.</b> Each column is an ordinary field on the contract -
            what a vendor agreement wants, since it covers one vendor.</span>
        </label>
        <label style={{ display: 'flex', gap: 6, alignItems: 'flex-start', fontSize: 12.5 }}>
          <input type="radio" name={`rs-${block.id}`} checked={src === 'rows'}
            onChange={() => setSrc('rows')} style={{ marginTop: 3 }} />
          <span><b>Many rows.</b> Whoever raises the contract adds as many as the job needs -
            what a client contract wants.</span>
        </label>
      </div>
      <div dir="auto" style={{ fontSize: 12, color: 'var(--aq-text-muted)' }}>Columns:</div>
      {cols.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--aq-text-muted)' }}>None yet - add one below.</div>
      ) : (
        <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
          {cols.map((c, i) => (
            <li key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600 }}>{c.label}</span>
              <button className="aq-btn aq-btn-ghost" disabled={i === 0} onClick={() => move(i, -1)} style={{ padding: '1px 6px' }}>&uarr;</button>
              <button className="aq-btn aq-btn-ghost" disabled={i === cols.length - 1} onClick={() => move(i, 1)} style={{ padding: '1px 6px' }}>&darr;</button>
              <button className="aq-btn aq-btn-ghost" onClick={() => setCols(cols.filter((x) => x.key !== c.key))} style={{ padding: '1px 6px' }}>&times;</button>
            </li>
          ))}
        </ul>
      )}
      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
        <select className="aq-select" value={addKey} onChange={(e) => setAddKey(e.target.value)} style={{ flex: 1 }}>
          <option value="">{available.length ? 'Add a column' : 'Every field is already a column'}</option>
          {available.map((f) => <option key={f.key} value={f.key}>{f.label || f.key}</option>)}
        </select>
        <button className="aq-btn aq-btn-secondary" disabled={!addKey} onClick={addCol}>Add</button>
      </div>
    </EditBox>
  );
}

/**
 * The "+" between two lines.
 *
 * Invisible until pointed at, so the page reads as a document rather than a
 * ladder of buttons - and it inserts WHERE IT IS, which is the other half of
 * the click-count fix. The old editor could only append.
 */
function InsertRow({ editable, busy, onAdd, always }: {
  editable: boolean; busy: boolean; onAdd: (t: EditorBlockType) => void; always?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(false);
  if (!editable) return null;
  const show = always || hover || open;
  return (
    <div onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ minHeight: always ? undefined : 10, display: 'flex', alignItems: 'center', gap: 8 }}>
      {!show ? null : !open ? (
        <button className="aq-btn aq-btn-ghost" disabled={busy} onClick={() => setOpen(true)}
          dir="auto" style={{ padding: '0 8px', fontSize: 12, color: 'var(--aq-text-muted)' }}>
          + Add a line here
        </button>
      ) : (
        <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {INSERT_KINDS.map((k) => (
            <button key={k.key} className="aq-btn aq-btn-ghost" disabled={busy} title={k.hint}
              dir="auto" style={{ padding: '2px 9px', fontSize: 12 }}
              onClick={() => { onAdd(k.key as EditorBlockType); setOpen(false); }}>
              {k.label}
            </button>
          ))}
          <button className="aq-btn aq-btn-ghost" onClick={() => setOpen(false)}
            dir="auto" style={{ padding: '2px 8px', fontSize: 12, color: 'var(--aq-text-muted)' }}>Cancel</button>
        </span>
      )}
    </div>
  );
}
