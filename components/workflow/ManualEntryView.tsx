'use client';

import { useState } from 'react';
import { manualCreate, externalInvites, type ExternalInvite } from '@/lib/contract-api';
import { InviteLinkModal } from '@/components/workflow/InviteLinkModal';

type Tab = 'vendor' | 'client';

/**
 * Admin-only entry forms for vendors / clients who can't or won't fill in
 * the public Netlify forms themselves. Posts to /api/vendors/manual/*.
 * After a successful create the form ALSO issues a portal invite right
 * away — the modal exposes both a copy-link button and an "Open setup
 * link" button so the admin can walk through the portal locally for
 * testing without leaving the dashboard.
 */
export function ManualEntryView() {
  const [tab, setTab] = useState<Tab>('vendor');
  const [activeInvite, setActiveInvite] = useState<ExternalInvite | null>(null);

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <header>
        <h2 style={{ fontSize: 22, fontWeight: 800 }}>Manual Entry</h2>
        <p style={{ color: 'var(--aq-text-muted)', fontSize: 13, marginTop: 4 }}>
          Add a vendor or client directly when they cannot use the registration form.
          A portal invite is generated automatically — copy the link, or open it in a
          new tab to test the portal as them.
        </p>
      </header>

      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--aq-border-light)' }}>
        <TabButton active={tab === 'vendor'} onClick={() => setTab('vendor')}>Vendor</TabButton>
        <TabButton active={tab === 'client'} onClick={() => setTab('client')}>Client</TabButton>
      </div>

      {tab === 'vendor'
        ? <ManualVendorForm onInvited={setActiveInvite} />
        : <ManualClientForm onInvited={setActiveInvite} />}

      <InviteLinkModal invite={activeInvite} onClose={() => setActiveInvite(null)} />
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────

function ManualVendorForm({ onInvited }: { onInvited: (inv: ExternalInvite) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [form, setForm] = useState({
    full_name: '',
    license_number: '',
    license_expiry: '',
    vendor_category: '',
    email: '',
    phone: '',
    platforms: '',
    iban: '',
    bank_name: '',
    account_name: '',
    account_number: '',
    swift_code: '',
  });

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((s) => ({ ...s, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const created = await manualCreate.vendor(form);

      // Auto-issue a portal invite — only if we have an email to attach it to.
      if (form.email.trim()) {
        try {
          const inv = await externalInvites.issue({
            role: 'vendor',
            email: form.email.trim(),
            vendor_id: Number(created.id),
          });
          onInvited(inv);
          setSuccess(`Vendor created and invite generated for ${created.name}.`);
        } catch (inviteErr: any) {
          // Vendor exists, invite failed. Show both pieces of info.
          setSuccess(`Vendor created: ${created.name} (id ${created.id}).`);
          setError(`Invite generation failed: ${inviteErr?.message ?? inviteErr}. Use the Vendors view to retry.`);
        }
      } else {
        setSuccess(`Vendor created: ${created.name} (id ${created.id}). No email on file — issue an invite from the Vendors view when needed.`);
      }

      setForm({
        full_name: '', license_number: '', license_expiry: '', vendor_category: '',
        email: '', phone: '', platforms: '',
        iban: '', bank_name: '', account_name: '', account_number: '', swift_code: '',
      });
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="aq-card" style={cardStyle}>
      <Section title="Identity">
        <Field label="Full name" required>
          <input className="aq-input" required value={form.full_name} onChange={set('full_name')} placeholder="محمد أحمد" />
        </Field>
        <Field label="License number" required>
          <input className="aq-input" required value={form.license_number} onChange={set('license_number')} placeholder="1010XXXXXX" />
        </Field>
        <Field label="License expiry">
          <input className="aq-input" type="date" value={form.license_expiry} onChange={set('license_expiry')} />
        </Field>
        <Field label="Category">
          <input className="aq-input" value={form.vendor_category} onChange={set('vendor_category')} placeholder="Influencer / Photographer / …" />
        </Field>
      </Section>

      <Section title="Contact">
        <Field label="Email">
          <input className="aq-input" type="email" value={form.email} onChange={set('email')} placeholder="vendor@example.com" />
        </Field>
        <Field label="Phone">
          <input className="aq-input" type="tel" value={form.phone} onChange={set('phone')} placeholder="+966 5XX XXX XXXX" />
        </Field>
        <Field label="Platforms">
          <input className="aq-input" value={form.platforms} onChange={set('platforms')} placeholder="Instagram, TikTok, …" />
        </Field>
      </Section>

      <Section title="Bank (optional)">
        <Field label="IBAN">
          <input className="aq-input" value={form.iban} onChange={set('iban')} placeholder="SA00 0000 0000 0000 0000 0000" />
        </Field>
        <Field label="Bank name">
          <input className="aq-input" value={form.bank_name} onChange={set('bank_name')} />
        </Field>
        <Field label="Account name">
          <input className="aq-input" value={form.account_name} onChange={set('account_name')} />
        </Field>
        <Field label="Account #">
          <input className="aq-input" value={form.account_number} onChange={set('account_number')} />
        </Field>
        <Field label="SWIFT">
          <input className="aq-input" value={form.swift_code} onChange={set('swift_code')} />
        </Field>
      </Section>

      {error && <div className="aq-badge aq-badge-error" style={{ display: 'block', whiteSpace: 'normal' }}>{error}</div>}
      {success && <div className="aq-badge aq-badge-success" style={{ display: 'block' }}>{success}</div>}

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button type="submit" className="aq-btn aq-btn-primary" disabled={busy}>
          {busy ? 'Creating…' : 'Create vendor'}
        </button>
      </div>
    </form>
  );
}

function ManualClientForm({ onInvited }: { onInvited: (inv: ExternalInvite) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [form, setForm] = useState({
    company_name: '',
    cr_number: '',
    vat_number: '',
    signatory_name: '',
    phone: '',
    email: '',
    company_email: '',
    street: '',
    city: '',
    postcode: '',
    country: 'Saudi Arabia',
    national_address: '',
  });

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((s) => ({ ...s, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const created = await manualCreate.client(form);

      const inviteEmail = (form.company_email || form.email).trim();
      if (inviteEmail) {
        try {
          const inv = await externalInvites.issue({
            role: 'client',
            email: inviteEmail,
            client_id: String(created.id),
          });
          onInvited(inv);
          setSuccess(`Client created and invite generated for ${created.company_name}.`);
        } catch (inviteErr: any) {
          setSuccess(`Client created: ${created.company_name} (id ${created.id}).`);
          setError(`Invite generation failed: ${inviteErr?.message ?? inviteErr}. Use the Clients & Brands view to retry.`);
        }
      } else {
        setSuccess(`Client created: ${created.company_name} (id ${created.id}). No email on file — issue an invite from Clients & Brands when needed.`);
      }

      setForm({
        company_name: '', cr_number: '', vat_number: '', signatory_name: '',
        phone: '', email: '', company_email: '',
        street: '', city: '', postcode: '', country: 'Saudi Arabia', national_address: '',
      });
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="aq-card" style={cardStyle}>
      <Section title="Company">
        <Field label="Company name" required>
          <input className="aq-input" required value={form.company_name} onChange={set('company_name')} placeholder="شركة ..." />
        </Field>
        <Field label="CR number">
          <input className="aq-input" value={form.cr_number} onChange={set('cr_number')} placeholder="1010XXXXXX" />
        </Field>
        <Field label="VAT number">
          <input className="aq-input" value={form.vat_number} onChange={set('vat_number')} placeholder="3000XXXXXX" />
        </Field>
        <Field label="Signatory">
          <input className="aq-input" value={form.signatory_name} onChange={set('signatory_name')} placeholder="Authorised signatory" />
        </Field>
      </Section>

      <Section title="Contact">
        <Field label="Phone">
          <input className="aq-input" type="tel" value={form.phone} onChange={set('phone')} />
        </Field>
        <Field label="Personal email">
          <input className="aq-input" type="email" value={form.email} onChange={set('email')} />
        </Field>
        <Field label="Company email">
          <input className="aq-input" type="email" value={form.company_email} onChange={set('company_email')} />
        </Field>
      </Section>

      <Section title="Address">
        <Field label="Street">
          <input className="aq-input" value={form.street} onChange={set('street')} />
        </Field>
        <Field label="City">
          <input className="aq-input" value={form.city} onChange={set('city')} />
        </Field>
        <Field label="Postcode">
          <input className="aq-input" value={form.postcode} onChange={set('postcode')} />
        </Field>
        <Field label="Country">
          <input className="aq-input" value={form.country} onChange={set('country')} />
        </Field>
        <Field label="National address">
          <input className="aq-input" value={form.national_address} onChange={set('national_address')} placeholder="مثال: RRRD2929" />
        </Field>
      </Section>

      {error && <div className="aq-badge aq-badge-error" style={{ display: 'block', whiteSpace: 'normal' }}>{error}</div>}
      {success && <div className="aq-badge aq-badge-success" style={{ display: 'block' }}>{success}</div>}

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button type="submit" className="aq-btn aq-btn-primary" disabled={busy}>
          {busy ? 'Creating…' : 'Create client'}
        </button>
      </div>
    </form>
  );
}

// ───────────────────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <h3 style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--aq-text-muted)', margin: '8px 0 0' }}>
        {title}
      </h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        {children}
      </div>
    </div>
  );
}

function Field({
  label, required, children,
}: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
      <span style={{ color: 'var(--aq-text-muted)', fontWeight: 600 }}>
        {label}{required && <span style={{ color: 'var(--aq-error)' }}> *</span>}
      </span>
      {children}
    </label>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '10px 18px', background: 'transparent', border: 'none',
        borderBottom: `2px solid ${active ? 'var(--aq-accent)' : 'transparent'}`,
        color: active ? 'var(--aq-text)' : 'var(--aq-text-muted)',
        fontWeight: active ? 700 : 600, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit',
      }}
    >
      {children}
    </button>
  );
}

const cardStyle: React.CSSProperties = {
  padding: 24,
  display: 'flex',
  flexDirection: 'column',
  gap: 18,
};
