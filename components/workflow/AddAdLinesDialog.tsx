'use client';

import { useEffect, useState } from 'react';
import { AD_TYPE_OPTIONS } from '@/hooks/use-workflow';
import { specTotals, specProblems, type AdLineSpec } from '@/lib/ad-lines';

/**
 * Add several ads to a booking in one go.
 *
 * Bookings arrive in batches — "six home ads at 1,500, six store visits at
 * 900, three free reminders". Adding those a blank row at a time meant
 * typing the same ad type and the same price six times, and six chances to
 * mistype one of them. Asked once here, they come out as six separate ads,
 * because each one still needs its own day and its own brief.
 *
 * The total sits ABOVE the fields and moves as you type. `6 × 1,500 =
 * 9,000` is checkable at a glance; six rows that add up to 9,000 are not,
 * and the number is going into a contract.
 *
 * Ad type and platform are dropdowns rather than free text: the same ad
 * typed "Home ad", "home Ad" and "Home Ad" is three ad types to every report
 * that groups by it.
 */
export function AddAdLinesDialog({
  platformOptions, defaultPlatform, onCancel, onAdd,
}: {
  platformOptions: string[];
  /** The campaign's platform, offered first — usually the right answer. */
  defaultPlatform?: string | null;
  onCancel: () => void;
  onAdd: (spec: AdLineSpec) => Promise<void>;
}) {
  const [spec, setSpec] = useState<AdLineSpec>({
    count: 1,
    ad_type: '',
    platform: defaultPlatform ?? null,
    quantity: 1,
    unit_price: 0,
    description: null,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Escape closes. A modal that can only be dismissed by hitting a small X
  // is the kind of thing people work around by reloading the page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const totals = specTotals(spec);
  const problems = specProblems(spec);

  const set = <K extends keyof AdLineSpec>(k: K) => (v: AdLineSpec[K]) =>
    setSpec((s) => ({ ...s, [k]: v }));

  const submit = async () => {
    if (problems.length) { setError(problems[0]); return; }
    setSaving(true); setError('');
    try { await onAdd(spec); }
    catch (e: any) { setError(e?.message ?? String(e)); setSaving(false); }
  };

  // The campaign's own platform first, then the workspace list, without
  // repeating it if it is already in there.
  const platforms = [
    ...(defaultPlatform && !platformOptions.includes(defaultPlatform) ? [defaultPlatform] : []),
    ...platformOptions,
  ];

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Add ads to this booking"
    >
      <div onClick={onCancel} style={{ position: 'absolute', inset: 0, background: 'rgba(15, 29, 34, 0.45)' }} aria-hidden="true" />

      <div
        className="aq-card"
        style={{
          position: 'relative', width: '100%', maxWidth: 470,
          padding: 20, maxHeight: '90vh', overflowY: 'auto',
          boxShadow: 'var(--aq-shadow-lg)',
        }}
      >
        <h3 style={{ fontSize: 15, fontWeight: 700 }}>Add ads</h3>
        <p style={{ fontSize: 12, color: 'var(--aq-text-muted)', marginTop: 3 }}>
          They are created as separate ads, so each one can carry its own due
          date, brief and proof afterwards.
        </p>

        {/* ── The number, above the fields, live ─────────────────── */}
        <div style={{
          marginTop: 14, padding: '10px 14px',
          borderRadius: 'var(--aq-radius)',
          background: 'var(--aq-bg-sunken)',
          display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12,
        }}>
          <span style={{ fontSize: 12.5, color: 'var(--aq-text-secondary)' }}>
            {totals.lines} line{totals.lines === 1 ? '' : 's'}
            {totals.ads !== totals.lines && ` · ${totals.ads} ad${totals.ads === 1 ? '' : 's'}`}
          </span>
          <strong style={{ fontSize: 19, fontVariantNumeric: 'tabular-nums' }}>
            {totals.free
              ? <span style={{ fontSize: 14, color: 'var(--aq-text-muted)' }}>no charge</span>
              : `SAR ${Math.round(totals.amount).toLocaleString('en-US')}`}
          </strong>
        </div>
        {totals.free && totals.lines > 0 && (
          <p style={{ fontSize: 11.5, color: 'var(--aq-text-muted)', marginTop: 5 }}>
            A free line is still part of the agreement and still appears in the contract.
          </p>
        )}

        <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 11 }}>
          <Field label="Ad type">
            <select
              className="aq-select"
              value={spec.ad_type}
              onChange={(e) => set('ad_type')(e.target.value)}
              autoFocus
            >
              <option value="">Pick one…</option>
              {AD_TYPE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>

          <Field label="Platform">
            <select
              className="aq-select"
              value={spec.platform ?? ''}
              onChange={(e) => set('platform')(e.target.value || null)}
            >
              <option value="">— none —</option>
              {platforms.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </Field>

          {/* Bottom-aligned: "usually 1" wraps to a second line in the middle
              column, and a top-aligned row would step the three boxes down
              like a staircase. */}
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
            <Field label="How many">
              <input
                className="aq-input"
                type="number" min={1} max={100}
                value={spec.count}
                onChange={(e) => set('count')(Number(e.target.value))}
              />
            </Field>
            <Field label="Quantity" hint="usually 1">
              <input
                className="aq-input"
                type="number" min={1}
                value={spec.quantity}
                onChange={(e) => set('quantity')(Number(e.target.value))}
              />
            </Field>
            <Field label="Price each (SAR)">
              <input
                className="aq-input"
                type="number" min={0} step="0.01"
                value={spec.unit_price}
                onChange={(e) => set('unit_price')(Number(e.target.value))}
              />
            </Field>
          </div>

          <Field label="Brief" hint="optional — copied onto each, editable after">
            <input
              className="aq-input"
              value={spec.description ?? ''}
              placeholder="e.g. Riyadh branch opening"
              onChange={(e) => set('description')(e.target.value || null)}
            />
          </Field>
        </div>

        {error && <p style={{ fontSize: 12.5, color: '#b91c1c', marginTop: 10 }}>{error}</p>}
        {!error && problems.length > 0 && (
          <p style={{ fontSize: 12, color: 'var(--aq-text-muted)', marginTop: 10 }}>{problems[0]}</p>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button type="button" className="aq-btn aq-btn-secondary" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
          <button
            type="button"
            className="aq-btn aq-btn-primary"
            onClick={submit}
            disabled={saving || problems.length > 0}
          >
            {saving ? 'Adding…' : `Add ${totals.lines || ''} line${totals.lines === 1 ? '' : 's'}`.trim()}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label style={{ flex: 1, minWidth: 0, display: 'block' }}>
      <span className="aq-label" style={{ display: 'block', marginBottom: 3 }}>
        {label}
        {hint && <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: 'var(--aq-text-muted)' }}> · {hint}</span>}
      </span>
      {children}
    </label>
  );
}
