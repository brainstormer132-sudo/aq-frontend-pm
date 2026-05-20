'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  addCrmDeal, updateCrmDeal,
  useClients, useLegacyVendors,
  DEAL_STAGES, type CrmDeal, type DealStage,
} from '@/hooks/use-workflow';

/**
 * Slide-over deal editor.
 *
 * Used in two modes:
 *  - `create`: blank form, defaults to `defaultStage`.
 *  - `edit`:   pre-fills from `deal`.
 *
 * Layout: overlay + right-anchored panel. Escape and overlay-click close.
 */
export function DealEditor({
  mode, deal, defaultStage,
  workspaceId, currentUserId, currentUserName,
  onClose, onSaved, onDelete,
}: {
  mode: 'create' | 'edit';
  deal: CrmDeal | null;
  defaultStage: DealStage;
  workspaceId: string;
  currentUserId: string;
  currentUserName: string;
  onClose: () => void;
  onSaved: () => void;
  onDelete?: () => void;
}) {
  const { clients } = useClients();
  const { vendors } = useLegacyVendors();

  // Form state
  const [name, setName]                 = useState(deal?.name ?? '');
  const [value, setValue]               = useState<string>(String(deal?.value ?? ''));
  const [currency, setCurrency]         = useState(deal?.currency_code ?? 'SAR');
  const [stage, setStage]               = useState<DealStage>(deal?.stage ?? defaultStage);
  const [probability, setProbability]   = useState<string>(
    deal?.probability != null ? String(deal.probability) : ''
  );
  const [expectedClose, setExpectedClose] = useState<string>(deal?.expected_close_date ?? '');
  const [targetType, setTargetType]     = useState<'' | 'client' | 'vendor'>(deal?.target_type ?? '');
  const [targetId, setTargetId]         = useState<string>(deal?.target_id ?? '');
  const [ownerName, setOwnerName]       = useState(deal?.owner_name ?? currentUserName);
  const [notes, setNotes]               = useState(deal?.notes ?? '');

  const [busy, setBusy]                 = useState(false);
  const [error, setError]               = useState('');

  // Default probability based on stage (only when creating).
  useEffect(() => {
    if (mode !== 'create' || probability !== '') return;
    setProbability(String(defaultProbabilityForStage(stage)));
  }, [stage, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Escape to close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const targetOptions = useMemo(() => {
    if (targetType === 'client') {
      return (clients || []).map((c) => ({ id: c.id, label: c.company_name }));
    }
    if (targetType === 'vendor') {
      return (vendors || []).map((v) => ({ id: String(v.id), label: v.name }));
    }
    return [];
  }, [targetType, clients, vendors]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setError('Give the deal a name.'); return; }
    setBusy(true); setError('');
    try {
      const payload = {
        name: name.trim(),
        value: Number(value || 0),
        currency_code: currency || 'SAR',
        stage,
        probability: probability === '' ? null : Math.max(0, Math.min(100, Number(probability))),
        expected_close_date: expectedClose || null,
        target_type: (targetType || null) as 'client' | 'vendor' | null,
        target_id: (targetType && targetId) ? targetId : null,
        owner_name: ownerName || '',
        notes: notes || '',
      };
      if (mode === 'edit' && deal) {
        await updateCrmDeal(deal.id, payload as Partial<CrmDeal>);
      } else {
        await addCrmDeal({
          workspace_id: workspaceId,
          owner_id: currentUserId,
          ...payload,
        });
      }
      onSaved();
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(15,15,20,0.45)',
        zIndex: 60,
        display: 'flex', justifyContent: 'flex-end',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--aq-bg)',
          width: 'min(520px, 100%)',
          height: '100%',
          boxShadow: '-8px 0 28px rgba(0,0,0,0.2)',
          overflowY: 'auto',
          display: 'flex', flexDirection: 'column',
        }}
      >
        <header style={{
          padding: '18px 22px',
          borderBottom: '1px solid var(--aq-border-light)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div>
            <span style={{
              fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em',
              color: 'var(--aq-text-muted)', fontWeight: 700,
            }}>
              {mode === 'edit' ? 'Edit deal' : 'New deal'}
            </span>
            <h2 style={{ fontSize: 18, fontWeight: 800, marginTop: 2 }}>
              {mode === 'edit' ? deal?.name : 'Add to pipeline'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'transparent', border: 'none',
              fontSize: 22, lineHeight: 1, cursor: 'pointer',
              color: 'var(--aq-text-muted)', padding: 4,
            }}
          >×</button>
        </header>

        <form onSubmit={submit} style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label="Deal name">
            <input
              className="aq-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Acme — Q3 campaign"
              required
            />
          </Field>

          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
            <Field label="Value">
              <input
                className="aq-input"
                type="number" min={0} step="0.01"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="0"
              />
            </Field>
            <Field label="Currency">
              <select
                className="aq-select"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
              >
                <option value="SAR">SAR</option>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
                <option value="AED">AED</option>
                <option value="GBP">GBP</option>
              </select>
            </Field>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="Stage">
              <select
                className="aq-select"
                value={stage}
                onChange={(e) => setStage(e.target.value as DealStage)}
              >
                {DEAL_STAGES.map((s) => (
                  <option key={s.key} value={s.key}>{s.label}</option>
                ))}
              </select>
            </Field>
            <Field label="Probability (%)">
              <input
                className="aq-input"
                type="number" min={0} max={100}
                value={probability}
                onChange={(e) => setProbability(e.target.value)}
                placeholder="auto"
              />
            </Field>
          </div>

          <Field label="Expected close">
            <input
              className="aq-input"
              type="date"
              value={expectedClose}
              onChange={(e) => setExpectedClose(e.target.value)}
            />
          </Field>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 10 }}>
            <Field label="Link to">
              <select
                className="aq-select"
                value={targetType}
                onChange={(e) => { setTargetType(e.target.value as any); setTargetId(''); }}
              >
                <option value="">— none —</option>
                <option value="client">Client</option>
                <option value="vendor">Vendor</option>
              </select>
            </Field>
            <Field label={targetType ? `Pick ${targetType}` : 'Contact'}>
              <select
                className="aq-select"
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
                disabled={!targetType}
              >
                <option value="">{targetType ? '— pick one —' : '(pick a type first)'}</option>
                {targetOptions.map((o) => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="Owner">
            <input
              className="aq-input"
              value={ownerName}
              onChange={(e) => setOwnerName(e.target.value)}
              placeholder="Who owns this deal?"
            />
          </Field>

          <Field label="Notes">
            <textarea
              className="aq-textarea"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Context, contacts, anything worth remembering."
              rows={5}
            />
          </Field>

          {error && (
            <div style={{
              padding: '8px 12px', background: '#fee2e2', color: '#991b1b',
              borderRadius: 'var(--aq-radius)', fontSize: 13,
            }}>{error}</div>
          )}

          <footer style={{
            display: 'flex', justifyContent: 'space-between',
            marginTop: 6, paddingTop: 12,
            borderTop: '1px solid var(--aq-border-light)',
          }}>
            {mode === 'edit' && onDelete ? (
              <button
                type="button"
                onClick={onDelete}
                className="aq-btn aq-btn-danger"
                disabled={busy}
              >Delete</button>
            ) : <span />}
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={onClose} className="aq-btn aq-btn-ghost" disabled={busy}>Cancel</button>
              <button type="submit" className="aq-btn aq-btn-primary" disabled={busy}>
                {busy ? 'Saving…' : mode === 'edit' ? 'Save changes' : 'Add deal'}
              </button>
            </div>
          </footer>
        </form>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <span style={{
        fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
        letterSpacing: '0.05em', color: 'var(--aq-text-muted)',
      }}>{label}</span>
      {children}
    </label>
  );
}

function defaultProbabilityForStage(stage: DealStage): number {
  switch (stage) {
    case 'prospect':    return 10;
    case 'qualified':   return 30;
    case 'proposal':    return 55;
    case 'negotiation': return 75;
    case 'won':         return 100;
    case 'lost':        return 0;
    default:            return 10;
  }
}
