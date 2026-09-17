'use client';

import { useState } from 'react';
import { useContracts, usePublishedVersions } from '@/hooks/use-legal';
import { kindLabel, contractStatusLabel, contractStatusBadge } from '@/lib/legal';
import { AqDrawingBlock } from '@/components/AQLoading';
import { ContractFill } from '@/components/workflow/legal/ContractFill';

/**
 * The Register: every contract generated from a template, each stamped to the
 * exact version it was made from. "New contract" starts one from a published
 * version and drops into the fill screen. A contract that is still a draft can
 * be reopened and edited; issued ones are frozen but still open read-only.
 */
export function LegalRegister({ workspaceId }: { workspaceId?: string }) {
  const { contracts, loading, error, create, remove } = useContracts(workspaceId ?? null);
  const pub = usePublishedVersions(workspaceId ?? null);

  const [openId, setOpenId] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [versionId, setVersionId] = useState('');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState('');

  if (openId) {
    return <ContractFill workspaceId={workspaceId} contractId={openId} onBack={() => setOpenId(null)} />;
  }

  const startNew = async () => {
    const v = pub.versions.find((x) => x.version_id === versionId);
    if (!v) { setFormErr('Pick a template.'); return; }
    if (!title.trim()) { setFormErr('Give the contract a title.'); return; }
    setBusy(true); setFormErr('');
    try {
      const id = await create(v.version_id, v.template_id, title);
      setPicking(false); setTitle(''); setVersionId('');
      setOpenId(id);
    } catch (e: any) {
      setFormErr(e?.message ?? 'Could not create the contract.');
    } finally { setBusy(false); }
  };

  return (
    <div className="aq-view" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button className="aq-btn aq-btn-primary" onClick={() => { setPicking(true); setFormErr(''); }}
          disabled={pub.loading}>
          New contract
        </button>
      </div>

      {error && <div className="aq-badge aq-badge-error" style={{ display: 'block', padding: 10 }}>{error}</div>}

      {loading ? (
        <div className="aq-card" style={{ padding: 8 }}><AqDrawingBlock label={'Loading contracts\u2026'} /></div>
      ) : contracts.length === 0 ? (
        <div className="aq-card" style={{ padding: 28, textAlign: 'center' }}>
          <p style={{ color: 'var(--aq-text-secondary)', fontSize: 14 }}>No contracts yet.</p>
          <p style={{ color: 'var(--aq-text-muted)', fontSize: 13, marginTop: 6 }}>
            Create one from a published template - it stays stamped to that exact version.
          </p>
        </div>
      ) : (
        <section className="aq-card" style={{ padding: 18 }}>
          <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column' }}>
            {contracts.map((c, i) => (
              <li key={c.id} style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '10px 4px',
                borderTop: i === 0 ? 'none' : '1px solid var(--aq-border-light)',
              }}>
                <span role="button" tabIndex={0} onClick={() => setOpenId(c.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenId(c.id); } }}
                  style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}>
                  <span style={{ fontSize: 14, fontWeight: 600, display: 'block' }}>{c.title || '(untitled)'}</span>
                  <span style={{ fontSize: 12, color: 'var(--aq-text-muted)' }}>
                    {c.template_name} {'\u00b7'} {kindLabel(c.doc_kind)}
                  </span>
                </span>
                <span className={`aq-badge ${contractStatusBadge(c.status)}`}>{contractStatusLabel(c.status)}</span>
                {c.status === 'draft' && (
                  <button className="aq-btn aq-btn-ghost" title="Delete draft" style={{ padding: '4px 8px' }}
                    onClick={async () => { if (confirm('Delete this draft contract?')) await remove(c.id); }}>
                    &times;
                  </button>
                )}
                <span role="button" tabIndex={0} onClick={() => setOpenId(c.id)}
                  style={{ fontSize: 14, color: 'var(--aq-text-muted)', cursor: 'pointer' }}>&rsaquo;</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {picking && (
        <div role="dialog" aria-modal="true" style={{
          position: 'fixed', inset: 0, background: 'var(--aq-backdrop, rgba(0,0,0,0.4))',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16,
        }} onClick={() => !busy && setPicking(false)}>
          <div className="aq-card" style={{ padding: 22, width: 'min(480px, 100%)' }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 14 }}>New contract</h3>
            {pub.versions.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--aq-text-muted)' }}>
                No published templates yet. Publish a template version first, then a contract can be made from it.
              </p>
            ) : (
              <>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--aq-text-muted)', marginBottom: 4 }}>Template</label>
                <select className="aq-select" value={versionId} onChange={(e) => setVersionId(e.target.value)} style={{ width: '100%' }} autoFocus>
                  <option value="">{'-- choose a published template --'}</option>
                  {pub.versions.map((v) => (
                    <option key={v.version_id} value={v.version_id}>
                      {v.template_name} (v{v.version}) {'\u2014'} {kindLabel(v.doc_kind)}
                    </option>
                  ))}
                </select>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--aq-text-muted)', margin: '14px 0 4px' }}>Title</label>
                <input className="aq-input" value={title} onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Vendor agreement - Rawad Media" style={{ width: '100%' }} />
              </>
            )}
            {formErr && <div className="aq-badge aq-badge-error" style={{ display: 'block', marginTop: 12, padding: 8 }}>{formErr}</div>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18 }}>
              <button className="aq-btn aq-btn-ghost" onClick={() => setPicking(false)} disabled={busy}>Cancel</button>
              {pub.versions.length > 0 && (
                <button className="aq-btn aq-btn-primary" onClick={startNew} disabled={busy || !versionId || !title.trim()}>
                  {busy ? 'Creating\u2026' : 'Create'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
