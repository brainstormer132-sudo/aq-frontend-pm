'use client';

/**
 * Small reusable pieces shared by the overview, documents, profile, and help
 * views. Keeping them in one file so each view component stays focused on its
 * layout, and so the visual primitives stay consistent across roles.
 */

import { useState, type ReactNode } from 'react';
import { portal, type PortalContractRow } from '@/lib/portal-api';

// ─── Icons (inline SVGs, currentColor) ──────────────────────────────────────

export const Icon = {
  Home: () => (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12 12 3l9 9" /><path d="M5 10v10h14V10" />
    </svg>
  ),
  Doc: () => (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
      <path d="M14 3v6h6" />
    </svg>
  ),
  User: () => (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" />
    </svg>
  ),
  Help: () => (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 0 1 5 0c0 1.5-2.5 2-2.5 3.5" />
      <circle cx="12" cy="17" r=".5" fill="currentColor" />
    </svg>
  ),
  Search: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width={16} height={16}>
      <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
    </svg>
  ),
  Download: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width={14} height={14}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="M7 10l5 5 5-5" /><path d="M12 15V3" />
    </svg>
  ),
  Message: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width={14} height={14}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  ),
};

// ─── initials / formatters ──────────────────────────────────────────────────

export function initials(name?: string | null): string {
  if (!name) return '··';
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0])
    .join('')
    .toUpperCase();
}

/**
 * Parse "AED 12,500.50" → { currency: 'AED', amount: 12500.50 }.
 * Currency is the leading non-digit token; falls back to empty string.
 * Used by the YTD stat to group by currency so we don't add SAR to AED.
 */
export function parseAmount(raw: string): { currency: string; amount: number } {
  const s = (raw || '').trim();
  const m = s.match(/^([^\d.,\-+]*)\s*([0-9.,\-+\s]+)/);
  if (!m) return { currency: '', amount: 0 };
  const currency = m[1].trim();
  const amount = parseFloat(m[2].replace(/[,\s]/g, '')) || 0;
  return { currency, amount };
}

export function sumByCurrency(rows: PortalContractRow[]): Array<{ currency: string; total: number }> {
  const map = new Map<string, number>();
  rows.forEach((r) => {
    const { currency, amount } = parseAmount(r.amount);
    map.set(currency, (map.get(currency) ?? 0) + amount);
  });
  return Array.from(map.entries())
    .map(([currency, total]) => ({ currency, total }))
    .sort((a, b) => b.total - a.total);
}

/** "AED 24,500" with thousands separators. */
export function fmtMoney(amount: number, currency: string): string {
  const n = Math.round(amount).toLocaleString();
  return currency ? `${currency} ${n}` : n;
}

// ─── status badge ───────────────────────────────────────────────────────────

export function StatusBadge({ row }: { row: PortalContractRow }) {
  if (row.has_pdf && row.has_docx) return <span className="aq-badge aq-badge-success">Ready</span>;
  if (row.has_docx && !row.has_pdf) return <span className="aq-badge aq-badge-warning">Generating PDF</span>;
  return <span className="aq-badge aq-badge-muted">Pending</span>;
}

// ─── stat tile ──────────────────────────────────────────────────────────────

export function Stat({
  label, value, sub,
}: { label: ReactNode; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="portal-stat">
      <div className="portal-stat-label">{label}</div>
      <div className="portal-stat-value">{value}</div>
      {sub != null && <div className="portal-stat-sub">{sub}</div>}
    </div>
  );
}

// ─── copy-to-clipboard pill ─────────────────────────────────────────────────

export function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={`portal-copy-btn${copied ? ' copied' : ''}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1100);
        } catch {
          /* clipboard blocked — silently no-op */
        }
      }}
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

// ─── detail rows for profile views ──────────────────────────────────────────

export interface DetailField {
  k: string;
  v: string | number | null | undefined;
  copyable?: boolean;
}

export function DetailGrid({ fields }: { fields: DetailField[] }) {
  return (
    <div className="portal-detail-grid">
      {fields.map(({ k, v, copyable }) => (
        <div key={k} className="portal-detail-row">
          <div className="k">{k}</div>
          <div className="v">
            <span>{v == null || v === '' ? '—' : v}</span>
            {copyable && v ? <CopyButton value={String(v)} /> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── download buttons (PDF / DOCX) — same auth-bearer flow as before ───────

export function DownloadBtn({
  contractId, kind, disabled, variant = 'secondary',
}: {
  contractId: string;
  kind: 'pdf' | 'docx';
  disabled?: boolean;
  variant?: 'secondary' | 'ghost';
}) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className={`aq-btn aq-btn-${variant} aq-btn-sm`}
      style={{ padding: '6px 10px', fontSize: 12 }}
      disabled={disabled || busy}
      onClick={async () => {
        setBusy(true);
        try {
          // Need to attach the JWT manually since this isn't an <a href>.
          const { createClient } = await import('@/lib/supabase-browser');
          const supabase = createClient();
          const { data: { session } } = await supabase.auth.getSession();
          if (!session?.access_token) throw new Error('Sign in again.');
          const url = portal.downloadUrl(contractId, kind);
          const r = await fetch(url, { headers: { Authorization: `Bearer ${session.access_token}` } });
          if (!r.ok) {
            const t = await r.text();
            throw new Error(t || `Download failed (${r.status})`);
          }
          const blob = await r.blob();
          const blobUrl = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = blobUrl;
          a.download = `${contractId}.${kind}`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(blobUrl);
        } catch (e: any) {
          window.alert(e?.message ?? 'Download failed.');
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? '…' : kind.toUpperCase()}
    </button>
  );
}

// ─── Client-side CSV export of the current contracts list ──────────────────

export function exportContractsCsv(rows: PortalContractRow[], filename = 'contracts.csv') {
  const headers = ['contract_id', 'brand_name', 'amount', 'contract_type', 'generated_at', 'has_pdf', 'has_docx'];
  const escape = (s: any) => {
    const v = String(s ?? '');
    return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  };
  const lines = [
    headers.join(','),
    ...rows.map((r) => headers.map((h) => escape((r as any)[h])).join(',')),
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
