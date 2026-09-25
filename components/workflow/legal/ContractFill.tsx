'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  useContractEditor, useLegalPlaceholders, useManagedLists, useContractSources, sha256Hex,
  useSupersedeLinks, raiseCorrection, fileSignedCopy, removeSignedCopy, signedCopyUrl,
} from '@/hooks/use-legal';
import {
  hasSignedCopy, cannotFileSigned, validateSignedFile, signedNote, humanBytes,
  SIGNED_EXTENSIONS,
} from '@/lib/legal-signed';
import {
  supersedeState, supersedeNote, supersedeBadge, supersedeLabel, cannotSupersede,
  validateSupersedeReason, printReplacesLine, printReplacedLine, isLiveCorrection,
  REASON_MAX,
} from '@/lib/legal-supersede';
import {
  UGC_BRAND_KEY, UGC_BANK_KEYS, bankAccountLabel, bankValuesFor, matchBankAccount,
  licenceParty, vendorPickerHint, CONTRACT_NO_KEY, type ContractVendor,
  performerName, datedValues, dayKeyFor, DATE_DAY_PAIRS, UGC_DATE_KEY, UGC_DAY_KEY, UGC_PERFORMER_KEY,
  FIELD_GROUPS, fieldGroup, normalizeHandle, handleBody, UGC_CHANNEL_KEY, type FieldGroup,
  UGC_PLATFORM_KEY, UGC_AD_TYPE_KEY, MULTI_KEYS, QTY_KEYS,
  newBankAccountError, normaliseIban, type VendorBankAccount,
  parseQuantified, joinQuantified, quantityOf, setQuantity, totalQuantity,
  parsePlatforms, joinPlatforms, parsePlatformHandles,
  platformHandlePairs, joinPlatformHandles,
} from '@/lib/legal-prefill';
import { useLegacyVendors, addVendorBank, type WorkspaceRole } from '@/hooks/use-workflow';
import { SearchablePicker } from '@/components/workflow/SearchablePicker';
import {
  fillFieldsForBlocks, validateFieldValue, contractReady, fillPlaceholders,
  blockText, blockKV, detectDir, sortListValues,
  contractStatusLabel, contractStatusBadge, contractPrintHTML, printReference,
  contractCanonical, formatFingerprint, visibleBlocks, blockAllText,
  contractDateAlerts, hasBlockingAlert, dateAlertLabel,
  tableColumns, tableColumnFields, tableKey, parseTableRows, serializeTableRows, emptyTableRow, tableHasInvalidCell,
  tableRowSource, tableRowsFor, fillSegments,
  optionalGroups, toggleOptionalGroup, serializeOffIds, OPT_OFF_KEY,
  previewRows, type OptionalGroup,
  type Placeholder, type TemplateBlock, type TableRow, type FillSegment,
  cannotIssue, canApprove, approvalNote, printApproval, PRINT_HEADER_HINT, splitQuantity,
} from '@/lib/legal';
import { editTemplateWarning } from '@/lib/legal-doc-view';
import { LegalEditor } from '@/components/workflow/legal/LegalEditor';
import { useConfirm } from '@/components/ui/ConfirmDialog';
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
  workspaceId, contractId, onBack, onOpen, role,
}: {
  workspaceId?: string; contractId: string; onBack: () => void;
  /** Who is looking. Only an owner may approve a draft for issue (migration
   *  128), and a button that is about to be refused should not be offered. */
  role?: WorkspaceRole | null;
  /** Open a different contract in place - how a freshly raised correction is
   *  handed over. Falls back to going Back when the parent does not offer it. */
  onOpen?: (id: string) => void;
}) {
  const ed = useContractEditor(workspaceId ?? null, contractId);
  const reg = useLegalPlaceholders(workspaceId ?? null);
  const lists = useManagedLists(workspaceId ?? null);
  const { links: sup } = useSupersedeLinks(workspaceId ?? null);
  const { contract, blocks, values, loading, error, busy, editable, fingerprint, issuedAt, offIds } = ed;

  // An owner approves the draft before it can be issued (migration 128), and
  // any change to the values takes the approval back - see setValue, which
  // mirrors the trigger so the button never offers what the database refuses.
  const approvalBlocked = cannotIssue(contract as any);
  // The name comes off the contract row itself (migration 129), not from a
  // profile lookup - so it costs nothing here, and it is the name that was
  // true when the approval happened rather than whatever that person is
  // called today. approvalNote handles a missing one by leaving it out.
  const approverName = String(contract?.approved_name ?? '').trim();

  // Correcting an issued contract (migration 116). The original is never
  // touched - a correction is a NEW contract pointing back at this one, so
  // nothing here needs the freeze relaxed and this contract's fingerprint
  // still verifies afterwards.
  const [correcting, setCorrecting] = useState(false);
  const [reason, setReason] = useState('');
  const [raising, setRaising] = useState(false);
  const [supErr, setSupErr] = useState('');
  const supState = contract ? supersedeState(contract, sup) : 'none';
  const supNote = contract ? supersedeNote(contract, sup) : null;
  const supBlocked = contract ? cannotSupersede(contract, sup) : 'No contract loaded.';
  const reasonErr = validateSupersedeReason(reason);

  // The signed counterpart (migration 117). Nothing in this app signs
  // anything: the contract goes out, comes back on paper, and the scan of it
  // is the evidence. Filing that IS the act of signing here, and it does not
  // unfreeze one field - a signed contract is an issued contract with its
  // counterpart attached.
  const [filing, setFiling] = useState(false);
  const [signedOn, setSignedOn] = useState('');
  const [signErr, setSignErr] = useState('');

  /** Whether the template editor is open over this screen. See below. */
  const [editingTemplate, setEditingTemplate] = useState(false);

  // The app's own dialog. Siraj, on Chrome's: "fix this add an actual thing".
  const { ask, dialog } = useConfirm();
  const signBlocked = contract ? cannotFileSigned(contract as any) : 'No contract loaded.';
  const onFile = contract ? hasSignedCopy(contract as any) : false;

  // The vendor book, already paged and cached, with each talent's licence org
  // attached - the same list the campaign page uses, so no second read of
  // three thousand rows just for this picker.
  const { vendors } = useLegacyVendors();

  // The brand and bank pickers. Both only appear when this template actually
  // uses those fields, so a template that names neither is unchanged.
  const { brands, banks, reload: reloadSources } = useContractSources(contract ?? null);

  // The blocks that make up this contract: all except optional clauses switched
  // off. Everything downstream - fields, preview, print, fingerprint - works
  // from the visible set, so an excluded clause and its fields simply vanish.
  const visible = useMemo(() => visibleBlocks(blocks, offIds), [blocks, offIds]);
  // One entry per DECISION, not per block. A clause is a section - section
  // five is nine blocks and one choice - so blocks sharing an optional_group
  // (114) collapse into a single switch carrying all their ids. An optional
  // block with no group is still its own switch, which is what it was before
  // groups existed.
  // The off-list rides along so a data row that is already switched off
  // keeps its switch - see optionalGroups. Otherwise there would be no way
  // to put it back.
  const optGroups = useMemo(() => optionalGroups(blocks, offIds), [blocks, offIds]);
  // Only the add-rows tables get a TableFill above the form. A one-row table
  // (a vendor contract's outputs table) has no rows to add: its four cells are
  // ordinary fields and appear in the Fields card like any other.
  const tableBlocks = useMemo(
    () => visible.filter((b) => b.block_type === 'table' && tableRowSource(b) === 'rows'),
    [visible],
  );

  // The fields the visible wording uses, in first-appearance order.
  const fields = useMemo(
    () => fillFieldsForBlocks(visible, reg.placeholders),
    [visible, reg.placeholders],
  );

  // Two of them are never typed. The contract number is assigned by
  // legal.reserve_contract_number the moment before issue, so a typed value
  // would be overwritten and an abandoned draft would have burned a number.
  // The weekday is derived from the date, and a weekday edited apart from its
  // date is a contract that contradicts itself on line four. Both are shown
  // read-only above the form instead.
  // EVERY weekday field, not just the UGC one. A derived field is not typed
  // in: it is shown beside the date it follows. Listing only `day` meant the
  // client contract's C_DAY was rendered as an editable box that said
  // "Filled automatically" while nothing filled it.
  const DERIVED_KEYS = useMemo(
    () => [CONTRACT_NO_KEY, ...Object.values(DATE_DAY_PAIRS)], [],
  );
  const fillFields = useMemo(() => fields.filter((f) => !DERIVED_KEYS.includes(f.key)), [fields, DERIVED_KEYS]);
  const usesContractNo = useMemo(() => fields.some((f) => f.key === CONTRACT_NO_KEY), [fields]);
  /** Whichever date field THIS template has, and the weekday it fills. */
  const dateKey = useMemo(
    () => fields.find((f) => f.field_type === 'date' && dayKeyFor(f.key))?.key ?? '',
    [fields],
  );
  const dayKey = dateKey ? dayKeyFor(dateKey) : null;
  const usesDay = !!dayKey && fields.some((f) => f.key === dayKey);

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
  // The platforms this contract names, which decide how many handle boxes the
  // channel field draws. Siraj: "if you choose more than one platform it will
  // put two drop downs based on the platforms chosen". One field still holds
  // them - the document prints one line - so the list is parsed back out of it.
  const platformList = useMemo(
    () => parsePlatforms(values[UGC_PLATFORM_KEY] ?? ''),
    [values],
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

  // The contract's own date, Riyadh's rather than the browser's: a contract
  // drafted at 1am in Jeddah is dated today there, not yesterday in UTC.
  //
  // Set in an effect, not in a useMemo. A useMemo with an empty dep list
  // still runs during the FIRST render, which on Next.js is the SERVER, and
  // that breaks this twice over:
  //
  //   * across midnight in Riyadh the server's answer and the browser's
  //     differ, and this value is STAMPED ONTO THE CONTRACT - which of the
  //     two wins would depend on render timing;
  //   * `timeZone: 'Asia/Riyadh'` needs full ICU. A node build without it
  //     does not throw, it quietly ignores the zone and returns UTC's day.
  //
  // In an effect it only ever runs in the browser, where the zone is real.
  const [riyadhToday, setRiyadhToday] = useState('');
  useEffect(() => {
    setRiyadhToday(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' }));
  }, []);

  /**
   * The date and the weekday move together, always - for WHICHEVER template
   * this contract is on.
   *
   * This used to write UGC_DATE_KEY and UGC_DAY_KEY whatever was edited, so
   * the client contract's C_DATE and C_DAY were two unrelated boxes and the
   * weekday sat there saying "Filled automatically" while nothing filled it.
   * dayKeyFor says which weekday a given date fills, and a date that fills
   * none just sets itself.
   */
  const setDate = (dateKey: string, iso: string) => {
    const dayKey = dayKeyFor(dateKey);
    const next = datedValues(values, iso, dateKey);
    ed.setValue(dateKey, next[dateKey] ?? '');
    if (dayKey) ed.setValue(dayKey, next[dayKey] ?? '');
  };

  // A draft that reaches the screen with no date gets today's, once. Nobody
  // should have to type the date of the contract they are writing now, and the
  // weekday is not something to work out by hand.
  const usesDate = !!dateKey;
  const [dateStamped, setDateStamped] = useState(false);
  useEffect(() => {
    if (loading || !contract || !editable || !usesDate || dateStamped) return;
    if ((values[dateKey] ?? '') !== '') { setDateStamped(true); return; }
    setDateStamped(true);
    if (!riyadhToday) return;   // not known until the effect above has run
    setDate(dateKey, riyadhToday);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, contract, editable, usesDate, dateKey, dateStamped, riyadhToday]);

  // Date alerts: a tracked date that is expired blocks Issue; expiring-soon warns.
  //
  // `today` is set in an effect, not read during render. Two reasons, and
  // LegalCases already fixed the same thing for the same ones:
  //
  //   * Read during render it is a FRESH STRING every time, so it never
  //     matches the memo's dep and contractDateAlerts re-ran on every
  //     keystroke in the form. The memo was decoration.
  //   * Next.js renders this on the server too, so across a midnight
  //     boundary the server's day and the browser's day differ and React
  //     reports a hydration mismatch.
  const [today, setToday] = useState('');
  useEffect(() => { setToday(new Date().toISOString().slice(0, 10)); }, []);
  const dateAlerts = useMemo(
    () => (today ? contractDateAlerts(fields, values, today) : []),
    [fields, values, today],
  );
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

  /** The record-backed picker for a card, rendered inside the card its fields
   *  sit on rather than in one strip above everything: the brand belongs with
   *  the job, the vendor with the vendor, the bank account with the money. */
  const pickerFor = (g: FieldGroup) => {
    if (!editable || !contract) return null;
    if (g === 'contract') return usesBrand ? (
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
    ) : null;
    if (g === 'vendor') return usesVendor ? (
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
            // The outputs table names the performer, first and last.
            // For talent on their own licence that IS the licence
            // name; under an agency it is the influencer, not the
            // agency, which is who the table is about.
            ed.setValue(UGC_PERFORMER_KEY, performerName(vend as ContractVendor | null));
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
    ) : null;
    if (g === 'payment') return usesBank ? (
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
        ) : null}

        {/* Siraj: "if a vendor doesnt have an iban you can save an iban from
            inside the task ... but if the vendor doesnt exist you have to go
            create them".

            So the two dead ends are treated differently, because they are
            different problems. A vendor WITH no account is a gap you can fill
            without leaving the contract - the account is saved against the
            vendor, so it is there next time too. NO VENDOR is not a gap, it
            is a missing record, and inventing one from a contract screen is
            how a second half-filled vendor gets created. That one still sends
            you to the registry. */}
        {contract.vendor_id != null ? (
          <AddBankAccount vendorId={Number(contract.vendor_id)} editable={editable}
            first={banks.length === 0}
            onSaved={(a) => {
              const v = bankValuesFor(a);
              for (const k of UGC_BANK_KEYS) ed.setValue(k, v[k] ?? '');
              reloadSources();
            }} />
        ) : (
          <div style={{ fontSize: 12.5, color: 'var(--aq-text-muted)' }}>
            No vendor on this contract yet. Add the vendor first - their bank
            details are saved against them, not against this contract.
          </div>
        )}
      </div>
    ) : null;
    return null;
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
        // The contract NUMBER once it has one. This printed the first eight
        // characters of the row id while the register showed the number
        // beside the same contract - the id fragment means nothing to
        // anybody holding the paper. printReference is the one answer, and
        // the batch print uses it too.
        reference: printReference(contract),
        // ISO, not toLocaleDateString(). With no locale argument that call
        // takes whatever the operator's browser is set to, so the SAME
        // contract printed from two machines carried 9/22/2026 and
        // 22/09/2026. A date on a legal document does not depend on who
        // pressed print.
        generatedOn: new Date().toISOString().slice(0, 10),
        fingerprint: fingerprint ? formatFingerprint(fingerprint) : undefined,
        // The owner's signing line. Undefined on an unapproved draft, and
        // then nothing is printed - see printApproval.
        approval: printApproval(contract),
        // A reprint of a replaced contract says so, loudly. The one moment
        // this matters is somebody pulling an old copy off the printer and
        // handing it over as the current agreement.
        replacedBy: (() => {
          const by = sup.correctionOf?.[contract.id];
          return by && isLiveCorrection(by) ? (printReplacedLine(by) ?? undefined) : undefined;
        })(),
        replaces: printReplacesLine(sup.replaces?.[contract.id]) ?? undefined,
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

  /* -- Editing the template, from the contract ------------------------
   *
   * Siraj: "or edit on the top of the preview to edit any part of the
   * template". The template editor opens IN PLACE rather than sending anybody
   * to Documents to find the right template by name - it is the same
   * component the Documents screen mounts, given this contract's template id.
   *
   * Coming back reloads the contract. Nothing about THIS contract can have
   * changed (it is stamped to its own version, and a published version is
   * frozen), but a new draft version may now exist, and a reload is cheaper
   * than reasoning about which of those two things happened.
   */
  if (editingTemplate && contract) {
    return (
      <LegalEditor workspaceId={workspaceId} templateId={contract.template_id}
        onBack={() => { setEditingTemplate(false); void ed.reload(); }} />
    );
  }

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
            title={`Open a print-ready copy to print or save as PDF. ${PRINT_HEADER_HINT}`}
          >Print / Save as PDF</button>
        )}
        {/* Shown on anything that is not a draft, and DISABLED WITH A REASON
            rather than hidden when it cannot be used. A button that vanishes
            teaches nobody why. */}
        {contract && !editable && (
          <button className="aq-btn aq-btn-ghost" disabled={loading || !!supBlocked}
            onClick={() => { setReason(''); setCorrecting(true); }}
            title={supBlocked ?? 'Raise a correction: a new contract that replaces this one'}>
            Correct
          </button>
        )}
        {contract && editable && (
          <>
            <button className="aq-btn aq-btn-ghost" disabled={busyAll} onClick={saveDraft}>Save draft</button>
            {/* The approval, beside the thing it gates. Only an owner sees a
                button; everybody else sees where it stands, so "why can I not
                issue this" is answered on the screen rather than by asking. */}
            {canApprove(role) && !contract?.approved_at && (
              <button className="aq-btn aq-btn-ghost" disabled={busyAll}
                onClick={() => { void ed.approve(); }}
                title="Approve this draft so it can be issued. Any change to the values takes the approval back.">
                Approve for issue
              </button>
            )}
            {canApprove(role) && contract?.approved_at && (
              <button className="aq-btn aq-btn-ghost" disabled={busyAll}
                onClick={() => { void ed.unapprove(); }}
                title="Take the approval back">
                Take approval back
              </button>
            )}
            <button className="aq-btn aq-btn-primary"
              disabled={busyAll || !ready || blocked || tablesInvalid || !!approvalBlocked}
              onClick={issue}
              title={approvalBlocked ? approvalBlocked
                : blocked ? 'A tracked date is expired - fix it before issuing'
                : tablesInvalid ? 'A table cell is out of range or off-list - fix it before issuing'
                : ready ? 'Freeze the values and issue the contract' : 'Fill every required field first'}>
              Issue contract
            </button>
          </>
        )}
      </div>

      {/* Where the approval stands, said in words. An issued contract from
          before 128 says why it has none rather than reading as a defect. */}
      {contract && (
        <p style={{ fontSize: 12.5,
          color: contract.approved_at ? 'var(--aq-text-secondary)' : 'var(--aq-text-muted)' }}>
          {approvalNote(contract as any, {
            who: approverName,
            at: contract.approved_at ? new Date(contract.approved_at).toLocaleDateString() : '',
          })}
          {editable && !contract.approved_at && !canApprove(role)
            ? ' An owner has to approve it before it can be issued.' : ''}
        </p>
      )}

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
      {/* What this contract IS, before anything else on the screen. A replaced
          contract that looks exactly like a live one is the whole failure
          supersede exists to prevent, and the screen is where somebody looks
          first. */}
      {contract && supNote && (
        <div className="aq-card" style={{ padding: 12, display: 'flex', alignItems: 'center',
          gap: 10, flexWrap: 'wrap' }}>
          <span className={`aq-badge ${supersedeBadge(supState)}`}>{supersedeLabel(supState)}</span>
          <span style={{ fontSize: 13, color: 'var(--aq-text-secondary)' }}>{supNote}</span>
        </div>
      )}

      {!editable && contract && (
        <div className="aq-card" style={{ padding: 12, fontSize: 13, color: 'var(--aq-text-secondary)' }}>
          This contract is {contractStatusLabel(contract.status).toLowerCase()} and its field values are frozen.
          {supState === 'replaced' ? ' It stays readable, and keeps its number, because it is the record of what was agreed at the time.'
            : ' To change what it says, raise a correction - a new contract that replaces this one.'}
        </div>
      )}

      {correcting && contract && (
        <div role="dialog" aria-modal="true" style={{
          position: 'fixed', inset: 0, background: 'var(--aq-backdrop, rgba(0,0,0,0.4))',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16,
        }} onClick={() => !raising && setCorrecting(false)}>
          <div className="aq-card" style={{ padding: 22, width: 'min(520px, 100%)' }}
            onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 10 }}>Correct this contract</h3>
            <p style={{ fontSize: 13, color: 'var(--aq-text-secondary)', marginBottom: 14 }}>
              {contract.contract_no || 'This contract'} keeps its number and stays exactly as it was issued.
              A new draft is created with the same wording and the same values, ready to fix, and it takes
              its own number when you issue it. Both say on their face what replaced what.
            </p>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600,
              color: 'var(--aq-text-muted)', marginBottom: 4 }}>What is being corrected?</label>
            <textarea className="aq-input" value={reason} maxLength={REASON_MAX} rows={3} autoFocus
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. the fee was typed as 12,500 and the booking says 9,000"
              style={{ width: '100%', resize: 'vertical' }} />
            <p style={{ fontSize: 12, color: 'var(--aq-text-muted)', marginTop: 6 }}>
              In a year this is the only record of why two numbered contracts exist for one agreement.
            </p>
            {reason.trim() && reasonErr && (
              <div className="aq-badge aq-badge-warning" style={{ display: 'block', marginTop: 10, padding: 8 }}>{reasonErr}</div>
            )}
            {supErr && (
              <div className="aq-badge aq-badge-error" style={{ display: 'block', marginTop: 10, padding: 8 }}>{supErr}</div>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18 }}>
              <button className="aq-btn aq-btn-ghost" disabled={raising}
                onClick={() => setCorrecting(false)}>Cancel</button>
              <button className="aq-btn aq-btn-primary" disabled={raising || !!reasonErr}
                onClick={async () => {
                  if (!workspaceId || !contract) return;
                  setRaising(true); setSupErr('');
                  try {
                    const id = await raiseCorrection({
                      workspaceId, original: contract, reason, values,
                    });
                    setCorrecting(false);
                    // Straight into the new draft: the next thing anybody
                    // wants is to fix the thing they just said was wrong.
                    if (onOpen) onOpen(id); else onBack();
                  } catch (e: any) {
                    setSupErr(e?.message ?? 'Could not raise the correction.');
                  } finally { setRaising(false); }
                }}>
                {raising ? 'Creating\u2026' : 'Create the correction'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* The signed counterpart. Sits directly above the fingerprint card
          because the two answer the same question from opposite ends: the
          fingerprint says what we issued, this says what came back. */}
      {contract && !editable && (signBlocked === null || onFile) && (
        <div className="aq-card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.04em',
              textTransform: 'uppercase', color: 'var(--aq-text-muted)' }}>Signed copy</span>
            {onFile
              ? <span className="aq-badge aq-badge-success">On file</span>
              : <span className="aq-badge aq-badge-warning">Not back yet</span>}
          </div>

          {onFile ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: 'var(--aq-text-secondary)' }}>
                {signedNote(contract as any, {
                  on: contract.signed_on ? new Date(`${contract.signed_on}T00:00:00`).toLocaleDateString() : undefined,
                  recorded: contract.signed_recorded_at
                    ? new Date(contract.signed_recorded_at).toLocaleDateString() : undefined,
                }) ?? 'On file'}
              </span>
              <button className="aq-btn aq-btn-ghost" disabled={filing}
                onClick={async () => {
                  setSignErr('');
                  const url = await signedCopyUrl(String(contract.signed_path), contract.signed_name);
                  if (url) window.open(url, '_blank');
                  else setSignErr('Could not open the signed copy.');
                }}>Open</button>
              <button className="aq-btn aq-btn-ghost" disabled={filing}
                title="Take the signed copy off. The contract goes back to issued."
                onClick={async () => {
                  if (!await ask({
                    message: 'Remove the signed copy? The contract goes back to issued.',
                    confirmLabel: 'Remove it', tone: 'danger',
                  })) return;
                  setFiling(true); setSignErr('');
                  try { await removeSignedCopy(contract); await ed.reload(); }
                  catch (e: any) { setSignErr(e?.message ?? 'Could not remove it.'); }
                  finally { setFiling(false); }
                }}>Remove</button>
            </div>
          ) : (
            <>
              <p style={{ fontSize: 12.5, color: 'var(--aq-text-muted)', margin: 0 }}>
                A PDF or a photo of the signed pages. Filing it marks the contract signed -
                the values stay frozen and the fingerprint is untouched.
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <label style={{ fontSize: 12.5, color: 'var(--aq-text-muted)', flex: '0 0 auto' }}>
                  Date on the document
                </label>
                <input className="aq-input" type="date" value={signedOn}
                  onChange={(e) => setSignedOn(e.target.value)}
                  title="The date written on the paper - not today, if they differ."
                  style={{ flex: '0 0 auto', width: 'auto' }} />
                <label className="aq-btn aq-btn-primary"
                  style={{ flex: '0 0 auto', cursor: filing ? 'default' : 'pointer', opacity: filing ? 0.6 : 1 }}>
                  {filing ? 'Filing\u2026' : 'Upload the signed copy'}
                  <input type="file" hidden disabled={filing}
                    accept={SIGNED_EXTENSIONS.map((x) => `.${x}`).join(',')}
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      e.currentTarget.value = '';
                      if (!f || !workspaceId || !contract) return;
                      const bad = validateSignedFile({ name: f.name, size: f.size });
                      if (bad) { setSignErr(bad); return; }
                      setFiling(true); setSignErr('');
                      try {
                        await fileSignedCopy({
                          workspaceId, contract, file: f, signedOn: signedOn || null,
                        });
                        await ed.reload();
                      } catch (err: any) {
                        setSignErr(err?.message ?? 'Could not file the signed copy.');
                      } finally { setFiling(false); }
                    }} />
                </label>
                <span style={{ fontSize: 11.5, color: 'var(--aq-text-muted)' }}>
                  {`up to ${humanBytes(25 * 1024 * 1024)}`}
                </span>
              </div>
            </>
          )}

          {signErr && (
            <div className="aq-badge aq-badge-error" style={{ display: 'block', padding: 9 }}>{signErr}</div>
          )}
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
                {usesDay && (
                  <>
                    <span style={{ fontSize: 13, fontWeight: 600, marginInlineStart: 12 }}>Day</span>
                    <span dir="auto" style={{ fontSize: 13 }}>
                      {(dayKey && values[dayKey]) || <span style={{ color: 'var(--aq-text-muted)' }}>set the date first</span>}
                    </span>
                  </>
                )}
              </div>
            )}
            {fillFields.length === 0 ? (
              <div className="aq-card" style={{ padding: 20, fontSize: 13, color: 'var(--aq-text-muted)' }}>
                This template version has no merge fields - nothing to fill. The document is fixed as published.
              </div>
            ) : FIELD_GROUPS.map((g) => {
              const groupFields = fillFields.filter((f) => fieldGroup(f.key) === g.key);
              const picker = pickerFor(g.key);
              if (!groupFields.length && !picker) return null;
              return (
                <div key={g.key} className="aq-card" style={{ padding: 16, display: 'flex',
                  flexDirection: 'column', gap: 14 }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.05em',
                      textTransform: 'uppercase', color: 'var(--aq-text-muted)' }}>{g.label}</div>
                    <div style={{ fontSize: 12, color: 'var(--aq-text-muted)', marginTop: 2 }}>{g.hint}</div>
                  </div>
                  {picker}
                  {groupFields.map((f) => (
                    <FieldInput key={f.key} field={f} value={values[f.key] ?? ''} editable={!!editable}
                      options={sortListValues(((f.list_id ? lists.valuesByList[f.list_id] : undefined) ?? []).filter((v) => v.active))}
                      allowed={listsByKey[f.key]}
                      platforms={platformList}
                      hint={dayKeyFor(f.key)
                        ? `The weekday follows this date: ${values[dayKeyFor(f.key)!] || '-'}`
                        : undefined}
                      onChange={(v) => (dayKeyFor(f.key) ? setDate(f.key, v) : ed.setValue(f.key, v))} />
                  ))}
                </div>
              );
            })}

            {/* The clause switches used to live here, as a card of
                checkboxes under the form: seven headings out of context, and
                the decision made a column away from the sentence it is about.
                They are in the preview now, each beside its own clause and in
                the document's order. One control, one place - a second copy
                of the same switch is only somewhere else to look. */}
          </div>

          {/* Live preview */}
          <div style={{ flex: '1 1 360px', minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.05em',
                textTransform: 'uppercase', color: 'var(--aq-text-muted)' }}>Preview</span>
              {/* Not disabled on an issued contract: the wording of the
                  TEMPLATE is a separate thing from this frozen copy of it,
                  and somebody reading a signed contract is exactly who
                  notices a sentence that needs fixing for the next one. */}
              <button className="aq-btn aq-btn-ghost" style={{ marginInlineStart: 'auto', fontSize: 12 }}
                disabled={!contract}
                onClick={async () => {
                  // No name: this screen knows the template's id, not its
                  // title, and a second two-query hook for one word in the
                  // dialog is not worth the round trip. The editor itself
                  // names it on the line above the document.
                  if (!await ask({
                    message: editTemplateWarning(null), confirmLabel: 'Open the editor',
                  })) return;
                  setEditingTemplate(true);
                }}>Edit template</button>
            </div>
            <div className="aq-card" style={{ padding: 22 }} dir={dir}>
              {/* All the blocks, not `visible`: the optional ones carry their
                  own tick here, and an excluded clause leaves a one-line stub
                  so it can be brought back from where it belongs. What is
                  DRAWN is still exactly `visible` - asserted in lib/legal. */}
              <PreviewBody blocks={blocks} values={values}
                groups={optGroups} offIds={offIds} editable={!!editable}
                onToggle={(g, on) => ed.setValue(OPT_OFF_KEY,
                  serializeOffIds(toggleOptionalGroup(g, offIds, on)))} />
            </div>
          </div>
        </div>
        </>
      )}
      {dialog}
    </div>
  );
}

/** The sentinel the Other row carries. Not a value anything stores - picking
 *  it clears the field and opens the text box. */
const OTHER_CHOICE = '__aq_other__';

/**
 * The handle box: a fixed `@` and a name beside it.
 *
 * Siraj: "make sure channle name fits the standared where an @ goes on the left
 * and the name goes on the right". Drawn once and used by both the one-platform
 * field and each row of the several-platform one, so the two cannot drift.
 */
function HandleBox({
  value, onChange, width,
}: { value: string; onChange: (v: string) => void; width?: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'stretch', width: '100%', maxWidth: width ?? 360,
      direction: 'ltr' }}>
      <span style={{ display: 'flex', alignItems: 'center', padding: '0 10px', fontWeight: 700,
        border: '1px solid var(--aq-border)', borderInlineEnd: 'none',
        borderRadius: '6px 0 0 6px', background: 'var(--aq-surface-2, rgba(0,0,0,0.04))',
        color: 'var(--aq-text-muted)' }}>@</span>
      <input className="aq-input" dir="ltr" value={value} placeholder="name"
        onChange={(e) => onChange(e.target.value)}
        style={{ flex: 1, minWidth: 0, borderRadius: '0 6px 6px 0' }} />
    </div>
  );
}

/**
 * A list field you may tick more than one of.
 *
 * Two fields need it and for the same reason. A single dropdown cannot say
 * "Instagram and TikTok", and it cannot say "a reel and three stories" either
 * - Siraj: "one vendor could do multiple ads so this needs to be a drop down
 * and choosable list". The contract app never asked a dropdown to: platforms
 * have always been a row of checkboxes whose keys are comma-joined into one
 * value (app.js:1360, 3616), and this is that, with the Other box the
 * single-select version already had, because something nobody has listed still
 * has to be nameable.
 *
 * The Other text is held locally rather than re-derived from the value on every
 * keystroke: joinPlatforms trims, so a re-derived box would eat the space the
 * moment you typed one and "Ad board" could never be typed. The effect below
 * adopts an external value - the contract finishing its load - without touching
 * what is being typed.
 */
/**
 * How wide a field box gets.
 *
 * Not the full width of the screen. These hold an IBAN, a bank name, a
 * platform - none of them is a paragraph, and a short value in a very wide
 * box reads as unfinished rather than roomy.
 */
const FIELD_WIDTH = 520;

/**
 * Add a bank account to the vendor, without leaving the contract.
 *
 * The fill screen used to end at "This vendor has no bank account on file -
 * add one on their registry page", which is a dead end in the middle of
 * filling a contract: the operator has the details in front of them, on the
 * screen that needs them, and is sent somewhere else to type them.
 *
 * Saved against the VENDOR, not against the contract. The contract only ever
 * holds a copy of the four values, the way picking an existing account does,
 * so the next contract for the same vendor finds the account waiting.
 */
function AddBankAccount({ vendorId, editable, first, onSaved }: {
  vendorId: number;
  editable: boolean;
  /** True when the vendor has none at all, which changes what the link says. */
  first: boolean;
  onSaved: (a: VendorBankAccount) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [form, setForm] = useState({ bank_name: '', account_name: '', account_number: '', iban: '' });

  if (!editable) return null;

  if (!open) {
    return (
      <div style={{ marginTop: first ? 0 : 8 }}>
        {first && (
          <div style={{ fontSize: 12.5, color: 'var(--aq-text-muted)', marginBottom: 6 }}>
            This vendor has no bank account on file.
          </div>
        )}
        <button type="button" className="aq-btn aq-btn-secondary" style={{ fontSize: 12.5 }}
          onClick={() => { setErr(''); setOpen(true); }}>
          {first ? 'Add their bank account' : 'Add another account'}
        </button>
      </div>
    );
  }

  const set = (k: keyof typeof form) => (e: any) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const problem = newBankAccountError(form);

  const save = async () => {
    if (problem) { setErr(problem); return; }
    setBusy(true); setErr('');
    try {
      // Normalised on the way in. People paste an IBAN in fours because that
      // is how a bank prints it, and the picker matches on the stored string.
      const row = await addVendorBank(vendorId, { ...form, iban: normaliseIban(form.iban) });
      setOpen(false);
      setForm({ bank_name: '', account_name: '', account_number: '', iban: '' });
      onSaved(row as unknown as VendorBankAccount);
    } catch (e: any) {
      setErr(e?.message ?? 'Could not save the account.');
    } finally { setBusy(false); }
  };

  const field = (label: string, k: keyof typeof form, dir?: string) => (
    <label style={{ display: 'block', marginBottom: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 3 }}>{label}</div>
      <input className="aq-input" value={form[k]} onChange={set(k)} dir={dir ?? 'auto'}
        disabled={busy} style={{ width: '100%' }} />
    </label>
  );

  return (
    <div style={{
      marginTop: 10, padding: '12px 14px', borderRadius: 'var(--aq-radius)',
      border: '1px solid var(--aq-border-light)', background: 'var(--aq-bg-subtle, transparent)',
      maxWidth: 420,
    }}>
      {field('Bank name', 'bank_name')}
      {field('Account name', 'account_name')}
      {field('Account number', 'account_number', 'ltr')}
      {field('IBAN', 'iban', 'ltr')}
      {/* The reason it cannot save yet, shown while the form is open rather
          than after pressing Save - all four of these print on the contract,
          so a half-filled account fills half the boxes and then blocks Issue
          with no explanation. */}
      {(err || problem) && (
        <div style={{ fontSize: 12.5, color: 'var(--aq-red-strong)', marginBottom: 8 }}>
          {err || problem}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="aq-btn aq-btn-primary" style={{ fontSize: 12.5 }}
          onClick={save} disabled={busy || !!problem}>
          {busy ? 'Saving\u2026' : 'Save to the vendor'}
        </button>
        <button type="button" className="aq-btn aq-btn-ghost" style={{ fontSize: 12.5 }}
          onClick={() => { setOpen(false); setErr(''); }} disabled={busy}>Cancel</button>
      </div>
    </div>
  );
}

export function MultiChoice({
  value, options, editable, onChange, withQuantity = false,
}: {
  value: string;
  options: { id: string; value: string; label: string }[];
  editable: boolean;
  onChange: (v: string) => void;
  /**
   * Show a count beside each ticked item (ad types, not platforms).
   *
   * This also fixes a bug that had nothing to do with the counts being
   * wanted. A contract raised from a booking with ad lines already stored
   * "6 x Home Ad, 3 x Reminder" - fetchBookingPrefill has always written
   * that - and this picker split on the comma and matched each piece
   * against the ad-type list. "6 x Home Ad" matched nothing, so NOTHING WAS
   * TICKED and the whole string sat in the "Other" box. One click from
   * there either duplicated a type ("Home Ad, 6 x Home Ad, ...") or, if she
   * cleared the box that looked like junk, emptied the field.
   */
  withQuantity?: boolean;
}) {
  // Parsed as quantities when this field carries them, so a value the
  // booking wrote is understood rather than dumped in the Other box.
  const chosen = withQuantity ? parseQuantified(value).map((i) => i.name) : parsePlatforms(value);
  const known = options.map((o) => o.value);
  const extra = chosen.filter((v) => !known.includes(v));
  const [otherText, setOtherText] = useState(() => extra.join(', '));

  useEffect(() => {
    const shown = parsePlatforms(otherText);
    if (extra.length !== shown.length || extra.some((v, i) => v !== shown[i])) {
      setOtherText(extra.join(', '));
    }
    // Only when what is STORED disagrees with what is shown; typing keeps them
    // in step, so this does not fire mid-word.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const picked = chosen.filter((v) => known.includes(v));

  // Writing keeps each item's existing count. Ticking a type that is already
  // there at six must leave it at six, not reset it to one - that is the
  // difference between adding a type and re-reading the field.
  const write = (next: string[], other: string) => {
    const names = [...next, ...parsePlatforms(other)];
    if (!withQuantity) { onChange(joinPlatforms(names)); return; }
    onChange(joinQuantified(names.map((n) => ({ qty: quantityOf(value, n) || 1, name: n }))));
  };
  const total = withQuantity ? totalQuantity(value) : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px' }}>
        {options.map((o) => {
          const on = picked.includes(o.value);
          return (
            <label key={o.id} style={{ display: 'flex', alignItems: 'center', gap: 6,
              fontSize: 13, cursor: editable ? 'pointer' : 'default' }}>
              <input type="checkbox" checked={on} disabled={!editable}
                onChange={() => write(on ? picked.filter((v) => v !== o.value) : [...picked, o.value],
                  otherText)} />
              {/* English to choose from, Arabic in the document - the label and
                  the value differ on purpose. */}
              <span>{o.label || o.value}</span>
              {/* The count, only once it is ticked - a number box beside an
                  empty tick box is a question nobody asked. Clearing it to
                  zero unticks the item, so the two cannot disagree. */}
              {withQuantity && on && (
                <input className="aq-input" type="number" min={1} max={999} disabled={!editable}
                  value={quantityOf(value, o.value) || 1}
                  onChange={(e) => onChange(setQuantity(value, o.value, Number(e.target.value)))}
                  onClick={(e) => e.preventDefault()}
                  title={`How many ${o.label || o.value}`}
                  style={{ width: 62, padding: '2px 6px', fontSize: 12.5 }} />
              )}
            </label>
          );
        })}
      </div>
      <input dir="auto" className="aq-input" value={otherText} disabled={!editable}
        onChange={(e) => { setOtherText(e.target.value); write(picked, e.target.value); }}
        placeholder={'Something else? Type it as it should read in the contract'}
        style={{ width: '100%', maxWidth: 420 }} />
      {/* Three types of four is not obviously twelve, and twelve is the
          number whoever signs this cares about. */}
      {withQuantity && total > 0 && (
        <span style={{ fontSize: 12, color: 'var(--aq-text-muted)' }}>
          {total} in total
        </span>
      )}
    </div>
  );
}

function FieldInput({
  field, value, options, allowed, editable, hint, platforms, onChange,
}: {
  field: Placeholder;
  value: string;
  options: { id: string; value: string; label: string }[];
  allowed?: string[];
  editable: boolean;
  /** A line under the control, for a field that drives another one. */
  hint?: string;
  /** The platforms this contract names - one handle box each. */
  platforms?: string[];
  onChange: (v: string) => void;
}) {
  const err = validateFieldValue(field, value, allowed ? { values: allowed } : undefined);
  const label = field.label || field.key;

  // A list field with allow_other keeps an "Other" choice at the bottom.
  // Picking it swaps the dropdown for a text box; a stored value that is not
  // in the list (someone chose Other earlier) reopens the box on load, so the
  // contract does not silently look like nothing was chosen.
  const inList = options.some((o) => o.value === value);
  const [otherOpen, setOtherOpen] = useState(false);
  const other = !!field.allow_other && (otherOpen || (value !== '' && !inList));

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
    // The two lists you may tick more than one of. A vendor who posts the same
    // ad to Instagram and TikTok is one contract naming both, not two; a vendor
    // doing a reel AND three stories is one contract naming both ad types.
    // Everything downstream reads the joined value, so the document and the
    // fingerprint see one field exactly as they always have.
    //
    // Both carry allow_other (111), which is what lets a joined value validate
    // at all - it is not a list member by definition. tests/legal.test.mjs says
    // so out loud, because turning that flag off would quietly make every
    // multi-value contract unissuable.
    if (MULTI_KEYS.includes(field.key) && field.field_type === 'list') {
      return (
        <MultiChoice value={value} options={options} editable={editable} onChange={onChange}
          withQuantity={QTY_KEYS.includes(field.key)} />
      );
    }
    if (field.field_type === 'list') {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <select className="aq-select" value={other ? OTHER_CHOICE : value} style={{ width: '100%' }}
            onChange={(e) => {
              if (e.target.value === OTHER_CHOICE) { setOtherOpen(true); onChange(''); return; }
              setOtherOpen(false);
              onChange(e.target.value);
            }}>
            <option value="">{'-- choose --'}</option>
            {/* The label is what you pick from; the value is what prints. The
                two differ on purpose here: English to choose, Arabic in the
                document. */}
            {options.map((o) => <option key={o.id} value={o.value}>{o.label || o.value}</option>)}
            {field.allow_other && <option value={OTHER_CHOICE}>{'Other\u2026'}</option>}
          </select>
          {other && (
            <input dir="auto" className="aq-input" value={value} autoFocus
              onChange={(e) => onChange(e.target.value)}
              placeholder={'Type it as it should read in the contract'}
              style={{ width: '100%' }} />
          )}
        </div>
      );
    }
    // The channel name is a handle, and a handle has exactly one @ on its left.
    // normalizeHandle is the contract app's own rule (app.js:3569), so the
    // register spells one account one way: @sara, not sara and @@sara too.
    if (field.key === UGC_CHANNEL_KEY) {
      const list = platforms ?? [];
      // Several platforms: one box each, labelled, and the contract still
      // prints the single line the app has always written - "Instagram: @a
      // TikTok: @b". Reading it back out is what lets a saved contract reopen
      // with each handle in its own box instead of all of them in the first.
      if (list.length > 1) {
        const byPlatform = parsePlatformHandles(value, list);
        const line = joinPlatformHandles(platformHandlePairs(list, byPlatform));
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {list.map((p) => (
              <div key={p} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span dir="auto" style={{ fontSize: 12.5, fontWeight: 600, minWidth: 92 }}>{p}</span>
                <HandleBox width={260} value={byPlatform[p] ?? ''}
                  onChange={(h) => onChange(joinPlatformHandles(
                    platformHandlePairs(list, { ...byPlatform, [p]: h })))} />
              </div>
            ))}
            <div style={{ fontSize: 11.5, color: 'var(--aq-text-muted)' }}>
              In the contract: <span dir="auto">{line || '-'}</span>
            </div>
          </div>
        );
      }
      return <HandleBox value={handleBody(value)} onChange={(h) => onChange(normalizeHandle(h))} />;
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

  /*
   * Siraj: "clean it up and make it look presentable it looks too bland and
   * not profetional", with two screenshots of these rows.
   *
   * Every row carried THREE grey things beside its label - the required star,
   * the raw key in monospace, and the type name pushed out to the right edge -
   * and sixteen rows of that is why the eye cannot find the label. Both of the
   * grey ones are developer-facing:
   *
   *   * the TYPE NAME said "Text" above a text box and "List" above a
   *     dropdown. The control is already the answer to that question, so it
   *     is gone.
   *   * the KEY still earns its place - it is how you match a field to the
   *     {{ placeholder }} in the template - but it is an aside, not a second
   *     heading. It sits quietly at the right, where the type name used to
   *     be, so the label owns the left of the row on its own.
   *
   * And the box is capped rather than stretching the full width of the
   * screen. A twenty-character IBAN in a box a thousand pixels wide is the
   * single thing that makes a form look unfinished.
   */
  return (
    <div>
      <label style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 5 }}>
        <span style={{ fontSize: 13.5, fontWeight: 600 }} dir="auto">{label}</span>
        {field.required && <span style={{ color: 'var(--aq-danger, #c0392b)', fontSize: 12 }}>*</span>}
        <span style={{ flex: 1 }} />
        <span title="The name this field has in the template"
          style={{
            fontSize: 10.5, color: 'var(--aq-text-muted)', fontFamily: 'monospace',
            direction: 'ltr', opacity: 0.7,
          }}>{field.key}</span>
      </label>
      <div style={{ maxWidth: FIELD_WIDTH }}>{control()}</div>
      {editable && hint && (
        <div dir="auto" style={{ fontSize: 11.5, color: 'var(--aq-text-muted)', marginTop: 3 }}>{hint}</div>
      )}
      {editable && err && value.trim() !== '' && (
        <div style={{ fontSize: 11.5, color: 'var(--aq-danger, #c0392b)', marginTop: 3 }}>{err}</div>
      )}
    </div>
  );
}

/**
 * A filled line, with the values that came from the form marked.
 *
 * The same three states the live contract app draws (app.js:3983): a filled
 * value is highlighted, a gap is red and underlined, a value something else
 * supplies later is grey. Reading a 42-block Arabic contract to find the one
 * field you forgot is otherwise a spot-the-difference puzzle.
 */
function Filled({ text, values }: { text: string; values: Record<string, string> }) {
  const segs = fillSegments(text, values, {
    missingWord: '\u063a\u064a\u0631 \u0645\u062f\u062e\u0644',
    pendingWord: '\u064a\u064f\u0636\u0627\u0641 \u0639\u0646\u062f \u0627\u0644\u0625\u0646\u0634\u0627\u0621',
    pendingKeys: [CONTRACT_NO_KEY],
  });
  return <>{segs.map((sg, i) => <Seg key={i} s={sg} />)}</>;
}

function Seg({ s }: { s: FillSegment }) {
  if (s.t === 'text') return <>{s.v}</>;
  if (s.missing) {
    return <span style={{ color: 'var(--aq-danger, #c0392b)', fontWeight: 700, whiteSpace: 'nowrap',
      borderBottom: '1px dashed var(--aq-danger, #c0392b)' }}>{s.v}</span>;
  }
  if (s.pending) {
    return <span style={{ color: 'var(--aq-text-muted)', whiteSpace: 'nowrap',
      borderBottom: '1px dashed var(--aq-border)' }}>{s.v}</span>;
  }
  // Filled from the form. Fixed colours, not tokens: this sits on the preview
  // sheet, which is a printed page in both themes.
  return <span style={{ fontWeight: 700, background: '#fbf0b8', color: '#141414',
    padding: '0 3px', borderRadius: 3 }}>{s.v}</span>;
}

/**
 * The document as the screen draws it, with a tick beside each optional
 * clause. Exported because the New-task form shows the same thing before a
 * single contract exists - one component, so the two cannot drift.
 */
export function PreviewBody({
  blocks, values, groups, offIds, editable, onToggle,
}: {
  blocks: TemplateBlock[];
  values: Record<string, string>;
  /** The optional clauses, as decisions. Omitted, the preview has no ticks. */
  groups?: OptionalGroup[];
  offIds?: string[];
  editable?: boolean;
  onToggle?: (g: OptionalGroup, on: boolean) => void;
}) {
  if (!blocks.length) {
    return <div style={{ fontSize: 13, color: 'var(--aq-text-muted)' }}>This version has no content.</div>;
  }
  const rows = previewRows(blocks, groups ?? [], offIds ?? []);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {rows.map((row) => {
        const g = row.group;
        // An excluded clause: one line, an empty box, and its name. Not the
        // paragraph greyed out - the preview is what the paper will say.
        if (g && !row.on) {
          return (
            <ClauseSwitch key={`stub:${g.key}`} group={g} on={false} editable={!!editable}
              text={clauseName(g, blocks)} onToggle={onToggle} stub />
          );
        }
        const b = row.block as TemplateBlock;
        const drawn = <PreviewBlock key={b.id} block={b} values={values} />;
        if (!g) return drawn;
        return (
          <div key={`g:${g.key}`} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <ClauseSwitch group={g} on editable={!!editable}
              text={clauseName(g, blocks)} onToggle={onToggle} />
            {drawn}
          </div>
        );
      })}
    </div>
  );
}

/** A clause's own name for the tick: its heading, or its first words. */
function clauseName(g: OptionalGroup, blocks: TemplateBlock[]): string {
  if (g.label) return g.label;
  const first = blocks.find((b) => b.id === g.firstId);
  return (first ? blockAllText(first).slice(0, 60) : '') || 'Optional clause';
}

/**
 * One tick in the document. Small, muted and above the clause it controls, so
 * the preview still reads as the contract rather than as a form.
 */
function ClauseSwitch({
  group, on, text, editable, onToggle, stub,
}: {
  group: OptionalGroup; on: boolean; text: string; editable: boolean;
  onToggle?: (g: OptionalGroup, on: boolean) => void; stub?: boolean;
}) {
  const live = editable && !!onToggle;
  // Siraj: "the buttons look weird just a checkmark next to the line works".
  // A browser checkbox is a chunky blue OS control; twenty of them down a
  // contract make it a form. This is a 15px square that shows a tick when the
  // clause is in and nothing when it is not - small enough to read as a mark
  // in the margin, big enough to hit.
  return (
    <button type="button" role="switch" aria-checked={on} disabled={!live}
      onClick={() => onToggle?.(group, !on)}
      title={on ? 'In the contract - click to leave it out' : 'Left out - click to put it back'}
      style={{
        display: 'flex', gap: 7, alignItems: 'center', width: '100%',
        background: 'none', border: 'none', padding: 0, font: 'inherit',
        textAlign: 'start', cursor: live ? 'pointer' : 'default',
      }}>
      <span aria-hidden style={{
        flex: '0 0 auto', width: 15, height: 15, borderRadius: 3, lineHeight: '13px',
        fontSize: 11, fontWeight: 700, textAlign: 'center',
        border: `1px solid ${on ? 'var(--aq-ink-btn, #141414)' : 'var(--aq-border)'}`,
        background: on ? 'var(--aq-ink-btn, #141414)' : 'transparent',
        color: on ? 'var(--aq-ink-btn-text, #fff)' : 'transparent',
      }}>{'\u2713'}</span>
      <span dir="auto" style={{
        minWidth: 0, fontSize: 11.5, color: 'var(--aq-text-muted)',
        ...(stub ? { fontStyle: 'italic' } : null),
      }}>
        {text}
        {stub ? ' \u2014 not included' : ''}
      </span>
    </button>
  );
}

/** One block of the document, as the preview draws it. */
function PreviewBlock({ block: b, values }: { block: TemplateBlock; values: Record<string, string> }) {
  if (b.block_type === 'kv') {
    const kv = blockKV(b);
    return (
      <div key={b.id} dir="auto" style={{ fontSize: 14 }}>
        <span style={{ fontWeight: 600 }}><Filled text={kv.label} values={values} />:</span>{' '}
        <span><Filled text={kv.value} values={values} /></span>
      </div>
    );
  }
  if (b.block_type === 'table') {
    const cols = tableColumns(b);
    if (!cols.length) return null;
    const rows = tableRowsFor(b, values);
    return (
      <table key={b.id} style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, margin: '6px 0' }}>
        <thead>
          <tr>{cols.map((c) => <th key={c.key} style={{ border: '1px solid var(--aq-border)', padding: '3px 6px', textAlign: 'start', background: 'var(--aq-surface-2, rgba(0,0,0,0.04))' }}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={cols.length} style={{ border: '1px solid var(--aq-border)', padding: '3px 6px', color: 'var(--aq-text-muted)', textAlign: 'center' }}>(no rows)</td></tr>
          ) : rows.map((r, ri) => (
            <tr key={ri}>{cols.map((c) => (
              <td key={c.key} dir="auto" style={{ border: '1px solid var(--aq-border)', padding: '3px 6px' }}>
                <Filled text={`{{ ${c.key} }}`} values={r} />
              </td>
            ))}</tr>
          ))}
        </tbody>
      </table>
    );
  }
  const text = <Filled text={blockText(b)} values={values} />;
  if (b.block_type === 'title') return <div key={b.id} dir="auto" style={{ fontSize: 18, fontWeight: 700 }}>{text}</div>;
  if (b.block_type === 'h') return <div key={b.id} dir="auto" style={{ fontSize: 15, fontWeight: 600, marginTop: 4 }}>{text}</div>;
  if (b.block_type === 'li') return <div key={b.id} dir="auto" style={{ fontSize: 14, paddingInlineStart: 16 }}>{'\u2022'} {text}</div>;
  return <div dir="auto" style={{ fontSize: 14, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{text}</div>;
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
  /**
   * A list value with a count beside it, in one cell.
   *
   * Siraj, on the client contract's outputs table: "the ad amount is ad type
   * with quantity". Two controls, ONE stored value - "3 x Home Ad" - which is
   * the form the vendor contract has always written and splitQuantity reads.
   *
   * The count is not a separate field because the contract prints one cell,
   * and a second column would have to be added to a document people sign to
   * hold a number that belongs beside the thing it counts.
   */
  if (field.field_type === 'list_qty') {
    const opts = sortListValues(((field.list_id ? lists.valuesByList[field.list_id] : undefined) ?? []).filter((v) => v.active));
    const cur = splitQuantity(value);
    const write = (qty: number, name: string) => {
      const n = name.trim();
      // No name, nothing to count - the cell empties rather than keeping an
      // orphan number that prints as "3 x" on a contract.
      if (!n) { onChange(''); return; }
      onChange(qty > 1 ? `${qty} \u00d7 ${n}` : n);
    };
    return (
      <div style={{ display: 'flex', gap: 4, alignItems: 'center', minWidth: 150 }}>
        <input
          type="number" className="aq-input" min={1} value={cur.name ? cur.qty || 1 : ''}
          disabled={!cur.name}
          onChange={(e) => write(Math.max(1, Math.floor(Number(e.target.value) || 1)), cur.name)}
          title="How many" style={{ width: 62, ...bad }}
        />
        <select
          className="aq-select" value={cur.name}
          onChange={(e) => write(cur.qty || 1, e.target.value)}
          title={err ?? undefined} style={{ flex: 1, minWidth: 90, ...bad }}
        >
          <option value="">{'--'}</option>
          {opts.map((o) => <option key={o.id} value={o.value}>{o.label || o.value}</option>)}
        </select>
      </div>
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
