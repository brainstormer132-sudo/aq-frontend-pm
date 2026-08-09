'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  createVendorBatch, batchVendorTitle,
  MEDIA_TYPES, VENDOR_FORMATS, VENDOR_FORMAT_LABELS, formatIsTrackable,
  type VendorFormat, type TaskPriority, type TaskSource,
} from '@/hooks/use-workflow';

/**
 * Bulk "add vendors" popup.
 *
 * A Package Ad sold as 50 or 100 ads used to mean 50 trips through the
 * subtask form. This sets the things that are the same across the batch —
 * ad type, platform, price per vendor — once, and creates the lot in a
 * single insert.
 *
 * The vendor itself is deliberately NOT set here (Siraj's call): 50 ads
 * usually means 50 different influencers, so they get picked one at a time
 * afterwards. That is also why the batch carries an explicit
 * Influencer / UGC / Other choice — with no vendor yet, nothing else can
 * tell us whether this is trackable work.
 *
 * Names are generated ("{brand} — Vendor 7") and editable per row. A
 * generated name is recognised as auto, so assigning a real vendor later
 * renames the row to "{brand} — {vendor}". A name typed here is not.
 */
export function AddVendorsModal({
  open, onClose, parentTaskId, workspaceId, currentUserId,
  brandName, priority, existingVendorCount, taskPlatforms, onCreated,
}: {
  open: boolean;
  onClose: () => void;
  parentTaskId: string;
  workspaceId: string;
  currentUserId: string;
  brandName: string | null;
  priority: TaskPriority;
  /** Used to continue the numbering rather than restart at 1. */
  existingVendorCount: number;
  taskPlatforms: TaskSource[];
  onCreated: (count: number, trackable: boolean) => Promise<void> | void;
}) {
  const [qty, setQty] = useState('10');
  const [adType, setAdType] = useState('');
  const [customAdType, setCustomAdType] = useState('');
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [price, setPrice] = useState('');
  const [format, setFormat] = useState<VendorFormat>('influencer');
  const [names, setNames] = useState<string[]>([]);
  /** Rows the user has actually typed into — never clobbered by a qty change. */
  const [touched, setTouched] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const n = Math.max(0, Math.min(200, Math.floor(Number(qty) || 0)));

  // Reset each time it opens, so a cancelled batch never leaks into the next.
  useEffect(() => {
    if (!open) return;
    setQty('10'); setAdType(''); setCustomAdType(''); setPlatforms([]);
    setPrice(''); setFormat('influencer'); setTouched(new Set());
    setError(''); setBusy(false);
  }, [open]);

  // Keep the name list the right length. Rows the user edited keep their text;
  // everything else re-derives, so changing the brand or count renumbers
  // cleanly without throwing away typing.
  useEffect(() => {
    setNames((prev) => {
      const next: string[] = [];
      for (let i = 0; i < n; i += 1) {
        next.push(
          touched.has(i) && prev[i] !== undefined
            ? prev[i]
            : batchVendorTitle(brandName, existingVendorCount + i + 1),
        );
      }
      return next;
    });
  }, [n, brandName, existingVendorCount, touched]);

  const effectiveAdType = adType === '__custom' ? customAdType.trim() : adType;
  const priceNum = price.trim() === '' ? null : Number(price.trim().replace(/,/g, ''));
  const priceValid = priceNum == null || (Number.isFinite(priceNum) && priceNum >= 0);
  const total = priceValid && priceNum != null ? priceNum * n : null;

  const togglePlatform = (name: string) =>
    setPlatforms((cur) => cur.includes(name) ? cur.filter((p) => p !== name) : [...cur, name]);

  const setName = (i: number, value: string) => {
    setNames((prev) => { const next = [...prev]; next[i] = value; return next; });
    setTouched((prev) => new Set(prev).add(i));
  };

  const removeRow = (i: number) => {
    setNames((prev) => prev.filter((_, x) => x !== i));
    // Shift the touched indices down past the removed row, otherwise the
    // wrong rows would be treated as hand-edited afterwards.
    setTouched((prev) => {
      const next = new Set<number>();
      prev.forEach((t) => { if (t < i) next.add(t); else if (t > i) next.add(t - 1); });
      return next;
    });
    setQty(String(Math.max(0, n - 1)));
  };

  const addRow = () => {
    setQty(String(n + 1));
  };

  const handleCreate = async () => {
    if (n < 1) { setError('Set how many vendors to add.'); return; }
    if (!priceValid) { setError('Price must be a number.'); return; }
    setBusy(true); setError('');
    try {
      const created = await createVendorBatch({
        parent_task_id: parentTaskId,
        workspace_id: workspaceId,
        creator_id: currentUserId,
        rows: names.slice(0, n).map((title) => ({ title })),
        brand_name: brandName,
        priority,
        ad_type: effectiveAdType || null,
        platforms,
        price_per_vendor: priceNum,
        format,
      });
      await onCreated(created, formatIsTrackable(format));
      onClose();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  const LABEL: React.CSSProperties = {
    fontSize: 12, fontWeight: 700, color: 'var(--aq-text-muted)',
    display: 'block', marginBottom: 4,
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(15, 29, 34, 0.45)', padding: 20,
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Add vendors"
    >
      <div
        className="aq-card"
        style={{
          width: 'min(720px, 100%)', maxHeight: '90vh',
          display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden',
        }}
      >
        <header style={{
          padding: '18px 22px', borderBottom: '1px solid var(--aq-border-light)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12,
        }}>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 700 }}>Add vendors</h2>
            <p style={{ fontSize: 12, color: 'var(--aq-text-muted)', marginTop: 3 }}>
              Set what they have in common. Vendors themselves get picked one at a time afterwards.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="aq-btn aq-btn-ghost"
            style={{ padding: '4px 10px', fontSize: 16, lineHeight: 1 }}
            aria-label="Close"
          >✕</button>
        </header>

        <div style={{ padding: '18px 22px', overflowY: 'auto', flex: 1 }}>
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14,
          }}>
            <div>
              <label style={LABEL} htmlFor="av-qty">How many</label>
              <input
                id="av-qty"
                className="aq-input"
                type="number"
                min={1}
                max={200}
                value={qty}
                onChange={(e) => setQty(e.target.value)}
              />
            </div>

            <div>
              <label style={LABEL} htmlFor="av-price">Price per vendor (SAR)</label>
              <input
                id="av-price"
                className="aq-input"
                inputMode="decimal"
                placeholder="0.00"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
            </div>

            <div>
              <label style={LABEL} htmlFor="av-adtype">Ad type</label>
              <select
                id="av-adtype"
                className="aq-select"
                value={adType}
                onChange={(e) => setAdType(e.target.value)}
              >
                <option value="">—</option>
                {MEDIA_TYPES.map((m) => <option key={m} value={m}>{m}</option>)}
                <option value="__custom">Something else…</option>
              </select>
              {adType === '__custom' && (
                <input
                  className="aq-input"
                  style={{ marginTop: 6 }}
                  placeholder="e.g. VideoShot"
                  value={customAdType}
                  onChange={(e) => setCustomAdType(e.target.value)}
                />
              )}
            </div>

            <div>
              <label style={LABEL} htmlFor="av-format">Vendor type</label>
              <select
                id="av-format"
                className="aq-select"
                value={format}
                onChange={(e) => setFormat(e.target.value as VendorFormat)}
              >
                {VENDOR_FORMATS.map((f) => (
                  <option key={f} value={f}>{VENDOR_FORMAT_LABELS[f]}</option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ marginTop: 14 }}>
            <span style={LABEL}>Platform</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {taskPlatforms.length === 0 && (
                <span style={{ fontSize: 12, color: 'var(--aq-text-muted)' }}>
                  No platforms configured yet.
                </span>
              )}
              {taskPlatforms.map((p) => {
                const on = platforms.includes(p.name);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => togglePlatform(p.name)}
                    style={{
                      padding: '4px 10px', borderRadius: 999, cursor: 'pointer',
                      fontSize: 12, fontFamily: 'inherit',
                      border: on ? '1px solid var(--aq-accent)' : '1px solid var(--aq-border)',
                      background: on ? 'var(--aq-accent-light)' : 'var(--aq-bg-elevated)',
                      color: 'var(--aq-text)',
                    }}
                  >{p.name}</button>
                );
              })}
            </div>
          </div>

          {formatIsTrackable(format) && (
            <p style={{
              marginTop: 12, fontSize: 12, color: 'var(--aq-text-secondary)',
              background: 'var(--aq-bg-sunken)', padding: '8px 10px',
              borderRadius: 'var(--aq-radius)',
            }}>
              {VENDOR_FORMAT_LABELS[format]} work: the tracking sheet is switched on for this
              campaign, and each vendor lands on it as you assign them.
            </p>
          )}

          <div style={{
            marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--aq-border-light)',
          }}>
            <div style={{
              display: 'flex', justifyContent: 'space-between',
              alignItems: 'center', marginBottom: 8, gap: 12, flexWrap: 'wrap',
            }}>
              <span style={{ ...LABEL, marginBottom: 0 }}>
                Names ({n}) — edit any you want to set by hand
              </span>
              <button
                type="button"
                className="aq-btn aq-btn-ghost"
                onClick={addRow}
                style={{ padding: '2px 10px', fontSize: 12 }}
              >+ Add one</button>
            </div>

            <div style={{
              display: 'flex', flexDirection: 'column', gap: 4,
              maxHeight: 240, overflowY: 'auto', paddingRight: 4,
            }}>
              {names.slice(0, n).map((name, i) => (
                <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span style={{
                    width: 26, textAlign: 'right', fontSize: 11,
                    color: 'var(--aq-text-muted)', flexShrink: 0,
                  }}>{i + 1}</span>
                  <input
                    className="aq-input"
                    value={name}
                    onChange={(e) => setName(i, e.target.value)}
                    style={{ fontSize: 13, padding: '5px 9px' }}
                    aria-label={`Name for vendor ${i + 1}`}
                  />
                  <button
                    type="button"
                    onClick={() => removeRow(i)}
                    className="aq-btn aq-btn-ghost"
                    style={{ padding: '2px 8px', fontSize: 12, flexShrink: 0 }}
                    aria-label={`Remove row ${i + 1}`}
                  >✕</button>
                </div>
              ))}
            </div>
          </div>

          {error && (
            <div style={{
              marginTop: 12, background: 'var(--aq-error)', color: '#fff',
              padding: '9px 12px', borderRadius: 'var(--aq-radius)', fontSize: 13,
            }}>{error}</div>
          )}
        </div>

        <footer style={{
          padding: '14px 22px', borderTop: '1px solid var(--aq-border-light)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          gap: 12, flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: 12, color: 'var(--aq-text-muted)' }}>
            {n} vendor{n === 1 ? '' : 's'}
            {total != null && (
              <> · total <strong style={{ color: 'var(--aq-text)' }}>
                SAR {total.toLocaleString()}
              </strong></>
            )}
            {!priceValid && <span style={{ color: 'var(--aq-error)' }}> · price is not a number</span>}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="aq-btn aq-btn-ghost" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button
              type="button"
              className="aq-btn aq-btn-primary"
              onClick={handleCreate}
              disabled={busy || n < 1 || !priceValid}
            >
              {busy ? 'Creating…' : `Create ${n} vendor${n === 1 ? '' : 's'}`}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
