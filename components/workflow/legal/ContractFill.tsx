'use client';

import { useMemo, useState } from 'react';
import { useContractEditor, useLegalPlaceholders, useManagedLists } from '@/hooks/use-legal';
import {
  fillFieldsForBlocks, validateFieldValue, contractReady, fillPlaceholders,
  blockText, blockKV, detectDir, sortListValues,
  contractStatusLabel, contractStatusBadge, fieldTypeLabel, contractPrintHTML,
  type Placeholder, type TemplateBlock,
} from '@/lib/legal';
import { AqDrawingBlock } from '@/components/AQLoading';

/**
 * The New-Contract fill screen. It reads the blocks of the version the contract
 * was stamped to, shows only the fields that version's wording uses - each
 * typed per the registry ("Legal chooses, it does not write": a list is a
 * dropdown, a number is bounded, a date is a date, free text is only for names
 * and IDs) - and writes the values. A draft is editable and can be issued once
 * every required field is valid; an issued contract is frozen and read-only.
 */
export function ContractFill({
  workspaceId, contractId, onBack,
}: { workspaceId?: string; contractId: string; onBack: () => void }) {
  const ed = useContractEditor(workspaceId ?? null, contractId);
  const reg = useLegalPlaceholders(workspaceId ?? null);
  const lists = useManagedLists(workspaceId ?? null);
  const { contract, blocks, values, loading, error, busy, editable } = ed;

  // The fields this version actually uses, in first-appearance order.
  const fields = useMemo(
    () => fillFieldsForBlocks(blocks, reg.placeholders),
    [blocks, reg.placeholders],
  );

  // Allowed active values per list-field key, for validation and readiness.
  const listsByKey = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const f of fields) {
      if (f.field_type === 'list' && f.list_id) {
        out[f.key] = (lists.valuesByList[f.list_id] ?? []).filter((v) => v.active).map((v) => v.value);
      }
    }
    return out;
  }, [fields, lists.valuesByList]);

  const ready = contractReady(fields, values, listsByKey);
  const [banner, setBanner] = useState('');

  const dir = detectDir(blocks);
  const busyAll = busy || reg.loading || lists.loading;

  const saveDraft = async () => {
    setBanner('');
    try { await ed.saveAll(fields.map((f) => f.key)); setBanner('Saved.'); }
    catch { /* ed.error shows it */ }
  };
  const issue = async () => {
    setBanner('');
    try { await ed.issue(fields.map((f) => f.key)); }
    catch { /* ed.error shows it */ }
  };

  // Render the filled contract to a stand-alone document and hand it to the
  // browser's Print / Save-as-PDF. The new window is same-origin about:blank,
  // so no server or PDF library is involved.
  const printDoc = () => {
    if (!contract) return;
    const html = contractPrintHTML({
      title: contract.title || 'Contract',
      blocks, values, dir,
      meta: {
        org: 'AQ Creativity',
        status: contractStatusLabel(contract.status),
        reference: `Ref: ${contract.id.slice(0, 8)}`,
        generatedOn: new Date().toLocaleDateString(),
      },
    });
    const w = window.open('', '_blank');
    if (!w) { setBanner('Allow pop-ups for this site to print.'); return; }
    w.document.open();
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => { try { w.print(); } catch { /* the user can print from the window */ } }, 350);
  };

  return (
    <div className="aq-view" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button className="aq-btn aq-btn-ghost" onClick={onBack}>&larr; Register</button>
        <span style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 16, fontWeight: 700 }}>{contract?.title || 'Contract'}</span>
          {contract ? (
            <span className={`aq-badge ${contractStatusBadge(contract.status)}`}>{contractStatusLabel(contract.status)}</span>
          ) : null}
        </span>
        {contract && (
          <button className="aq-btn aq-btn-ghost" disabled={loading} onClick={printDoc}
            title="Open a print-ready copy to print or save as PDF">Print / Save as PDF</button>
        )}
        {contract && editable && (
          <>
            <button className="aq-btn aq-btn-ghost" disabled={busyAll} onClick={saveDraft}>Save draft</button>
            <button className="aq-btn aq-btn-primary" disabled={busyAll || !ready} onClick={issue}
              title={ready ? 'Freeze the values and issue the contract' : 'Fill every required field first'}>
              Issue contract
            </button>
          </>
        )}
      </div>

      {error && <div className="aq-badge aq-badge-error" style={{ display: 'block', padding: 10 }}>{error}</div>}
      {banner && <div className="aq-badge aq-badge-success" style={{ display: 'block', padding: 10 }}>{banner}</div>}
      {!editable && contract && (
        <div className="aq-card" style={{ padding: 12, fontSize: 13, color: 'var(--aq-text-secondary)' }}>
          This contract is {contractStatusLabel(contract.status).toLowerCase()} and its field values are frozen.
        </div>
      )}

      {loading ? (
        <div className="aq-card" style={{ padding: 8 }}><AqDrawingBlock label={'Loading the contract\u2026'} /></div>
      ) : !contract ? (
        <div className="aq-card" style={{ padding: 24, textAlign: 'center', color: 'var(--aq-text-muted)' }}>
          This contract could not be loaded.
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          {/* Fill form */}
          <div style={{ flex: '1 1 320px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase',
              color: 'var(--aq-text-muted)' }}>Fields</div>
            {fields.length === 0 ? (
              <div className="aq-card" style={{ padding: 20, fontSize: 13, color: 'var(--aq-text-muted)' }}>
                This template version has no merge fields - nothing to fill. The document is fixed as published.
              </div>
            ) : (
              <div className="aq-card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
                {fields.map((f) => (
                  <FieldInput key={f.key} field={f} value={values[f.key] ?? ''} editable={!!editable}
                    options={sortListValues(((f.list_id ? lists.valuesByList[f.list_id] : undefined) ?? []).filter((v) => v.active))}
                    allowed={listsByKey[f.key]}
                    onChange={(v) => ed.setValue(f.key, v)} />
                ))}
              </div>
            )}
          </div>

          {/* Live preview */}
          <div style={{ flex: '1 1 360px', minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase',
              color: 'var(--aq-text-muted)', marginBottom: 12 }}>Preview</div>
            <div className="aq-card" style={{ padding: 22 }} dir={dir}>
              <PreviewBody blocks={blocks} values={values} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FieldInput({
  field, value, options, allowed, editable, onChange,
}: {
  field: Placeholder;
  value: string;
  options: { id: string; value: string; label: string }[];
  allowed?: string[];
  editable: boolean;
  onChange: (v: string) => void;
}) {
  const err = validateFieldValue(field, value, allowed ? { values: allowed } : undefined);
  const label = field.label || field.key;

  const control = () => {
    if (!editable) {
      return <div dir="auto" style={{ fontSize: 14, padding: '6px 0', color: 'var(--aq-text)' }}>
        {value || <span style={{ color: 'var(--aq-text-muted)' }}>(empty)</span>}
      </div>;
    }
    if (field.field_type === 'auto') {
      return <input dir="auto" className="aq-input" value={value} readOnly
        placeholder="Filled automatically" style={{ width: '100%', opacity: 0.7 }} />;
    }
    if (field.field_type === 'list') {
      return (
        <select className="aq-select" value={value} onChange={(e) => onChange(e.target.value)} style={{ width: '100%' }}>
          <option value="">{'-- choose --'}</option>
          {options.map((o) => <option key={o.id} value={o.value}>{o.label || o.value}</option>)}
        </select>
      );
    }
    if (field.field_type === 'number') {
      return <input type="number" className="aq-input" value={value} onChange={(e) => onChange(e.target.value)}
        min={field.num_min ?? undefined} max={field.num_max ?? undefined} style={{ width: '100%' }} />;
    }
    if (field.field_type === 'date') {
      return <input type="date" className="aq-input" value={value} onChange={(e) => onChange(e.target.value)} style={{ width: '100%' }} />;
    }
    return <input dir="auto" className="aq-input" value={value} onChange={(e) => onChange(e.target.value)}
      placeholder={label} style={{ width: '100%' }} />;
  };

  return (
    <div>
      <label style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 4 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
        {field.required && <span style={{ color: 'var(--aq-danger, #c0392b)', fontSize: 12 }}>*</span>}
        <span style={{ fontSize: 11, color: 'var(--aq-text-muted)', fontFamily: 'monospace' }}>{field.key}</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: 'var(--aq-text-muted)' }}>{fieldTypeLabel(field.field_type)}</span>
      </label>
      {control()}
      {editable && err && value.trim() !== '' && (
        <div style={{ fontSize: 11.5, color: 'var(--aq-danger, #c0392b)', marginTop: 3 }}>{err}</div>
      )}
    </div>
  );
}

function PreviewBody({ blocks, values }: { blocks: TemplateBlock[]; values: Record<string, string> }) {
  if (!blocks.length) {
    return <div style={{ fontSize: 13, color: 'var(--aq-text-muted)' }}>This version has no content.</div>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {blocks.map((b) => {
        if (b.block_type === 'kv') {
          const kv = blockKV(b);
          return (
            <div key={b.id} dir="auto" style={{ fontSize: 14 }}>
              <span style={{ fontWeight: 600 }}>{fillPlaceholders(kv.label, values)}:</span>{' '}
              <span>{fillPlaceholders(kv.value, values)}</span>
            </div>
          );
        }
        const text = fillPlaceholders(blockText(b), values);
        if (b.block_type === 'title') return <div key={b.id} dir="auto" style={{ fontSize: 18, fontWeight: 700 }}>{text}</div>;
        if (b.block_type === 'h') return <div key={b.id} dir="auto" style={{ fontSize: 15, fontWeight: 600, marginTop: 4 }}>{text}</div>;
        if (b.block_type === 'li') return <div key={b.id} dir="auto" style={{ fontSize: 14, paddingInlineStart: 16 }}>{'\u2022'} {text}</div>;
        return <div key={b.id} dir="auto" style={{ fontSize: 14, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{text}</div>;
      })}
    </div>
  );
}
