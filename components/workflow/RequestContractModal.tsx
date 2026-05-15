'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  createContractRequest,
  useLegacyVendors,
  usePendingClients,
  usePendingVendors,
  type ContractKind,
  type PMTask,
} from '@/hooks/use-workflow';

/**
 * Request a contract from legal.
 *
 * Legal chooses the template later. Requesters only choose which approved
 * registration to use, then add the task-specific commercial fields.
 */
export function RequestContractModal({
  task, currentUserId, onClose, onCreated,
}: {
  task: PMTask;
  currentUserId: string;
  onClose: () => void;
  onCreated?: () => void;
}) {
  const [kind, setKind] = useState<ContractKind>('vendor');
  const [brand, setBrand] = useState(task.brand_name ?? '');
  const [amount, setAmount] = useState<string>(task.budget != null ? String(task.budget) : '');
  const [pendingVendorId, setPendingVendorId] = useState<number | ''>('');
  const [pendingClientId, setPendingClientId] = useState<number | ''>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const { items: vendorRegistrations } = usePendingVendors();
  const { items: clientRegistrations } = usePendingClients();
  const { vendors, banks } = useLegacyVendors();

  const approvedVendors = useMemo(
    () => vendorRegistrations.filter((v) => v.status === 'approved'),
    [vendorRegistrations],
  );
  const approvedClients = useMemo(
    () => clientRegistrations.filter((c) => c.status === 'approved'),
    [clientRegistrations],
  );

  const selectedVendorRegistration = approvedVendors.find((v) => v.id === pendingVendorId) ?? null;
  const selectedClientRegistration = approvedClients.find((c) => c.id === pendingClientId) ?? null;

  const matchedVendor = useMemo(() => {
    if (!selectedVendorRegistration) return null;
    const license = (selectedVendorRegistration.license_number ?? '').trim();
    const name = selectedVendorRegistration.full_name.trim().toLowerCase();
    return vendors.find((v) =>
      (license && v.license_number === license) ||
      v.name.trim().toLowerCase() === name
    ) ?? null;
  }, [selectedVendorRegistration, vendors]);

  const matchedBank = useMemo(() => {
    if (!selectedVendorRegistration) return null;
    if (matchedVendor) {
      return banks.find((b) => b.vendor_id === matchedVendor.id) ?? null;
    }
    const iban = (selectedVendorRegistration.iban ?? '').trim();
    return iban ? (banks.find((b) => b.iban === iban) ?? null) : null;
  }, [banks, matchedVendor, selectedVendorRegistration]);

  const isInfluencer = Boolean(
    selectedVendorRegistration &&
    `${selectedVendorRegistration.vendor_category ?? ''} ${selectedVendorRegistration.platforms ?? ''}`
      .toLowerCase()
      .includes('influencer')
  );

  useEffect(() => {
    if (kind === 'vendor' && pendingVendorId === '' && approvedVendors.length) {
      setPendingVendorId(approvedVendors[0].id);
    }
    if (kind === 'client' && pendingClientId === '' && approvedClients.length) {
      setPendingClientId(approvedClients[0].id);
    }
  }, [approvedClients, approvedVendors, kind, pendingClientId, pendingVendorId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      if (!brand.trim()) throw new Error('Enter the brand name.');
      if (!amount || Number.isNaN(Number(amount))) throw new Error('Enter the contract price.');
      if (kind === 'vendor' && !selectedVendorRegistration) throw new Error('Choose an approved vendor registration.');
      if (kind === 'client' && !selectedClientRegistration) throw new Error('Choose an approved client registration.');

      await createContractRequest({
        pm_task_id: task.id,
        workspace_id: task.workspace_id ?? '',
        requested_by: currentUserId,
        request_kind: kind,
        template_key: null,
        brand_name: brand.trim(),
        amount: Number(amount),
        notes: null,

        client_name: kind === 'client' ? selectedClientRegistration!.company_name : null,
        client_id_legacy: task.legacy_client_id ?? null,
        pending_client_id: kind === 'client' ? selectedClientRegistration!.id : null,
        cr_number: kind === 'client' ? selectedClientRegistration!.cr_number ?? null : null,
        vat_number: kind === 'client' ? selectedClientRegistration!.vat_number ?? null : null,
        signatory_name: kind === 'client' ? selectedClientRegistration!.signatory_name ?? null : null,
        street: kind === 'client' ? selectedClientRegistration!.street ?? null : null,
        city: kind === 'client' ? selectedClientRegistration!.city ?? null : null,
        postcode: kind === 'client' ? selectedClientRegistration!.postcode ?? null : null,
        country: kind === 'client' ? selectedClientRegistration!.country ?? null : null,
        email: kind === 'client'
          ? selectedClientRegistration!.company_email || selectedClientRegistration!.email || null
          : null,
        phone: kind === 'client' ? selectedClientRegistration!.phone ?? null : null,

        pending_vendor_id: kind === 'vendor' ? selectedVendorRegistration!.id : null,
        vendor_id: kind === 'vendor' ? matchedVendor?.id ?? null : null,
        vendor_name: kind === 'vendor' ? selectedVendorRegistration!.full_name : null,
        vendor_category: kind === 'vendor' ? selectedVendorRegistration!.vendor_category ?? null : null,
        vendor_email: kind === 'vendor' ? selectedVendorRegistration!.email ?? null : null,
        vendor_phone: kind === 'vendor' ? selectedVendorRegistration!.phone ?? null : null,
        bank_account_id: kind === 'vendor' ? matchedBank?.id ?? null : null,
        bank_name: kind === 'vendor' ? matchedBank?.bank_name ?? selectedVendorRegistration!.bank_name ?? null : null,
        account_name: kind === 'vendor' ? matchedBank?.account_name ?? selectedVendorRegistration!.account_name ?? null : null,
        iban: kind === 'vendor' ? matchedBank?.iban ?? selectedVendorRegistration!.iban ?? null : null,
        account_number: kind === 'vendor' ? matchedBank?.account_number ?? selectedVendorRegistration!.account_number ?? null : null,
        swift_code: kind === 'vendor' ? matchedBank?.swift_code ?? selectedVendorRegistration!.swift_code ?? null : null,
        license_number: kind === 'vendor' ? selectedVendorRegistration!.license_number ?? null : null,
        is_influencer: kind === 'vendor' ? isInfluencer : null,
        platforms: kind === 'vendor' && isInfluencer ? selectedVendorRegistration!.platforms ?? null : null,
        ad_type: null,
        qty: null,
        channel: null,
        details: null,
      });
      onCreated?.();
      onClose();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'rgba(15, 29, 34, 0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}
      onClick={onClose}
      role="dialog" aria-modal="true"
    >
      <div
        className="aq-card animate-scale-in"
        style={{ width: '100%', maxWidth: 680, padding: 24, maxHeight: '90vh', overflow: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        <header style={{ marginBottom: 16 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700 }}>Request contract</h2>
          <p style={{ color: 'var(--aq-text-muted)', fontSize: 13, marginTop: 4 }}>
            Legal will choose the template. This request uses approved registration data.
          </p>
        </header>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
          {(['vendor','client'] as ContractKind[]).map((k) => (
            <button
              key={k}
              type="button"
              className={`aq-btn ${kind === k ? 'aq-btn-primary' : 'aq-btn-secondary'}`}
              onClick={() => setKind(k)}
              style={{ padding: '12px 16px' }}
            >
              {k === 'vendor' ? 'Vendor contract' : 'Client contract'}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Brand">
              <input className="aq-input" value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Brand" />
            </Field>
            <Field label="Price (SAR)">
              <input className="aq-input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
            </Field>
          </div>

          {kind === 'vendor' ? (
            <>
              <Field label="Approved vendor registration">
                <select
                  className="aq-select"
                  value={pendingVendorId}
                  onChange={(e) => setPendingVendorId(e.target.value ? Number(e.target.value) : '')}
                >
                  {approvedVendors.length === 0 && <option value="">No approved vendor registrations</option>}
                  {approvedVendors.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.full_name}{v.license_number ? ` - ${v.license_number}` : ''}
                    </option>
                  ))}
                </select>
              </Field>
              {selectedVendorRegistration && (
                <Snapshot title="Vendor data pulled from registration">
                  <SnapshotRow label="Name" value={selectedVendorRegistration.full_name} />
                  <SnapshotRow label="ID / license" value={selectedVendorRegistration.license_number} />
                  <SnapshotRow label="Category" value={selectedVendorRegistration.vendor_category} />
                  <SnapshotRow label="Bank" value={matchedBank?.bank_name ?? selectedVendorRegistration.bank_name} />
                  <SnapshotRow label="Account name" value={matchedBank?.account_name ?? selectedVendorRegistration.account_name} />
                  <SnapshotRow label="IBAN" value={matchedBank?.iban ?? selectedVendorRegistration.iban} />
                  {isInfluencer && <SnapshotRow label="Platform" value={selectedVendorRegistration.platforms} />}
                </Snapshot>
              )}
            </>
          ) : (
            <>
              <Field label="Approved client registration">
                <select
                  className="aq-select"
                  value={pendingClientId}
                  onChange={(e) => setPendingClientId(e.target.value ? Number(e.target.value) : '')}
                >
                  {approvedClients.length === 0 && <option value="">No approved client registrations</option>}
                  {approvedClients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.company_name}{c.cr_number ? ` - CR ${c.cr_number}` : ''}
                    </option>
                  ))}
                </select>
              </Field>
              {selectedClientRegistration && (
                <Snapshot title="Client data pulled from registration">
                  <SnapshotRow label="Company" value={selectedClientRegistration.company_name} />
                  <SnapshotRow label="CR" value={selectedClientRegistration.cr_number} />
                  <SnapshotRow label="VAT" value={selectedClientRegistration.vat_number} />
                  <SnapshotRow label="Signatory" value={selectedClientRegistration.signatory_name} />
                  <SnapshotRow label="Email" value={selectedClientRegistration.company_email || selectedClientRegistration.email} />
                  <SnapshotRow label="Phone" value={selectedClientRegistration.phone} />
                  <SnapshotRow label="Address" value={[
                    selectedClientRegistration.street,
                    selectedClientRegistration.city,
                    selectedClientRegistration.postcode,
                    selectedClientRegistration.country,
                  ].filter(Boolean).join(', ')} />
                </Snapshot>
              )}
            </>
          )}

          {error && (
            <div style={{
              background: 'var(--aq-error)', color: '#fff',
              padding: '10px 14px', borderRadius: 'var(--aq-radius)', fontSize: 13,
            }}>{error}</div>
          )}

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 6 }}>
            <button type="button" className="aq-btn aq-btn-ghost" onClick={onClose}>Cancel</button>
            <button type="button" className="aq-btn aq-btn-primary" onClick={submit} disabled={busy}>
              {busy ? 'Submitting...' : 'Submit to legal'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="aq-label">{label}</div>
      {children}
    </div>
  );
}

function Snapshot({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      border: '1px solid var(--aq-border-light)',
      borderRadius: 'var(--aq-radius)',
      background: 'var(--aq-bg-elevated)',
      padding: 14,
    }}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>{title}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {children}
      </div>
    </div>
  );
}

function SnapshotRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--aq-text-muted)', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 600 }}>{value || 'Not provided'}</div>
    </div>
  );
}
