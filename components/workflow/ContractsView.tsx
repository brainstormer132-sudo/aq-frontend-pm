'use client';

import { useState } from 'react';
import {
  generateContractRequest,
  useContractRequests,
  updateContractRequestStatus,
  type ContractRequestStatus,
  type WorkspaceRole,
} from '@/hooks/use-workflow';

export function ContractsView({
  workspaceId, role, onOpenTask,
}: {
  workspaceId: string;
  role: WorkspaceRole | null;
  onOpenTask: (taskId: string) => void;
}) {
  const { items, refetch } = useContractRequests(workspaceId);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const canManage = Boolean(role && ['owner','admin','marketing','key_account'].includes(role));
  const byStatus = (status: ContractRequestStatus) => items.filter((r) => r.status === status);

  const setStatus = async (id: string, status: ContractRequestStatus) => {
    setBusyId(id);
    setError('');
    setMessage('');
    try {
      await updateContractRequestStatus(id, status);
      await refetch();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusyId(null);
    }
  };

  const generateNow = async (id: string) => {
    setBusyId(id);
    setError('');
    setMessage('');
    try {
      const result = await generateContractRequest(id);
      await refetch();
      setMessage(
        result.pdf_error
          ? `DOCX generated (${result.contract_id}); PDF failed: ${result.pdf_error}`
          : `Generated ${result.contract_id}`
      );
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {error && <div className="aq-badge aq-badge-error">{error}</div>}
      {message && <div className="aq-badge aq-badge-success">{message}</div>}

      <p style={{ fontSize: 13, color: 'var(--aq-text-muted)' }}>
        Contract requests submitted from tasks. Generate uses the contract backend and auto-picks
        the template from the request type. If a template file is missing, the error will say which one.
      </p>

      <Bucket title="Pending" items={byStatus('pending')} busyId={busyId} canManage={canManage} setStatus={setStatus} generateNow={generateNow} onOpenTask={onOpenTask} actionable />
      <Bucket title="Approved" items={byStatus('approved')} busyId={busyId} canManage={canManage} setStatus={setStatus} generateNow={generateNow} onOpenTask={onOpenTask} actionable />
      <Bucket title="Generated" items={byStatus('generated')} busyId={busyId} canManage={false} setStatus={setStatus} generateNow={generateNow} onOpenTask={onOpenTask} />
      {byStatus('rejected').length > 0 && (
        <Bucket title="Rejected" items={byStatus('rejected')} busyId={busyId} canManage={false} setStatus={setStatus} generateNow={generateNow} onOpenTask={onOpenTask} />
      )}
    </div>
  );
}

function Bucket({
  title, items, busyId, canManage, setStatus, generateNow, onOpenTask, actionable,
}: {
  title: string;
  items: any[];
  busyId: string | null;
  canManage: boolean;
  setStatus: (id: string, status: ContractRequestStatus) => void;
  generateNow: (id: string) => void;
  onOpenTask: (id: string) => void;
  actionable?: boolean;
}) {
  return (
    <div className="aq-card" style={{ padding: 18 }}>
      <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>{title} ({items.length})</h3>
      {items.length === 0 ? (
        <p style={{ color: 'var(--aq-text-muted)', fontSize: 13 }}>None.</p>
      ) : (
        <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {items.map((request) => (
            <li key={request.id} style={rowStyle}>
              <div>
                <strong style={{ fontSize: 14 }}>
                  {request.request_kind === 'vendor' ? 'Vendor contract' : 'Client contract'}
                  {request.brand_name ? ` - ${request.brand_name}` : ''}
                </strong>
                <div style={{ fontSize: 12, color: 'var(--aq-text-muted)', marginTop: 3 }}>
                  {request.vendor_name && `vendor ${request.vendor_name} - `}
                  {request.client_name && `client ${request.client_name} - `}
                  {request.amount != null && `SAR ${Number(request.amount).toLocaleString()} - `}
                  {request.generated_contract_id && `contract ${request.generated_contract_id} - `}
                  {new Date(request.created_at).toLocaleDateString()}
                </div>
              </div>

              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                {request.pm_task_id && (
                  <button
                    type="button"
                    className="aq-btn aq-btn-ghost"
                    onClick={() => onOpenTask(request.pm_task_id)}
                    style={{ padding: '6px 10px', fontSize: 12 }}
                  >
                    Open task
                  </button>
                )}
                {actionable && canManage && (
                  <>
                    <button
                      className="aq-btn aq-btn-secondary"
                      disabled={busyId === request.id}
                      onClick={() => setStatus(request.id, 'approved')}
                      style={{ padding: '6px 10px', fontSize: 12 }}
                    >
                      Approve
                    </button>
                    <button
                      className="aq-btn aq-btn-primary"
                      disabled={busyId === request.id}
                      onClick={() => generateNow(request.id)}
                      style={{ padding: '6px 10px', fontSize: 12 }}
                    >
                      {busyId === request.id ? 'Generating...' : 'Generate now'}
                    </button>
                    <button
                      className="aq-btn aq-btn-ghost"
                      disabled={busyId === request.id}
                      onClick={() => setStatus(request.id, 'rejected')}
                      style={{ padding: '6px 10px', fontSize: 12 }}
                    >
                      Reject
                    </button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '10px 14px',
  borderRadius: 'var(--aq-radius)',
  border: '1px solid var(--aq-border-light)',
  background: 'var(--aq-bg-elevated)',
  gap: 12,
};
