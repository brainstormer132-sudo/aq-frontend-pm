'use client';

import { useMemo, useState } from 'react';
import { useLegalTemplates } from '@/hooks/use-legal';
import {
  DOC_KINDS, kindLabel, statusLabel, statusBadge, groupTemplatesByKind, validateNewTemplate,
  type DocKind,
} from '@/lib/legal';
import { AqDrawingBlock } from '@/components/AQLoading';
import { LegalEditor } from '@/components/workflow/legal/LegalEditor';

/**
 * Documents: the editable templates, grouped by kind, with a create action.
 * Slice 1 of the editable-document milestone - list + create the template and
 * its first draft. Opening a template into the block editor comes next.
 */
export function LegalDocuments({ workspaceId }: { workspaceId?: string }) {
  const { templates, loading, error, createTemplate } = useLegalTemplates(workspaceId ?? null);
  const groups = useMemo(() => groupTemplatesByKind(templates), [templates]);

  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<DocKind>('vendor_contract');
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

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
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button className="aq-btn aq-btn-primary" onClick={() => { setOpen(true); setFormErr(''); }}>
          New template
        </button>
      </div>

      {error && <div className="aq-badge aq-badge-error" style={{ display: 'block', padding: 10 }}>{error}</div>}

      {loading ? (
        <div className="aq-card" style={{ padding: 8 }}><AqDrawingBlock label={'Loading templates\u2026'} /></div>
      ) : templates.length === 0 ? (
        <div className="aq-card" style={{ padding: 28, textAlign: 'center' }}>
          <p style={{ color: 'var(--aq-text-secondary)', fontSize: 14 }}>No document templates yet.</p>
          <p style={{ color: 'var(--aq-text-muted)', fontSize: 13, marginTop: 6 }}>
            Create one to start - a vendor contract, an NDA, a client contract, or anything else.
          </p>
        </div>
      ) : (
        groups.map((g) => (
          <section key={g.key} className="aq-card" style={{ padding: 18 }}>
            <h3 style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase',
              color: 'var(--aq-text-muted)', marginBottom: 10 }}>{g.label}</h3>
            <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column' }}>
              {g.items.map((t, i) => (
                <li key={t.id} role="button" tabIndex={0} onClick={() => setOpenId(t.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenId(t.id); } }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12, padding: '10px 4px', cursor: 'pointer',
                    borderTop: i === 0 ? 'none' : '1px solid var(--aq-border-light)',
                  }}>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 14, fontWeight: 600, display: 'block' }}>{t.name}</span>
                    {t.description ? (
                      <span style={{ fontSize: 12, color: 'var(--aq-text-muted)' }}>{t.description}</span>
                    ) : null}
                  </span>
                  {t.latest_version ? (
                    <span style={{ fontSize: 12, color: 'var(--aq-text-muted)' }}>v{t.latest_version}</span>
                  ) : null}
                  <span className={`aq-badge ${statusBadge(t.latest_status)}`}>{statusLabel(t.latest_status)}</span>
                  <span style={{ fontSize: 14, color: 'var(--aq-text-muted)' }}>&rsaquo;</span>
                </li>
              ))}
            </ul>
          </section>
        ))
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
    </div>
  );
}
