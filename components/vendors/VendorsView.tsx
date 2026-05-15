'use client';

import { useState } from 'react';
import { TopBar } from '@/components/layout/TopBar';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatDate } from '@/lib/utils';
import { canDo } from '@/types';
import type { WorkspaceRole } from '@/types';

interface ManagedVendor {
  id: string;
  workspace_id: string;
  company_name: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  service_type: string | null;
  industry: string | null;
  address: string | null;
  bank_name: string | null;
  iban: string | null;
  notes: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

interface VendorsViewProps {
  vendors: ManagedVendor[];
  pendingVendors: any[];
  userRole: WorkspaceRole;
  onCreateVendor: (v: Partial<ManagedVendor>) => void;
  onUpdateVendor: (id: string, updates: Partial<ManagedVendor>) => void;
  onDeleteVendor: (id: string) => void;
  onAcceptVendor: (pendingId: string, pendingData: any) => void;
  onRejectVendor: (pendingId: string) => void;
}

const emptyForm = { company_name: '', contact_name: '', contact_email: '', contact_phone: '', service_type: '', industry: '', address: '', bank_name: '', iban: '', notes: '' };

export function VendorsView({
  vendors, pendingVendors, userRole,
  onCreateVendor, onUpdateVendor, onDeleteVendor,
  onAcceptVendor, onRejectVendor,
}: VendorsViewProps) {
  const [tab, setTab] = useState<'managed' | 'pending'>('managed');
  const [searchQuery, setSearchQuery] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editVendor, setEditVendor] = useState<ManagedVendor | null>(null);
  const [detailVendor, setDetailVendor] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<ManagedVendor | null>(null);
  const [form, setForm] = useState(emptyForm);

  const pendingOnly = (pendingVendors || []).filter((v: any) => !v.review_status || v.review_status === 'pending');
  const filtered = vendors.filter(v =>
    v.company_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    v.contact_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    v.id.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TopBar title="Vendors" subtitle={`${vendors.length} vendors`} onSearch={setSearchQuery}
        actions={canDo(userRole, 'create_clients') ? (
          <button className="aq-btn aq-btn-primary" style={{ fontSize: 13 }} onClick={() => { setForm(emptyForm); setCreateOpen(true); }}>+ Add Vendor</button>
        ) : undefined}
      />

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, padding: '0 24px', borderBottom: '1px solid var(--aq-border-light)', background: 'var(--aq-bg-elevated)' }}>
        {[
          { id: 'managed' as const, label: 'Vendors', count: vendors.length },
          { id: 'pending' as const, label: 'Pending Requests', count: pendingOnly.length },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: '10px 16px', fontSize: 13, fontWeight: tab === t.id ? 600 : 400, background: 'none', border: 'none',
            color: tab === t.id ? 'var(--aq-accent)' : 'var(--aq-text-secondary)',
            borderBottom: tab === t.id ? '2px solid var(--aq-accent)' : '2px solid transparent',
            cursor: 'pointer',
          }}>
            {t.label} {t.count > 0 && <span style={{ marginLeft: 4, fontSize: 11, background: tab === t.id ? 'var(--aq-accent)18' : 'var(--aq-bg-hover)', padding: '1px 6px', borderRadius: 99 }}>{t.count}</span>}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
        {/* Managed vendors */}
        {tab === 'managed' && (
          filtered.length === 0 ? (
            <EmptyState icon="🏭" title="No vendors yet" description="Add your first vendor or accept one from pending requests."
              action={canDo(userRole, 'create_clients') ? { label: '+ Add Vendor', onClick: () => { setForm(emptyForm); setCreateOpen(true); } } : undefined} />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {filtered.map(v => (
                <div key={v.id} className="aq-card" style={{ padding: '16px 20px', cursor: 'pointer', transition: 'box-shadow var(--aq-transition)' }}
                  onClick={() => setDetailVendor(detailVendor === v.id ? null : v.id)}
                  onMouseEnter={(e) => (e.currentTarget.style.boxShadow = 'var(--aq-shadow-md)')}
                  onMouseLeave={(e) => (e.currentTarget.style.boxShadow = 'var(--aq-shadow-sm)')}>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 40, height: 40, borderRadius: 10, background: '#14b8a618', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 600, color: '#14b8a6' }}>
                      {v.company_name.charAt(0).toUpperCase()}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 15, fontWeight: 600 }}>{v.company_name}</span>
                        {v.service_type && <span className="aq-badge" style={{ background: 'var(--aq-bg-sunken)', color: 'var(--aq-text-secondary)' }}>{v.service_type}</span>}
                      </div>
                      {v.contact_name && <div style={{ fontSize: 12, color: 'var(--aq-text-muted)' }}>{v.contact_name} {v.contact_email ? `· ${v.contact_email}` : ''}</div>}
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 10, color: 'var(--aq-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Vendor ID</div>
                      <div style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--aq-text-secondary)', background: 'var(--aq-bg-sunken)', padding: '2px 6px', borderRadius: 4 }}>{v.id.slice(0, 8)}</div>
                    </div>
                  </div>

                  {detailVendor === v.id && (
                    <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--aq-border-light)' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '8px 16px', fontSize: 13, marginBottom: 16 }}>
                        <span style={{ color: 'var(--aq-text-muted)', fontWeight: 500 }}>Full ID</span>
                        <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{v.id}</span>
                        {v.contact_phone && <><span style={{ color: 'var(--aq-text-muted)', fontWeight: 500 }}>Phone</span><span>{v.contact_phone}</span></>}
                        {v.address && <><span style={{ color: 'var(--aq-text-muted)', fontWeight: 500 }}>Address</span><span>{v.address}</span></>}
                        {v.bank_name && <><span style={{ color: 'var(--aq-text-muted)', fontWeight: 500 }}>Bank</span><span>{v.bank_name}</span></>}
                        {v.iban && <><span style={{ color: 'var(--aq-text-muted)', fontWeight: 500 }}>IBAN</span><span>{v.iban}</span></>}
                        {v.notes && <><span style={{ color: 'var(--aq-text-muted)', fontWeight: 500 }}>Notes</span><span>{v.notes}</span></>}
                        <span style={{ color: 'var(--aq-text-muted)', fontWeight: 500 }}>Created</span><span>{formatDate(v.created_at)}</span>
                      </div>
                      <div style={{ display: 'flex', gap: 8 }} onClick={(e) => e.stopPropagation()}>
                        {canDo(userRole, 'edit_clients') && (
                          <button className="aq-btn aq-btn-secondary" style={{ fontSize: 12, padding: '5px 12px' }}
                            onClick={() => { setForm({ company_name: v.company_name, contact_name: v.contact_name || '', contact_email: v.contact_email || '', contact_phone: v.contact_phone || '', service_type: v.service_type || '', industry: v.industry || '', address: v.address || '', bank_name: v.bank_name || '', iban: v.iban || '', notes: v.notes || '' }); setEditVendor(v); }}>
                            Edit
                          </button>
                        )}
                        {canDo(userRole, 'edit_clients') && (
                          <button className="aq-btn aq-btn-ghost" style={{ fontSize: 12, padding: '5px 12px', color: 'var(--aq-error)' }}
                            onClick={() => setDeleteConfirm(v)}>Delete</button>
                        )}
                        <button className="aq-btn aq-btn-ghost" style={{ fontSize: 12, padding: '5px 12px', marginLeft: 'auto' }}
                          onClick={() => navigator.clipboard.writeText(v.id)}>Copy ID</button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )
        )}

        {/* Pending vendors */}
        {tab === 'pending' && (
          pendingOnly.length === 0 ? (
            <EmptyState icon="📋" title="No pending requests" description="Vendor registration requests from your form will appear here." />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {pendingOnly.map((pv: any) => (
                <div key={pv.id} className="aq-card" style={{ padding: '16px 20px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 40, height: 40, borderRadius: 10, background: '#f59e0b18', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, color: '#f59e0b' }}>⏳</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 15, fontWeight: 600 }}>{pv.company_name || pv.name || 'Unknown'}</div>
                      <div style={{ fontSize: 12, color: 'var(--aq-text-muted)' }}>
                        {pv.email || pv.contact_email || ''} {pv.phone || pv.contact_phone ? `· ${pv.phone || pv.contact_phone}` : ''}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="aq-btn aq-btn-primary" style={{ fontSize: 12, padding: '5px 14px' }}
                        onClick={() => onAcceptVendor(pv.id, pv)}>Accept</button>
                      <button className="aq-btn aq-btn-ghost" style={{ fontSize: 12, padding: '5px 14px', color: 'var(--aq-error)' }}
                        onClick={() => onRejectVendor(pv.id)}>Reject</button>
                    </div>
                  </div>
                  {/* Show all fields */}
                  <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '4px 16px', fontSize: 12, color: 'var(--aq-text-secondary)' }}>
                    {Object.entries(pv).filter(([k]) => !['id', 'created_at', 'updated_at', 'review_status', 'reviewed_by', 'reviewed_at'].includes(k)).map(([k, v]) => (
                      v ? <div key={k}><span style={{ color: 'var(--aq-text-muted)' }}>{k.replace(/_/g, ' ')}: </span>{String(v)}</div> : null
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )
        )}
      </div>

      {/* Create/Edit Modal */}
      <Modal open={createOpen || !!editVendor} onClose={() => { setCreateOpen(false); setEditVendor(null); }} title={editVendor ? `Edit ${editVendor.company_name}` : 'Add Vendor'} width="560px">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--aq-text-muted)', display: 'block', marginBottom: 4 }}>Company Name *</label>
            <input className="aq-input" value={form.company_name} onChange={(e) => setForm(f => ({ ...f, company_name: e.target.value }))} placeholder="Vendor company name" autoFocus />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--aq-text-muted)', display: 'block', marginBottom: 4 }}>Contact Name</label>
              <input className="aq-input" value={form.contact_name} onChange={(e) => setForm(f => ({ ...f, contact_name: e.target.value }))} />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--aq-text-muted)', display: 'block', marginBottom: 4 }}>Phone</label>
              <input className="aq-input" value={form.contact_phone} onChange={(e) => setForm(f => ({ ...f, contact_phone: e.target.value }))} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--aq-text-muted)', display: 'block', marginBottom: 4 }}>Email</label>
              <input className="aq-input" value={form.contact_email} onChange={(e) => setForm(f => ({ ...f, contact_email: e.target.value }))} />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--aq-text-muted)', display: 'block', marginBottom: 4 }}>Service Type</label>
              <input className="aq-input" value={form.service_type} onChange={(e) => setForm(f => ({ ...f, service_type: e.target.value }))} placeholder="e.g. Photography, Design" />
            </div>
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--aq-text-muted)', display: 'block', marginBottom: 4 }}>Address</label>
            <input className="aq-input" value={form.address} onChange={(e) => setForm(f => ({ ...f, address: e.target.value }))} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--aq-text-muted)', display: 'block', marginBottom: 4 }}>Bank Name</label>
              <input className="aq-input" value={form.bank_name} onChange={(e) => setForm(f => ({ ...f, bank_name: e.target.value }))} />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--aq-text-muted)', display: 'block', marginBottom: 4 }}>IBAN</label>
              <input className="aq-input" value={form.iban} onChange={(e) => setForm(f => ({ ...f, iban: e.target.value }))} />
            </div>
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--aq-text-muted)', display: 'block', marginBottom: 4 }}>Notes</label>
            <textarea className="aq-input" value={form.notes} onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} style={{ resize: 'vertical', fontFamily: 'inherit' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
            <button className="aq-btn aq-btn-secondary" onClick={() => { setCreateOpen(false); setEditVendor(null); }}>Cancel</button>
            <button className="aq-btn aq-btn-primary" disabled={!form.company_name.trim()} style={{ opacity: form.company_name.trim() ? 1 : 0.5 }}
              onClick={() => {
                if (editVendor) { onUpdateVendor(editVendor.id, form); setEditVendor(null); }
                else { onCreateVendor(form); setCreateOpen(false); }
                setForm(emptyForm);
              }}>
              {editVendor ? 'Save Changes' : 'Add Vendor'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Delete Confirm */}
      <Modal open={!!deleteConfirm} onClose={() => setDeleteConfirm(null)} title="Delete Vendor">
        <p style={{ fontSize: 14, marginBottom: 8 }}>Delete <strong>{deleteConfirm?.company_name}</strong>?</p>
        <p style={{ fontSize: 13, color: 'var(--aq-text-muted)', marginBottom: 20 }}>This cannot be undone.</p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="aq-btn aq-btn-secondary" onClick={() => setDeleteConfirm(null)}>Cancel</button>
          <button className="aq-btn aq-btn-primary" style={{ background: 'var(--aq-error)' }}
            onClick={() => { if (deleteConfirm) onDeleteVendor(deleteConfirm.id); setDeleteConfirm(null); setDetailVendor(null); }}>Delete</button>
        </div>
      </Modal>
    </div>
  );
}
