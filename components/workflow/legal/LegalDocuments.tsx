'use client';

import { useMemo, useRef, useState } from 'react';
import {
  useLegalTemplates, parseDocxFile, saveImportedTemplate, type ParsedDocx,
} from '@/hooks/use-legal';
import {
  DOC_KINDS, kindLabel, statusLabel, statusBadge, groupTemplatesByKind, validateNewTemplate,
  splitTemplates, archivedNote, archivedToggleLabel, archiveConfirm,
  type DocKind, type LegalTemplateLite,
} from '@/lib/legal';
import { AqDrawingBlock } from '@/components/AQLoading';
import { LegalEditor } from '@/components/workflow/legal/LegalEditor';
import { useConfirm } from '@/components/ui/ConfirmDialog';

/**
 * Documents: the editable templates, grouped by kind.
 *
 * Two ways in. "Upload a Word template" is the one Siraj asked for - "i need
 * uploading a template to be seemless and work as easy as possible and as
 * self explanitary as posiible" - and "New template" is the old empty start,
 * kept for a document nobody has in Word yet.
 *
 * THE UPLOAD IS TWO STEPS ON PURPOSE. The file is read and described BEFORE
 * anything is written: "41 blocks, 10 headings, a table with 4 columns, 15
 * fields", and any warnings. A parse can be subtly wrong, and the only moment
 * anybody will ever check is the moment before they press save. Nothing
 * reaches the database or the bucket until they do.
 *
 * -- RETIRE, NOT DELETE ----------------------------------------------
 *
 * Siraj: "also we cant delete any templates." There was no button, and there
 * could not have been much of one: legal.contract holds template_id and
 * version_id ON DELETE RESTRICT (100), and 098's freeze refuses to delete a
 * published version at all. A template any contract was ever made from is
 * permanent, and that permanence is what makes an issued contract's number
 * and fingerprint mean anything.
 *
 * So Retire (119). It takes the template out of this list and out of the
 * new-contract picker and changes nothing else - no version, no block, no
 * issued contract - and Restore brings it back. The retired ones live in a
 * drawer at the bottom rather than a separate screen, because "where did it
 * go" is a question a drawer answers and a screen somebody has to be told
 * about does not.
 */
export function LegalDocuments({ workspaceId }: { workspaceId?: string }) {
  const { templates, loading, error, createTemplate, setArchived } = useLegalTemplates(workspaceId ?? null);
  // Split FIRST, then group each half. Grouping the whole list and filtering
  // inside would leave a kind heading standing over nothing.
  const split = useMemo(() => splitTemplates(templates), [templates]);
  const groups = useMemo(() => groupTemplatesByKind(split.active), [split.active]);

  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<DocKind>('vendor_contract');
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const { ask, dialog } = useConfirm();
  const [showRetired, setShowRetired] = useState(false);
  const [retiring, setRetiring] = useState('');
  const [retireErr, setRetireErr] = useState('');

  /** Retire or restore one. The confirm is only on the way OUT: restoring is
   *  putting something back, and nothing needs permission to be undone. */
  const retire = async (t: LegalTemplateLite, archived: boolean) => {
    if (archived && !await ask({
      message: archiveConfirm(t), confirmLabel: 'Retire it', tone: 'danger',
    })) return;
    setRetiring(t.id); setRetireErr('');
    try { await setArchived(t.id, archived); }
    catch (e: any) { setRetireErr(e?.message ?? 'Could not change that template.'); }
    finally { setRetiring(''); }
  };

  // The upload, in the order it happens: pick a file, read it, name it, save.
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [reading, setReading] = useState(false);
  const [parsed, setParsed] = useState<ParsedDocx | null>(null);
  const [impName, setImpName] = useState('');
  const [impKind, setImpKind] = useState<DocKind>('vendor_contract');
  const [impErr, setImpErr] = useState('');

  const pick = async (f: File | null | undefined) => {
    if (!f) return;
    setReading(true); setImpErr('');
    try {
      const p = await parseDocxFile(f);
      setParsed(p);
      // The document's own title, or the file name without its extension -
      // she should not have to type a name she has already written twice.
      setImpName(p.summary.title || f.name.replace(/\.docx$/i, ''));
    } catch (e: any) {
      setImpErr(e?.message ?? 'That file could not be read.');
    } finally {
      setReading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const saveImport = async () => {
    if (!parsed || !workspaceId) return;
    setBusy(true); setImpErr('');
    try {
      const id = await saveImportedTemplate({
        workspaceId, name: impName, kind: impKind, parsed,
      });
      setParsed(null); setImpName('');
      setOpenId(id);   // straight into the editor on the new draft
    } catch (e: any) {
      setImpErr(e?.message ?? 'Could not save that template.');
    } finally { setBusy(false); }
  };

  const submit = async () => {
    const v = validateNewTemplate(name, kind);
    if (v) { setFormErr(v); return; }
    setBusy(true); setFormErr('');
    try {
      const id = await createTemplate(name, kind);
      setName(''); setKind('vendor_contract'); setOpen(false);
      setOpenId(id); // drop straight into the editor on the fresh draft
    } catch (e: any) {
      setFormErr(e?.message ?? 'Could not create the template.');
    } finally { setBusy(false); }
  };

  if (openId) {
    return <LegalEditor workspaceId={workspaceId} templateId={openId} onBack={() => setOpenId(null)} />;
  }

  return (
    <div className="aq-view" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <input ref={fileRef} type="file" accept=".docx" style={{ display: 'none' }}
          onChange={(e) => void pick(e.target.files?.[0])} />
        <button className="aq-btn aq-btn-ghost" onClick={() => setOpen(true)}>
          New template
        </button>
        <button className="aq-btn aq-btn-primary" disabled={reading}
          onClick={() => { setImpErr(''); fileRef.current?.click(); }}>
          {reading ? 'Reading\u2026' : 'Upload a Word template'}
        </button>
      </div>

      {impErr && !parsed && (
        <div className="aq-badge aq-badge-error" style={{ display: 'block', padding: 10 }}>{impErr}</div>
      )}

      {error && <div className="aq-badge aq-badge-error" style={{ display: 'block', padding: 10 }}>{error}</div>}
      {retireErr && <div className="aq-badge aq-badge-error" style={{ display: 'block', padding: 10 }}>{retireErr}</div>}

      {loading ? (
        <div className="aq-card" style={{ padding: 8 }}><AqDrawingBlock label={'Loading templates\u2026'} /></div>
      ) : split.active.length === 0 ? (
        <div className="aq-card" style={{ padding: 28, textAlign: 'center' }}>
          <p style={{ color: 'var(--aq-text-secondary)', fontSize: 14 }}>
            {split.archived.length ? 'Every template is retired.' : 'No document templates yet.'}
          </p>
          <p style={{ color: 'var(--aq-text-muted)', fontSize: 13, marginTop: 6 }}>
            {split.archived.length
              ? 'Restore one from the drawer below, or start a new one.'
              : 'Create one to start - a vendor contract, an NDA, a client contract, or anything else.'}
          </p>
        </div>
      ) : (
        groups.map((g) => (
          <section key={g.key} className="aq-card" style={{ padding: 18 }}>
            <h3 style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase',
              color: 'var(--aq-text-muted)', marginBottom: 10 }}>{g.label}</h3>
            <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column' }}>
              {g.items.map((t, i) => (
                <li key={t.id} style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '10px 4px',
                  borderTop: i === 0 ? 'none' : '1px solid var(--aq-border-light)',
                }}>
                  {/* The NAME opens the editor, not the whole row: a Retire
                      button inside a clickable row is one mis-aimed click
                      away from opening the thing you meant to put away. */}
                  <span role="button" tabIndex={0} onClick={() => setOpenId(t.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenId(t.id); } }}
                    style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}>
                    <span style={{ fontSize: 14, fontWeight: 600, display: 'block' }}>{t.name}</span>
                    {t.description ? (
                      <span style={{ fontSize: 12, color: 'var(--aq-text-muted)' }}>{t.description}</span>
                    ) : null}
                  </span>
                  {t.latest_version ? (
                    <span style={{ fontSize: 12, color: 'var(--aq-text-muted)' }}>v{t.latest_version}</span>
                  ) : null}
                  <span className={`aq-badge ${statusBadge(t.latest_status)}`}>{statusLabel(t.latest_status)}</span>
                  <button className="aq-btn aq-btn-ghost" style={{ padding: '4px 10px', whiteSpace: 'nowrap' }}
                    disabled={retiring === t.id} title="Take it out of this list and the new-contract picker"
                    onClick={() => void retire(t, true)}>
                    {retiring === t.id ? 'Retiring\u2026' : 'Retire'}
                  </button>
                  <span role="button" tabIndex={0} onClick={() => setOpenId(t.id)}
                    style={{ fontSize: 14, color: 'var(--aq-text-muted)', cursor: 'pointer' }}>&rsaquo;</span>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      {/* The drawer. Not a separate screen: "where did it go" is a question a
          drawer answers and a screen somebody has to be told about does not. */}
      {!loading && split.archived.length > 0 && (
        <section className="aq-card" style={{ padding: 18 }}>
          <button className="aq-btn aq-btn-ghost" style={{ padding: 0 }}
            onClick={() => setShowRetired((v) => !v)}>
            {archivedToggleLabel(split.archived.length, showRetired)}
          </button>
          {showRetired && (
            <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', marginTop: 12 }}>
              {split.archived.map((t, i) => (
                <li key={t.id} style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '10px 4px', opacity: 0.75,
                  borderTop: i === 0 ? 'none' : '1px solid var(--aq-border-light)',
                }}>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 14, fontWeight: 600, display: 'block' }}>{t.name}</span>
                    <span style={{ fontSize: 12, color: 'var(--aq-text-muted)' }}>
                      {kindLabel(t.doc_kind)}
                      {archivedNote(t) ? ` \u00b7 ${archivedNote(t)}` : ''}
                    </span>
                  </span>
                  <button className="aq-btn aq-btn-ghost" style={{ padding: '4px 10px', whiteSpace: 'nowrap' }}
                    disabled={retiring === t.id} onClick={() => void retire(t, false)}>
                    {retiring === t.id ? 'Restoring\u2026' : 'Restore'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {parsed && (
        <ImportReview
          parsed={parsed}
          name={impName} onName={setImpName}
          kind={impKind} onKind={setImpKind}
          err={impErr} busy={busy}
          onCancel={() => { setParsed(null); setImpErr(''); }}
          onSave={saveImport}
        />
      )}

      {open && (
        <div role="dialog" aria-modal="true" style={{
          position: 'fixed', inset: 0, background: 'var(--aq-backdrop, rgba(0,0,0,0.4))',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16,
        }} onClick={() => !busy && setOpen(false)}>
          <div className="aq-card" style={{ padding: 22, width: 'min(460px, 100%)' }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 14 }}>New document template</h3>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--aq-text-muted)', marginBottom: 4 }}>Name</label>
            <input className="aq-input" value={name} onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Standard vendor agreement" style={{ width: '100%' }} autoFocus />
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--aq-text-muted)', margin: '14px 0 4px' }}>Type</label>
            <select className="aq-select" value={kind} onChange={(e) => setKind(e.target.value as DocKind)} style={{ width: '100%' }}>
              {DOC_KINDS.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
            </select>
            {formErr && <div className="aq-badge aq-badge-error" style={{ display: 'block', marginTop: 12, padding: 8 }}>{formErr}</div>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18 }}>
              <button className="aq-btn aq-btn-ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
              <button className="aq-btn aq-btn-primary" onClick={submit} disabled={busy || !name.trim()}>
                {busy ? 'Creating\u2026' : 'Create'}
              </button>
            </div>
            <p style={{ fontSize: 11.5, color: 'var(--aq-text-muted)', marginTop: 12 }}>
              A template starts as a {kindLabel(kind).toLowerCase()} draft (v1). You edit its wording and publish it next.
            </p>
          </div>
        </div>
      )}
      {dialog}
    </div>
  );
}

/**
 * What the file turned out to be, before any of it is saved.
 *
 * Siraj: "as self explanitary as posiible". So this does NOT show a block
 * tree. It says what came out in a sentence anybody can check against the
 * document they just uploaded - a count per kind of block, the fields it
 * found, and anything worth a second look - and then asks for the two things
 * the app cannot work out on its own: what to call it and what kind it is.
 *
 * The fields are listed IN THE ORDER THEY APPEAR in the document, because the
 * document is what she will be reading down while she checks them.
 */
function ImportReview({ parsed, name, onName, kind, onKind, err, busy, onCancel, onSave }: {
  parsed: ParsedDocx;
  name: string; onName: (s: string) => void;
  kind: DocKind; onKind: (k: DocKind) => void;
  err: string; busy: boolean;
  onCancel: () => void;
  onSave: () => void;
}) {
  const s = parsed.summary;
  const bits = [
    `${s.blocks} block${s.blocks === 1 ? '' : 's'}`,
    s.headings ? `${s.headings} heading${s.headings === 1 ? '' : 's'}` : '',
    s.paragraphs ? `${s.paragraphs} paragraph${s.paragraphs === 1 ? '' : 's'}` : '',
    s.listItems ? `${s.listItems} list item${s.listItems === 1 ? '' : 's'}` : '',
    s.tables ? `${s.tables} table${s.tables === 1 ? '' : 's'}` : '',
  ].filter(Boolean).join(', ');
  const label = { display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--aq-text-muted)', marginBottom: 4 } as const;

  return (
    <div role="dialog" aria-modal="true" style={{
      position: 'fixed', inset: 0, background: 'var(--aq-backdrop, rgba(0,0,0,0.4))',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16,
    }} onClick={() => !busy && onCancel()}>
      <div className="aq-card" style={{ padding: 22, width: 'min(560px, 100%)', maxHeight: '86vh', overflowY: 'auto' }}
        onClick={(e) => e.stopPropagation()}>
        <h3 style={{ fontSize: 16, fontWeight: 700 }}>{parsed.file.name}</h3>
        <p style={{ fontSize: 13.5, color: 'var(--aq-text-secondary)', marginTop: 6 }}>
          Read {bits}.
        </p>

        {s.placeholders.length > 0 ? (
          <div style={{ marginTop: 12 }}>
            <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--aq-text-muted)' }}>
              {s.placeholders.length} field{s.placeholders.length === 1 ? '' : 's'} found
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
              {s.placeholders.map((p) => (
                <code key={p} style={{
                  fontSize: 12, padding: '2px 7px', borderRadius: 6, direction: 'ltr',
                  background: 'var(--aq-surface-2, #f2f2f2)',
                }}>{`{{ ${p} }}`}</code>
              ))}
            </div>
          </div>
        ) : null}

        {s.warnings.length > 0 && (
          <ul style={{ listStyle: 'none', marginTop: 12 }}>
            {s.warnings.map((w) => (
              <li key={w} style={{ fontSize: 12.5, color: 'var(--aq-text-muted)', padding: '3px 0' }}>
                {'\u2022'} {w}
              </li>
            ))}
          </ul>
        )}

        <label style={{ ...label, marginTop: 16 }}>Name</label>
        <input className="aq-input" value={name} onChange={(e) => onName(e.target.value)}
          style={{ width: '100%' }} disabled={busy} autoFocus />

        <label style={{ ...label, marginTop: 14 }}>What kind of document is this?</label>
        <select className="aq-select" value={kind} disabled={busy}
          onChange={(e) => onKind(e.target.value as DocKind)} style={{ width: '100%' }}>
          {DOC_KINDS.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
        </select>

        {err && <div className="aq-badge aq-badge-error" style={{ display: 'block', marginTop: 12, padding: 8 }}>{err}</div>}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18 }}>
          <button className="aq-btn aq-btn-ghost" onClick={onCancel} disabled={busy}>Cancel</button>
          <button className="aq-btn aq-btn-primary" onClick={onSave} disabled={busy || !name.trim()}>
            {busy ? 'Saving\u2026' : 'Save and open'}
          </button>
        </div>
        <p style={{ fontSize: 11.5, color: 'var(--aq-text-muted)', marginTop: 12 }}>
          It saves as a draft (v1) and opens in the editor, so you can fix anything
          that came out wrong and place more {'{{ fields }}'} before publishing. The
          Word file is kept with the template.
        </p>
      </div>
    </div>
  );
}
