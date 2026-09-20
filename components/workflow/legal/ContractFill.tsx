'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  useContractEditor, useLegalPlaceholders, useManagedLists, useContractSources, sha256Hex,
} from '@/hooks/use-legal';
import {
  UGC_BRAND_KEY, UGC_BANK_KEYS, bankAccountLabel, bankValuesFor, matchBankAccount,
  licenceParty, vendorPickerHint, CONTRACT_NO_KEY, type ContractVendor,
} from '@/lib/legal-prefill';
import { useLegacyVendors } from '@/hooks/use-workflow';
import { SearchablePicker } from '@/components/workflow/SearchablePicker';
import {
  fillFieldsForBlocks, validateFieldValue, contractReady, fillPlaceholders,
  blockText, blockKV, detectDir, sortListValues,
  contractStatusLabel, contractStatusBadge, fieldTypeLabel, contractPrintHTML,
  contractCanonical, formatFingerprint, visibleBlocks, isOptionalBlock, blockAllText,
  contractDateAlerts, hasBlockingAlert, dateAlertLabel,
  tableColumns, tableColumnFields, tableKey, parseTableRows, serializeTableRows, emptyTableRow, tableHasInvalidCell,
  type Placeholder, type TemplateBlock, type TableRow,
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
  const { contract, blocks, values, loading, error, busy, editable, fingerprint, issuedAt, offIds } = ed;

  // The vendor book, already paged and cached, with each talent's licence org
  // attached - the same list the campaign page uses, so no second read of
  // three thousand rows just for this picker.
  const { vendors } = useLegacyVendors();

  // The brand and bank pickers. Both only appear when this template actually
  // uses those fields, so a template that names neither is unchanged.
  const { brands, banks } = useContractSources(contract ?? null);

  // The blocks that make up this contract: all except optional clauses switched
  // off. Everything downstream - fields, preview, print, fingerprint - works
  // from the visible set, so an excluded clause and its fields simply vanish.
  const visible = useMemo(() => visibleBlocks(blocks, offIds), [blocks, offIds]);
  const optionalBlocks = useMemo(() => blocks.filter(isOptionalBlock), [blocks]);
  const tableBlocks = useMemo(() => visible.filter((b) => b.block_type === 'table'), [visible]);

  // The fields the visible wording uses, in first-appearance order.
  const fields = useMemo(
    () => fillFieldsForBlocks(visible, reg.placeholders),
    [visible, reg.placeholders],
  );

  // The contract number is not one of them. legal.reserve_contract_number
  // assigns it the moment before the contract is issued, so a typed value would
  // be overwritten and an abandoned draft would have burned a number. It is
  // shown, read-only, above the form.
  const fillFields = useMemo(() => fields.filter((f) => f.key !== CONTRACT_NO_KEY), [fields]);
  const usesContractNo = fillFields.length !== fields.length;

  // Which pickers this template wants, and which account is already chosen.
  const usesBrand = useMemo(() => fields.some((f) => f.key === UGC_BRAND_KEY), [fields]);
  const usesVendor = useMemo(
    () => fields.some((f) => f.key === 'license_name' || f.key === 'license_number'),
    [fields],
  );
  const vendorOptions = useMemo(
    () => (vendors as any[]).map((v) => ({
      value: String(v.id),
      label: String(v.name ?? ''),
      hint: vendorPickerHint(v as ContractVendor),
      keywords: [v.contact_name, v.license_number, v.id_number, v.org?.name].filter(Boolean).join(' '),
    })),
    [vendors],
  );
  const usesBank = useMemo(() => fields.some((f) => UGC_BANK_KEYS.includes(f.key)), [fields]);
  const chosenBankId = useMemo(
    () => String(matchBankAccount(banks, values.iban ?? '')?.id ?? ''),
    [banks, values.iban],
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

  const ready = contractReady(fillFields, values, listsByKey);

  // Any table cell that fails its column's type/bounds blocks Issue.
  const tablesInvalid = useMemo(() => {
    for (const b of tableBlocks) {
      const cols = tableColumnFields(tableColumns(b), reg.placeholders);
      const rows = parseTableRows(values[tableKey(b.id)]);
      const lk: Record<string, string[]> = {};
      for (const c of cols) {
        if (c.field.field_type === 'list' && c.field.list_id) {
          lk[c.key] = (lists.valuesByList[c.field.list_id] ?? []).filter((v) => v.active).map((v) => v.value);
        }
      }
      if (tableHasInvalidCell(cols, rows, lk)) return true;
    }
    return false;
  }, [tableBlocks, reg.placeholders, values, lists.valuesByList]);

  // Date alerts: a tracked date that is expired blocks Issue; expiring-soon warns.
  const today = new Date().toISOString().slice(0, 10);
  const dateAlerts = useMemo(() => contractDateAlerts(fields, values, today), [fields, values, today]);
  const blocked = hasBlockingAlert(dateAlerts);

  const [banner, setBanner] = useState('');

  const dir = detectDir(blocks);
  const busyAll = busy || reg.loading || lists.loading;

  // Re-verify the stored fingerprint against the current content whenever an
  // issued contract is loaded: recompute the hash and compare. A frozen
  // contract should always verify; a mismatch means the stored content and its
  // stamp disagree.
  const [verify, setVerify] = useState<'checking' | 'ok' | 'diff' | null>(null);
  useEffect(() => {
    let live = true;
    if (!contract || !fingerprint) { setVerify(null); return; }
    setVerify('checking');
    sha256Hex(contractCanonical(contract.version_id, visible, values))
      .then((h) => { if (live) setVerify(h === fingerprint ? 'ok' : 'diff'); })
      .catch(() => { if (live) setVerify(null); });
    return () => { live = false; };
  }, [contract, fingerprint, visible, values]);

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
      blocks: visible, values, dir,
      meta: {
        org: 'AQ Creativity',
        status: contractStatusLabel(contract.status),
        reference: `Ref: ${contract.id.slice(0, 8)}`,
        generatedOn: new Date().toLocaleDateString(),
        fingerprint: fingerprint ? formatFingerprint(fingerprint) : undefined,
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
          {contract?.contract_no ? (
            <code style={{ fontSize: 12.5, fontWeight: 700, direction: 'ltr',
              color: 'var(--aq-text-secondary)' }}>{contract.contract_no}</code>
          ) : null}
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
            <button className="aq-btn aq-btn-primary" disabled={busyAll || !ready || blocked || tablesInvalid} onClick={issue}
              title={blocked ? 'A tracked date is expired - fix it before issuing'
                : tablesInvalid ? 'A table cell is out of range or off-list - fix it before issuing'
                : ready ? 'Freeze the values and issue the contract' : 'Fill every required field first'}>
              Issue contract
            </button>
          </>
        )}
      </div>

      {error && <div className="aq-badge aq-badge-error" style={{ display: 'block', padding: 10 }}>{error}</div>}
      {banner && <div className="aq-badge aq-badge-success" style={{ display: 'block', padding: 10 }}>{banner}</div>}

      {dateAlerts.length > 0 && (
        <div className="aq-card" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {dateAlerts.map((a) => (
            <div key={a.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
              <span className={`aq-badge ${a.state === 'expired' ? 'aq-badge-error' : 'aq-badge-warning'}`}>{dateAlertLabel(a.state)}</span>
              <span style={{ fontWeight: 600 }}>{a.label}</span>
              <span style={{ color: 'var(--aq-text-muted)' }}>
                {a.state === 'expired' ? '- this date has passed; issuing is blocked until it is fixed.' : '- this date is coming up soon.'}
              </span>
            </div>
          ))}
        </div>
      )}
      {!editable && contract && (
        <div className="aq-card" style={{ padding: 12, fontSize: 13, color: 'var(--aq-text-secondary)' }}>
          This contract is {contractStatusLabel(contract.status).toLowerCase()} and its field values are frozen.
        </div>
      )}

      {contract && fingerprint && (
        <div className="aq-card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
              color: 'var(--aq-text-muted)' }}>Content fingerprint (SHA-256)</span>
            {verify === 'ok' && <span className="aq-badge aq-badge-success">Verified</span>}
            {verify === 'diff' && <span className="aq-badge aq-badge-error">Content differs</span>}
            {verify === 'checking' && <span className="aq-badge aq-badge-muted">{'Checking\u2026'}</span>}
            {issuedAt && <span style={{ fontSize: 11.5, color: 'var(--aq-text-muted)' }}>Issued {new Date(issuedAt).toLocaleString()}</span>}
          </div>
          <code style={{ fontSize: 11, wordBreak: 'break-all', color: 'var(--aq-text-secondary)', direction: 'ltr' }}>
            {formatFingerprint(fingerprint)}
          </code>
        </div>
      )}

      {loading ? (
        <div className="aq-card" style={{ padding: 8 }}><AqDrawingBlock label={'Loading the contract\u2026'} /></div>
      ) : !contract ? (
        <div className="aq-card" style={{ padding: 24, textAlign: 'center', color: 'var(--aq-text-muted)' }}>
          This contract could not be loaded.
        </div>
      ) : (
        <>
        {tableBlocks.map((b) => (
          <TableFill key={b.id} block={b} placeholders={reg.placeholders} lists={lists}
            rows={parseTableRows(values[tableKey(b.id)])} editable={!!editable}
            onChange={(rows) => ed.setValue(tableKey(b.id), serializeTableRows(rows))} />
        ))}
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          {/* Fill form */}
          <div style={{ flex: '1 1 320px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {editable && (usesBrand || usesVendor || usesBank) && (
              <div className="aq-card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase',
                  color: 'var(--aq-text-muted)' }}>From the records</div>
                {usesBrand && (
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Brand</div>
                    {brands.length ? (
                      <SearchablePicker
                        options={brands.map((b) => ({ value: b.brand_name, label: b.brand_name }))}
                        value={values[UGC_BRAND_KEY] || null}
                        onChange={(v) => ed.setValue(UGC_BRAND_KEY, v ?? '')}
                        placeholder={'Search this client\u2019s brands\u2026'}
                      />
                    ) : (
                      <div style={{ fontSize: 12.5, color: 'var(--aq-text-muted)' }}>
                        {contract.pm_task_id
                          ? 'That client has no brands on file yet - type the brand in the field below.'
                          : 'No campaign behind this contract, so there is no client to take brands from.'}
                      </div>
                    )}
                  </div>
                )}
                {usesVendor && (
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Vendor</div>
                    <SearchablePicker
                      options={vendorOptions}
                      value={contract.vendor_id != null ? String(contract.vendor_id) : null}
                      onChange={(v) => {
                        const vend = (vendors as any[]).find((x) => String(x.id) === v) ?? null;
                        // The licence party leads the contract; picking a new
                        // vendor also drops the old one's bank details, because
                        // an IBAN left over from the previous choice is the
                        // worst thing this screen could do.
                        const p = licenceParty(vend as ContractVendor | null);
                        ed.setValue('license_name', p.name);
                        ed.setValue('license_number', p.number);
                        for (const k of UGC_BANK_KEYS) ed.setValue(k, '');
                        void ed.setVendor(vend ? Number(vend.id) : null);
                      }}
                      placeholder={'Search vendors\u2026'}
                    />
                    <div style={{ fontSize: 12, color: 'var(--aq-text-muted)', marginTop: 4 }}>
                      Fills the licence name and number. An agency-licensed talent contracts
                      under the agency; the performer is named in the table above.
                    </div>
                  </div>
                )}
                {usesBank && (
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Bank account</div>
                    {banks.length ? (
                      <select className="aq-select" style={{ width: '100%', maxWidth: 360 }}
                        value={chosenBankId}
                        onChange={(e) => {
                          const a = banks.find((x) => String(x.id) === e.target.value) ?? null;
                          // All four together. A bank name from one account
                          // beside an IBAN from another is how money goes to
                          // the wrong place.
                          const v = bankValuesFor(a);
                          for (const k of UGC_BANK_KEYS) ed.setValue(k, v[k] ?? '');
                        }}>
                        <option value="">{'-- choose --'}</option>
                        {banks.map((a) => (
                          <option key={String(a.id)} value={String(a.id)}>{bankAccountLabel(a)}</option>
                        ))}
                      </select>
                    ) : (
                      <div style={{ fontSize: 12.5, color: 'var(--aq-text-muted)' }}>
                        {contract.vendor_id != null
                          ? 'This vendor has no bank account on file - add one on their registry page.'
                          : 'No vendor on this contract, so there are no accounts to choose from.'}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase',
              color: 'var(--aq-text-muted)' }}>Fields</div>
            {usesContractNo && (
              <div className="aq-card" style={{ padding: 14, display: 'flex', alignItems: 'center',
                gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>Contract number</span>
                {contract.contract_no ? (
                  <code style={{ fontSize: 13, fontWeight: 700, direction: 'ltr' }}>{contract.contract_no}</code>
                ) : (
                  <span style={{ fontSize: 12.5, color: 'var(--aq-text-muted)' }}>
                    Assigned by the register when you issue this contract - it is not typed, and a draft
                    you abandon does not use one up.
                  </span>
                )}
              </div>
            )}
            {fillFields.length === 0 ? (
              <div className="aq-card" style={{ padding: 20, fontSize: 13, color: 'var(--aq-text-muted)' }}>
                This template version has no merge fields - nothing to fill. The document is fixed as published.
              </div>
            ) : (
              <div className="aq-card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
                {fillFields.map((f) => (
                  <FieldInput key={f.key} field={f} value={values[f.key] ?? ''} editable={!!editable}
                    options={sortListValues(((f.list_id ? lists.valuesByList[f.list_id] : undefined) ?? []).filter((v) => v.active))}
                    allowed={listsByKey[f.key]}
                    onChange={(v) => ed.setValue(f.key, v)} />
                ))}
              </div>
            )}

            {optionalBlocks.length > 0 && (
              <>
                <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase',
                  color: 'var(--aq-text-muted)', marginTop: 6 }}>Optional clauses</div>
                <div className="aq-card" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {optionalBlocks.map((b) => {
                    const included = !offIds.includes(b.id);
                    const snippet = blockAllText(b).slice(0, 90) || '(empty clause)';
                    return (
                      <label key={b.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start',
                        opacity: included ? 1 : 0.55, cursor: editable ? 'pointer' : 'default' }}>
                        <input type="checkbox" checked={included} disabled={!editable}
                          onChange={() => ed.toggleBlockOff(b.id, included)} style={{ marginTop: 3 }} />
                        <span dir="auto" style={{ fontSize: 12.5, minWidth: 0 }}>{snippet}</span>
                        {!editable && (
                          <span className={`aq-badge ${included ? 'aq-badge-success' : 'aq-badge-muted'}`}
                            style={{ marginInlineStart: 'auto' }}>{included ? 'Included' : 'Excluded'}</span>
                        )}
                      </label>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          {/* Live preview */}
          <div style={{ flex: '1 1 360px', minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase',
              color: 'var(--aq-text-muted)', marginBottom: 12 }}>Preview</div>
            <div className="aq-card" style={{ padding: 22 }} dir={dir}>
              <PreviewBody blocks={visible} values={values} />
            </div>
          </div>
        </div>
        </>
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
        if (b.block_type === 'table') {
          const cols = tableColumns(b);
          if (!cols.length) return null;
          const rows = parseTableRows(values[tableKey(b.id)]);
          return (
            <table key={b.id} style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, margin: '6px 0' }}>
              <thead>
                <tr>{cols.map((c) => <th key={c.key} style={{ border: '1px solid var(--aq-border)', padding: '3px 6px', textAlign: 'start', background: 'var(--aq-surface-2, rgba(0,0,0,0.04))' }}>{c.label}</th>)}</tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={cols.length} style={{ border: '1px solid var(--aq-border)', padding: '3px 6px', color: 'var(--aq-text-muted)', textAlign: 'center' }}>(no rows)</td></tr>
                ) : rows.map((r, ri) => (
                  <tr key={ri}>{cols.map((c) => <td key={c.key} dir="auto" style={{ border: '1px solid var(--aq-border)', padding: '3px 6px' }}>{r[c.key] ?? ''}</td>)}</tr>
                ))}
              </tbody>
            </table>
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

/**
 * The contract side of a table block: the operator adds rows and fills each
 * typed cell (a list column is a dropdown, a number is bounded, a date is a
 * date). Rows are stored as JSON in a reserved field, frozen at issue.
 */
function TableFill({
  block, placeholders, lists, rows, editable, onChange,
}: {
  block: TemplateBlock;
  placeholders: Placeholder[];
  lists: ReturnType<typeof useManagedLists>;
  rows: TableRow[];
  editable: boolean;
  onChange: (rows: TableRow[]) => void;
}) {
  const cols = tableColumnFields(tableColumns(block), placeholders);
  const setCell = (ri: number, key: string, val: string) => onChange(rows.map((r, i) => (i === ri ? { ...r, [key]: val } : r)));
  const addRow = () => onChange([...rows, emptyTableRow(cols)]);
  const removeRow = (ri: number) => onChange(rows.filter((_, i) => i !== ri));

  if (cols.length === 0) {
    return (
      <div className="aq-card" style={{ padding: 14, fontSize: 13, color: 'var(--aq-text-muted)' }}>
        This table has no columns yet (or none are registered fields).
      </div>
    );
  }
  return (
    <div className="aq-card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--aq-text-muted)' }}>Table</div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              {cols.map((c) => <th key={c.key} style={{ border: '1px solid var(--aq-border-light)', padding: '4px 6px', textAlign: 'start', whiteSpace: 'nowrap' }}>{c.label}</th>)}
              {editable && <th style={{ border: '1px solid var(--aq-border-light)', padding: '4px 6px', width: 36 }} />}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={cols.length + (editable ? 1 : 0)} style={{ border: '1px solid var(--aq-border-light)', padding: '8px 6px', color: 'var(--aq-text-muted)', textAlign: 'center' }}>No rows yet.</td></tr>
            ) : rows.map((r, ri) => (
              <tr key={ri}>
                {cols.map((c) => (
                  <td key={c.key} style={{ border: '1px solid var(--aq-border-light)', padding: '2px 4px', minWidth: 90 }}>
                    <CellInput field={c.field} value={r[c.key] ?? ''} editable={editable} lists={lists} onChange={(v) => setCell(ri, c.key, v)} />
                  </td>
                ))}
                {editable && (
                  <td style={{ border: '1px solid var(--aq-border-light)', padding: '2px 4px', textAlign: 'center' }}>
                    <button className="aq-btn aq-btn-ghost" onClick={() => removeRow(ri)} title="Remove row" style={{ padding: '2px 6px' }}>&times;</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editable && <button className="aq-btn aq-btn-secondary" onClick={addRow} style={{ alignSelf: 'flex-start' }}>+ Add row</button>}
    </div>
  );
}

function CellInput({
  field, value, editable, lists, onChange,
}: {
  field: Placeholder; value: string; editable: boolean;
  lists: ReturnType<typeof useManagedLists>;
  onChange: (v: string) => void;
}) {
  if (!editable) {
    return <span dir="auto" style={{ fontSize: 13 }}>{value || <span style={{ color: 'var(--aq-text-muted)' }}>-</span>}</span>;
  }
  const allowed = field.field_type === 'list' && field.list_id
    ? (lists.valuesByList[field.list_id] ?? []).filter((v) => v.active).map((v) => v.value) : undefined;
  const err = validateFieldValue(
    { field_type: field.field_type, required: false, num_min: field.num_min, num_max: field.num_max },
    value, allowed ? { values: allowed } : undefined,
  );
  const bad = err ? { boxShadow: 'inset 0 0 0 1.5px var(--aq-danger, #c0392b)', borderRadius: 6 } : {};

  if (field.field_type === 'list') {
    const opts = sortListValues(((field.list_id ? lists.valuesByList[field.list_id] : undefined) ?? []).filter((v) => v.active));
    return (
      <select className="aq-select" value={value} onChange={(e) => onChange(e.target.value)} title={err ?? undefined} style={{ width: '100%', minWidth: 90, ...bad }}>
        <option value="">{'--'}</option>
        {opts.map((o) => <option key={o.id} value={o.value}>{o.label || o.value}</option>)}
      </select>
    );
  }
  if (field.field_type === 'number') {
    return <input type="number" className="aq-input" value={value} onChange={(e) => onChange(e.target.value)} min={field.num_min ?? undefined} max={field.num_max ?? undefined} title={err ?? undefined} style={{ width: '100%', minWidth: 80, ...bad }} />;
  }
  if (field.field_type === 'date') {
    return <input type="date" className="aq-input" value={value} onChange={(e) => onChange(e.target.value)} title={err ?? undefined} style={{ width: '100%', minWidth: 130, ...bad }} />;
  }
  if (field.field_type === 'auto') {
    return <input dir="auto" className="aq-input" value={value} readOnly placeholder="auto" style={{ width: '100%', opacity: 0.7 }} />;
  }
  return <input dir="auto" className="aq-input" value={value} onChange={(e) => onChange(e.target.value)} title={err ?? undefined} style={{ width: '100%', minWidth: 90, ...bad }} />;
}
