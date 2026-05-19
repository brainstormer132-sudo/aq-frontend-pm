'use client';

/**
 * Invoices section for a client in the CRM detail view.
 *
 * Three states it has to render:
 *  1. Zoho not configured on the backend  → muted "Zoho not enabled" note.
 *  2. Client has no zoho_customer_id      → "Link to Zoho customer" picker.
 *  3. Client is linked                    → table of invoices + a small
 *                                            "change link" / "unlink" affordance.
 *
 * The picker calls /zoho/contacts/search?q=... with a debounced query so the
 * Books API isn't hammered on every keystroke.
 */

import { useEffect, useRef, useState } from 'react';
import {
  zoho,
  type ZohoInvoiceRow,
  type ZohoContactRow,
} from '@/lib/contract-api';

export function ClientInvoices({
  clientId,
  clientName,
  initialZohoCustomerId,
  onLinkedChange,
}: {
  clientId: string;
  clientName: string;
  /** Current zoho_customer_id from the clients table (null/empty if unlinked). */
  initialZohoCustomerId: string | null;
  /** Called after a successful link / unlink so the parent can refetch the client row. */
  onLinkedChange?: (newId: string | null) => void;
}) {
  const [zohoEnabled, setZohoEnabled] = useState<boolean | null>(null);
  const [zohoCustomerId, setZohoCustomerId] = useState<string | null>(
    (initialZohoCustomerId || '').trim() || null,
  );
  const [invoices, setInvoices] = useState<ZohoInvoiceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // On mount: is Zoho even configured? Cheap probe so the UI doesn't try
  // to load invoices into a 503.
  useEffect(() => {
    let cancelled = false;
    zoho.health()
      .then((h) => { if (!cancelled) setZohoEnabled(h.configured); })
      .catch(() => { if (!cancelled) setZohoEnabled(false); });
    return () => { cancelled = true; };
  }, []);

  // Pull invoices whenever we're linked + Zoho is configured.
  useEffect(() => {
    if (!zohoEnabled || !zohoCustomerId) {
      setInvoices([]);
      return;
    }
    let cancelled = false;
    setLoading(true); setError(null);
    zoho.clientInvoices(clientId)
      .then((rows) => { if (!cancelled) setInvoices(rows); })
      .catch((e: any) => { if (!cancelled) setError(e?.message || String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [zohoEnabled, zohoCustomerId, clientId]);

  // ── Render
  if (zohoEnabled === null) {
    return (
      <section className="aq-card" style={{ padding: 22 }}>
        <SectionHeader />
        <p style={{ color: 'var(--aq-text-muted)', fontSize: 13 }}>Loading…</p>
      </section>
    );
  }

  if (!zohoEnabled) {
    return (
      <section className="aq-card" style={{ padding: 22 }}>
        <SectionHeader />
        <p style={{ color: 'var(--aq-text-muted)', fontSize: 13 }}>
          Zoho Books isn't connected yet. Ask an admin to add the Zoho
          credentials to the backend to see invoices here.
        </p>
      </section>
    );
  }

  if (!zohoCustomerId) {
    return (
      <section className="aq-card" style={{ padding: 22 }}>
        <SectionHeader />
        <p style={{ color: 'var(--aq-text-muted)', fontSize: 13, marginBottom: 12 }}>
          This client isn't linked to a Zoho Books customer yet. Search for the
          right contact to pull their invoices.
        </p>
        <ContactPicker
          defaultQuery={clientName}
          onPick={async (cid) => {
            await zoho.linkClient(clientId, cid);
            setZohoCustomerId(cid);
            onLinkedChange?.(cid);
          }}
        />
      </section>
    );
  }

  return (
    <section className="aq-card" style={{ padding: 22 }}>
      <SectionHeader
        right={
          <button
            type="button"
            className="aq-btn aq-btn-ghost"
            onClick={async () => {
              if (!confirm('Unlink this client from its Zoho customer? Invoices will hide until you re-link.')) return;
              await zoho.linkClient(clientId, null);
              setZohoCustomerId(null);
              onLinkedChange?.(null);
            }}
            style={{ fontSize: 12 }}
          >Unlink</button>
        }
      />

      {loading ? (
        <p style={{ color: 'var(--aq-text-muted)', fontSize: 13 }}>Loading invoices…</p>
      ) : error ? (
        <div style={{ background: 'var(--aq-error)', color: '#fff', padding: '8px 12px', borderRadius: 'var(--aq-radius)', fontSize: 13 }}>
          {error}
        </div>
      ) : invoices.length === 0 ? (
        <p style={{ color: 'var(--aq-text-muted)', fontSize: 13 }}>
          No invoices yet for this Zoho customer.
        </p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--aq-text-muted)' }}>
                <Th>Invoice</Th>
                <Th>Date</Th>
                <Th>Due</Th>
                <Th>Status</Th>
                <Th style={{ textAlign: 'right' }}>Total</Th>
                <Th style={{ textAlign: 'right' }}>Balance</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.invoice_id} style={{ borderTop: '1px solid var(--aq-border)' }}>
                  <Td><strong>{inv.invoice_number || inv.invoice_id}</strong></Td>
                  <Td>{inv.date || '—'}</Td>
                  <Td>{inv.due_date || '—'}</Td>
                  <Td><StatusBadge status={inv.status} /></Td>
                  <Td style={{ textAlign: 'right' }}>{fmtMoney(inv.total, inv.currency_code)}</Td>
                  <Td style={{ textAlign: 'right' }}>{fmtMoney(inv.balance, inv.currency_code)}</Td>
                  <Td style={{ textAlign: 'right' }}>
                    <a
                      href={inv.web_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="aq-btn aq-btn-ghost"
                      style={{ fontSize: 12, padding: '4px 8px' }}
                    >View in Zoho ↗</a>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ── Sub-components ────────────────────────────────────────────────────

function SectionHeader({ right }: { right?: React.ReactNode }) {
  return (
    <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
      <h3 style={{ fontSize: 14, fontWeight: 700 }}>Invoices (Zoho Books)</h3>
      {right}
    </header>
  );
}

function ContactPicker({
  defaultQuery,
  onPick,
}: {
  defaultQuery: string;
  onPick: (zohoContactId: string) => void | Promise<void>;
}) {
  const [q, setQ] = useState(defaultQuery);
  const [results, setResults] = useState<ZohoContactRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!q.trim() || q.trim().length < 2) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setBusy(true); setErr(null);
      try {
        setResults(await zoho.searchContacts(q.trim()));
      } catch (e: any) {
        setErr(e?.message || String(e));
      } finally {
        setBusy(false);
      }
    }, 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [q]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <input
        className="aq-input"
        placeholder="Search Zoho contacts by name…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {busy && <p style={{ fontSize: 12, color: 'var(--aq-text-muted)' }}>Searching…</p>}
      {err && (
        <div style={{ background: 'var(--aq-error)', color: '#fff', padding: '6px 10px', borderRadius: 'var(--aq-radius)', fontSize: 12 }}>
          {err}
        </div>
      )}
      {results.length > 0 && (
        <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 240, overflowY: 'auto' }}>
          {results.map((c) => (
            <li
              key={c.contact_id}
              style={{
                padding: '8px 10px',
                borderRadius: 'var(--aq-radius)',
                background: 'var(--aq-bg-sunken)',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
              }}
            >
              <div>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{c.contact_name}</div>
                <div style={{ fontSize: 11, color: 'var(--aq-text-muted)' }}>
                  {[c.company_name, c.email, c.phone].filter(Boolean).join(' · ') || c.contact_id}
                </div>
              </div>
              <button
                type="button"
                className="aq-btn aq-btn-primary"
                style={{ fontSize: 12, padding: '4px 10px' }}
                onClick={() => onPick(c.contact_id)}
              >Link</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status?: string | null }) {
  if (!status) return <>—</>;
  // Zoho returns statuses like 'paid', 'sent', 'overdue', 'draft', 'partially_paid', 'void'
  const map: Record<string, { bg: string; fg: string }> = {
    paid:            { bg: '#dcfce7', fg: '#166534' },
    sent:            { bg: '#dbeafe', fg: '#1e40af' },
    overdue:         { bg: '#fee2e2', fg: '#991b1b' },
    draft:           { bg: '#f3f4f6', fg: '#374151' },
    partially_paid:  { bg: '#fef9c3', fg: '#854d0e' },
    void:            { bg: '#f3f4f6', fg: '#6b7280' },
  };
  const colors = map[status] || { bg: '#f3f4f6', fg: '#374151' };
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: 999,
      background: colors.bg,
      color: colors.fg,
      fontSize: 11,
      fontWeight: 600,
      textTransform: 'capitalize',
    }}>{status.replace(/_/g, ' ')}</span>
  );
}

function Th({ children, style }: { children?: React.ReactNode; style?: React.CSSProperties }) {
  return <th style={{ padding: '6px 8px', fontWeight: 600, ...style }}>{children}</th>;
}
function Td({ children, style }: { children?: React.ReactNode; style?: React.CSSProperties }) {
  return <td style={{ padding: '8px', ...style }}>{children}</td>;
}

function fmtMoney(n: number | null | undefined, currency?: string | null): string {
  if (n == null) return '—';
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency || 'SAR',
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency || ''}`.trim();
  }
}
