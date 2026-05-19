'use client';

import { useState } from 'react';
import { TopBar } from '@/components/layout/TopBar';
import { Modal } from '@/components/ui/Modal';
import { Avatar } from '@/components/ui/Avatar';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatDate } from '@/lib/utils';
import { canDo } from '@/types';
import type { Client, ClientBrand, WorkspaceRole, Profile, ManagerClient } from '@/types';

interface ClientsViewProps {
  clients: Client[];
  members: Profile[];
  managerAssignments: ManagerClient[];
  userRole: WorkspaceRole;
  currentUserId: string;
  pendingClients?: any[];
  onCreateClient: (client: { company_name: string; contact_name: string; contact_email: string; contact_phone: string; industry: string; notes: string }) => void;
  onUpdateClient: (id: string, updates: Partial<Client>) => void;
  onDeleteClient: (id: string) => void;
  onCreateBrand: (clientId: string, brand: { brand_name: string; description: string }) => void;
  onUpdateBrand: (id: string, updates: Partial<ClientBrand>) => void;
  onDeleteBrand: (id: string) => void;
  onAssignManager: (managerId: string, clientId: string) => void;
  onUnassignManager: (assignmentId: string) => void;
  onAcceptClient?: (pendingId: string, pendingData: any) => void;
  onRejectClient?: (pendingId: string) => void;
}

export function ClientsView({
  clients, members, managerAssignments, userRole, currentUserId,
  pendingClients = [],
  onCreateClient, onUpdateClient, onDeleteClient,
  onCreateBrand, onUpdateBrand, onDeleteBrand,
  onAssignManager, onUnassignManager,
  onAcceptClient, onRejectClient,
}: ClientsViewProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [tab, setTab] = useState<'managed' | 'pending'>('managed');
  const [createOpen, setCreateOpen] = useState(false);
  const [editClient, setEditClient] = useState<Client | null>(null);
  const [detailClient, setDetailClient] = useState<Client | null>(null);
  const [brandModalClient, setBrandModalClient] = useState<Client | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<Client | null>(null);

  // Create form
  const [form, setForm] = useState({ company_name: '', contact_name: '', contact_email: '', contact_phone: '', industry: '', notes: '' });
  // Brand form
  const [brandForm, setBrandForm] = useState({ brand_name: '', description: '' });

  const filtered = clients.filter(c =>
    c.company_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.contact_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.contact_email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.id.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getManagersForClient = (clientId: string) => managerAssignments.filter(a => a.client_id === clientId);

  const resetForm = () => setForm({ company_name: '', contact_name: '', contact_email: '', contact_phone: '', industry: '', notes: '' });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TopBar title="Clients" subtitle={`${clients.length} clients`} onSearch={setSearchQuery}
        actions={canDo(userRole, 'create_clients') ? (
          <button className="aq-btn aq-btn-primary" style={{ fontSize: 13 }} onClick={() => { resetForm(); setCreateOpen(true); }}>+ Add Client</button>
        ) : undefined}
      />

      {/* Tabs */}
      {pendingClients.length > 0 && (
        <div style={{ display: 'flex', gap: 4, padding: '0 24px', borderBottom: '1px solid var(--aq-border-light)', background: 'var(--aq-bg-elevated)' }}>
          {[
            { id: 'managed' as const, label: 'Clients', count: clients.length },
            { id: 'pending' as const, label: 'Pending Requests', count: (pendingClients || []).filter((c: any) => !c.review_status || c.review_status === 'pending').length },
          ].map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              padding: '10px 16px', fontSize: 13, fontWeight: tab === t.id ? 600 : 400, background: 'none', border: 'none',
              color: tab === t.id ? 'var(--aq-accent)' : 'var(--aq-text-secondary)',
              borderBottom: tab === t.id ? '2px solid var(--aq-accent)' : '2px solid transparent', cursor: 'pointer',
            }}>
              {t.label} {t.count > 0 && <span style={{ marginLeft: 4, fontSize: 11, background: tab === t.id ? 'var(--aq-accent)18' : 'var(--aq-bg-hover)', padding: '1px 6px', borderRadius: 99 }}>{t.count}</span>}
            </button>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Client list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
          {/* Pending tab */}
          {tab === 'pending' && (() => {
            const pendingOnly = (pendingClients || []).filter((c: any) => !c.review_status || c.review_status === 'pending');
            return pendingOnly.length === 0 ? (
              <EmptyState icon="📋" title="No pending requests" description="Client registration requests from your form will appear here." />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {pendingOnly.map((pc: any) => (
                  <div key={pc.id} className="aq-card" style={{ padding: '16px 20px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{ width: 40, height: 40, borderRadius: 10, background: '#f59e0b18', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, color: '#f59e0b' }}>⏳</div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 15, fontWeight: 600 }}>{pc.company_name || pc.name || 'Unknown'}</div>
                        <div style={{ fontSize: 12, color: 'var(--aq-text-muted)' }}>
                          {pc.email || pc.contact_email || ''} {pc.phone || pc.contact_phone ? `· ${pc.phone || pc.contact_phone}` : ''}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        {onAcceptClient && <button className="aq-btn aq-btn-primary" style={{ fontSize: 12, padding: '5px 14px' }} onClick={() => onAcceptClient(pc.id, pc)}>Accept</button>}
                        {onRejectClient && <button className="aq-btn aq-btn-ghost" style={{ fontSize: 12, padding: '5px 14px', color: 'var(--aq-error)' }} onClick={() => onRejectClient(pc.id)}>Reject</button>}
                      </div>
                    </div>
                    <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '4px 16px', fontSize: 12, color: 'var(--aq-text-secondary)' }}>
                      {Object.entries(pc).filter(([k]) => !['id', 'created_at', 'updated_at', 'review_status', 'reviewed_by', 'reviewed_at'].includes(k)).map(([k, v]) => (
                        v ? <div key={k}><span style={{ color: 'var(--aq-text-muted)' }}>{k.replace(/_/g, ' ')}: </span>{String(v)}</div> : null
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}

          {/* Managed clients tab */}
          {tab === 'managed' && (filtered.length === 0 ? (
            <EmptyState icon="🏢" title="No clients yet" description="Add your first client to start managing their projects and brands."
              action={canDo(userRole, 'create_clients') ? { label: '+ Add Client', onClick: () => { resetForm(); setCreateOpen(true); } } : undefined} />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {filtered.map(client => (
                <div key={client.id} className="aq-card" style={{ padding: '16px 20px', cursor: 'pointer', transition: 'box-shadow var(--aq-transition)' }}
                  onClick={() => setDetailClient(detailClient?.id === client.id ? null : client)}
                  onMouseEnter={(e) => (e.currentTarget.style.boxShadow = 'var(--aq-shadow-md)')}
                  onMouseLeave={(e) => (e.currentTarget.style.boxShadow = 'var(--aq-shadow-sm)')}>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--aq-accent)14', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 600, color: 'var(--aq-accent)' }}>
                      {client.company_name.charAt(0).toUpperCase()}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 15, fontWeight: 600 }}>{client.company_name}</span>
                        <span className="aq-badge" style={{ background: client.status === 'active' ? 'var(--aq-success)18' : 'var(--aq-bg-hover)', color: client.status === 'active' ? 'var(--aq-success)' : 'var(--aq-text-muted)' }}>{client.status}</span>
                      </div>
                      {client.contact_name && <div style={{ fontSize: 12, color: 'var(--aq-text-muted)' }}>{client.contact_name} {client.contact_email ? `· ${client.contact_email}` : ''}</div>}
                    </div>

                    {/* Client ID badge */}
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 10, color: 'var(--aq-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Client ID</div>
                      <div style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--aq-text-secondary)', background: 'var(--aq-bg-sunken)', padding: '2px 6px', borderRadius: 4 }}>{client.id.slice(0, 8)}</div>
                    </div>

                    {/* Brands count */}
                    {client.brands && client.brands.length > 0 && (
                      <div style={{ textAlign: 'center', minWidth: 50 }}>
                        <div style={{ fontSize: 18, fontWeight: 700 }}>{client.brands.length}</div>
                        <div style={{ fontSize: 10, color: 'var(--aq-text-muted)' }}>brands</div>
                      </div>
                    )}

                    {/* Managers */}
                    <div style={{ display: 'flex', gap: -4 }}>
                      {getManagersForClient(client.id).map(a => (
                        <Avatar key={a.id} user={a.manager || null} size="sm" />
                      ))}
                    </div>
                  </div>

                  {/* Expanded detail */}
                  {detailClient?.id === client.id && (
                    <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--aq-border-light)' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '8px 16px', fontSize: 13, marginBottom: 16 }}>
                        <span style={{ color: 'var(--aq-text-muted)', fontWeight: 500 }}>Full ID</span>
                        <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{client.id}</span>
                        {client.contact_phone && <><span style={{ color: 'var(--aq-text-muted)', fontWeight: 500 }}>Phone</span><span>{client.contact_phone}</span></>}
                        {client.industry && <><span style={{ color: 'var(--aq-text-muted)', fontWeight: 500 }}>Industry</span><span>{client.industry}</span></>}
                        {client.notes && <><span style={{ color: 'var(--aq-text-muted)', fontWeight: 500 }}>Notes</span><span>{client.notes}</span></>}
                        <span style={{ color: 'var(--aq-text-muted)', fontWeight: 500 }}>Created</span>
                        <span>{formatDate(client.created_at)}</span>
                      </div>

                      {/* Brands list */}
                      {client.brands && client.brands.length > 0 && (
                        <div style={{ marginBottom: 12 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--aq-text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Brands</div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            {client.brands.map(b => (
                              <span key={b.id} className="aq-badge" style={{ background: 'var(--aq-bg-sunken)', color: 'var(--aq-text-secondary)', padding: '4px 10px', fontSize: 12 }}>
                                {b.brand_name}
                                {canDo(userRole, 'edit_clients') && (
                                  <button onClick={(e) => { e.stopPropagation(); onDeleteBrand(b.id); }}
                                    style={{ marginLeft: 6, background: 'none', border: 'none', color: 'var(--aq-error)', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>×</button>
                                )}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Manager assignments */}
                      {getManagersForClient(client.id).length > 0 && (
                        <div style={{ marginBottom: 12 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--aq-text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Assigned Managers</div>
                          {getManagersForClient(client.id).map(a => (
                            <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                              <Avatar user={a.manager || null} size="sm" />
                              <span style={{ fontSize: 13 }}>{a.manager?.full_name}</span>
                              {canDo(userRole, 'assign_clients') && (
                                <button onClick={(e) => { e.stopPropagation(); onUnassignManager(a.id); }}
                                  style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--aq-error)', cursor: 'pointer', fontSize: 12 }}>Remove</button>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Actions */}
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }} onClick={(e) => e.stopPropagation()}>
                        <button className="aq-btn aq-btn-secondary" style={{ fontSize: 12, padding: '5px 12px' }}
                          onClick={() => setBrandModalClient(client)}>+ Brand</button>

                        {canDo(userRole, 'assign_clients') && (
                          <select className="aq-input" style={{ fontSize: 12, padding: '5px 8px', width: 'auto' }}
                            onChange={(e) => { if (e.target.value) onAssignManager(e.target.value, client.id); e.target.value = ''; }} defaultValue="">
                            <option value="">Assign manager...</option>
                            {members.map(m => <option key={m.id} value={m.id}>{m.full_name}</option>)}
                          </select>
                        )}

                        {canDo(userRole, 'edit_clients') && (
                          <button className="aq-btn aq-btn-secondary" style={{ fontSize: 12, padding: '5px 12px' }}
                            onClick={() => {
                              setForm({
                                company_name: client.company_name, contact_name: client.contact_name || '',
                                contact_email: client.contact_email || '', contact_phone: client.contact_phone || '',
                                industry: client.industry || '', notes: client.notes || '',
                              });
                              setEditClient(client);
                            }}>Edit</button>
                        )}

                        {canDo(userRole, 'edit_clients') && (
                          <button className="aq-btn aq-btn-ghost" style={{ fontSize: 12, padding: '5px 12px', color: 'var(--aq-error)' }}
                            onClick={() => setDeleteConfirm(client)}>Delete</button>
                        )}

                        <button className="aq-btn aq-btn-ghost" style={{ fontSize: 12, padding: '5px 12px', marginLeft: 'auto' }}
                          onClick={() => { navigator.clipboard.writeText(client.id); }}>Copy ID</button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Create Client Modal */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Add Client" width="520px">
        <ClientForm form={form} setForm={setForm} onSubmit={() => { onCreateClient(form as any); resetForm(); setCreateOpen(false); }} onCancel={() => setCreateOpen(false)} submitLabel="Add Client" />
      </Modal>

      {/* Edit Client Modal */}
      <Modal open={!!editClient} onClose={() => setEditClient(null)} title={`Edit ${editClient?.company_name || ''}`} width="520px">
        <ClientForm form={form} setForm={setForm} onSubmit={() => { if (editClient) { onUpdateClient(editClient.id, form as any); setEditClient(null); } }} onCancel={() => setEditClient(null)} submitLabel="Save Changes" />
      </Modal>

      {/* Add Brand Modal */}
      <Modal open={!!brandModalClient} onClose={() => setBrandModalClient(null)} title={`Add Brand — ${brandModalClient?.company_name || ''}`}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--aq-text-muted)', display: 'block', marginBottom: 4 }}>Brand Name *</label>
            <input className="aq-input" value={brandForm.brand_name} onChange={(e) => setBrandForm(f => ({ ...f, brand_name: e.target.value }))} placeholder="e.g. Brand X" autoFocus />
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--aq-text-muted)', display: 'block', marginBottom: 4 }}>Description</label>
            <input className="aq-input" value={brandForm.description} onChange={(e) => setBrandForm(f => ({ ...f, description: e.target.value }))} placeholder="Brief description" />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
            <button className="aq-btn aq-btn-secondary" onClick={() => setBrandModalClient(null)}>Cancel</button>
            <button className="aq-btn aq-btn-primary" disabled={!brandForm.brand_name.trim()} style={{ opacity: brandForm.brand_name.trim() ? 1 : 0.5 }}
              onClick={() => { if (brandModalClient) onCreateBrand(brandModalClient.id, brandForm); setBrandForm({ brand_name: '', description: '' }); setBrandModalClient(null); }}>
              Add Brand
            </button>
          </div>
        </div>
      </Modal>

      {/* Delete Confirm Modal */}
      <Modal open={!!deleteConfirm} onClose={() => setDeleteConfirm(null)} title="Delete Client">
        <div>
          <p style={{ fontSize: 14, marginBottom: 8 }}>Are you sure you want to delete <strong>{deleteConfirm?.company_name}</strong>?</p>
          <p style={{ fontSize: 13, color: 'var(--aq-text-muted)', marginBottom: 20 }}>This will remove all their brands and manager assignments. This cannot be undone.</p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button className="aq-btn aq-btn-secondary" onClick={() => setDeleteConfirm(null)}>Cancel</button>
            <button className="aq-btn aq-btn-primary" style={{ background: 'var(--aq-error)' }}
              onClick={() => { if (deleteConfirm) onDeleteClient(deleteConfirm.id); setDeleteConfirm(null); setDetailClient(null); }}>
              Delete Client
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// Reusable client form
function ClientForm({ form, setForm, onSubmit, onCancel, submitLabel }: {
  form: any; setForm: (fn: any) => void; onSubmit: () => void; onCancel: () => void; submitLabel: string;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--aq-text-muted)', display: 'block', marginBottom: 4 }}>Company Name *</label>
        <input className="aq-input" value={form.company_name} onChange={(e) => setForm((f: any) => ({ ...f, company_name: e.target.value }))} placeholder="e.g. Acme Corp" autoFocus />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--aq-text-muted)', display: 'block', marginBottom: 4 }}>Contact Name</label>
          <input className="aq-input" value={form.contact_name} onChange={(e) => setForm((f: any) => ({ ...f, contact_name: e.target.value }))} placeholder="Primary contact" />
        </div>
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--aq-text-muted)', display: 'block', marginBottom: 4 }}>Phone</label>
          <input className="aq-input" value={form.contact_phone} onChange={(e) => setForm((f: any) => ({ ...f, contact_phone: e.target.value }))} placeholder="+966..." />
        </div>
      </div>
      <div>
        <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--aq-text-muted)', display: 'block', marginBottom: 4 }}>Email</label>
        <input className="aq-input" type="email" value={form.contact_email} onChange={(e) => setForm((f: any) => ({ ...f, contact_email: e.target.value }))} placeholder="contact@company.com" />
      </div>
      <div>
        <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--aq-text-muted)', display: 'block', marginBottom: 4 }}>Industry</label>
        <input className="aq-input" value={form.industry} onChange={(e) => setForm((f: any) => ({ ...f, industry: e.target.value }))} placeholder="e.g. Technology, Healthcare" />
      </div>
      <div>
        <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--aq-text-muted)', display: 'block', marginBottom: 4 }}>Notes</label>
        <textarea className="aq-input" value={form.notes} onChange={(e) => setForm((f: any) => ({ ...f, notes: e.target.value }))} placeholder="Internal notes..." rows={2} style={{ resize: 'vertical', fontFamily: 'inherit' }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
        <button className="aq-btn aq-btn-secondary" onClick={onCancel}>Cancel</button>
        <button className="aq-btn aq-btn-primary" disabled={!form.company_name?.trim()} style={{ opacity: form.company_name?.trim() ? 1 : 0.5 }} onClick={onSubmit}>{submitLabel}</button>
      </div>
    </div>
  );
}
