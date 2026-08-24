'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createSalesTask,
  createClientBrand,
  uploadTaskAttachment,
  useClients,
  useClientBrands,
  useLegacyVendors,
  type Profile,
  type WorkspaceRole,
} from '@/hooks/use-workflow';
import { SearchablePicker } from './SearchablePicker';
import type { CampaignPrefill } from '@/lib/crm-sync';
import { closerFields, closerOptions } from '@/lib/sales-closer';
import {
  EMPTY_DRAFT, stepStatuses, firstOpenStep, stepReachable, submitProblems,
  stepSummary, budgetValue, attachmentProblems, acceptableFiles,
  fileSizeLabel, uploadOutcome, MAX_BRIEF_FILES,
  type Draft, type StepKey,
} from '@/lib/new-task';

/**
 * New Task — three steps.
 *
 * Rebuilt Aug 2026, third screen of the UI pass. It was six boxes on the
 * left and, on the right, a quarter of the screen given to four grey cards
 * that existed only to say "Marketing will pick". That is a sentence, not
 * four cards, and it is now one line under the button.
 *
 * Three steps — who it is for, what it is, the brief — because sales submit
 * these rarely and one question at a time is hard to get wrong. An answered
 * step folds up into a summary of its own answer, so a finished form reads
 * back as a sentence about the campaign.
 *
 * Two things that were quietly broken:
 *
 *   • A client with no brands on file was a dead end — the picker greyed
 *     out and the only way forward was to leave the form and lose whatever
 *     had been typed. There is an "Add a brand" box in place now.
 *   • Errors and confirmations rendered BELOW the submit button, where
 *     nobody is looking at the moment they press it. They are above it.
 *
 * The brief takes files (Siraj, Aug 2026: "just in case"). They are held in
 * the browser until the campaign exists — there is nothing to attach them
 * to before that — and uploaded straight after. If an upload fails the
 * campaign still exists, and the message says so rather than implying the
 * brief made it.
 */
export function NewTaskForm({
  workspaceId, currentUserId, role, profiles, onCreated, prefill,
}: {
  workspaceId: string;
  currentUserId: string;
  role: WorkspaceRole | null;
  profiles: (Profile & { role: WorkspaceRole })[];
  onCreated?: (taskId: string) => void;
  /**
   * Starting point for the form — set when a CRM deal is won. It only ever
   * fills boxes in; the person still reviews and submits, so a won deal
   * never becomes a campaign behind anybody's back.
   */
  prefill?: CampaignPrefill | null;
}) {
  const [draft, setDraft] = useState<Draft>({
    ...EMPTY_DRAFT,
    taskName: prefill?.task_name ?? '',
    clientId: prefill?.client_id ?? '',
    budget: prefill?.budget != null ? String(prefill.budget) : '',
    details: prefill?.details ?? '',
  });
  const set = <K extends keyof Draft>(k: K) => (v: Draft[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  // A form arriving from a won deal opens on what is still unanswered
  // rather than on a question that already has its answer.
  const [open, setOpen] = useState<StepKey>(() => firstOpenStep({
    ...EMPTY_DRAFT,
    taskName: prefill?.task_name ?? '',
    clientId: prefill?.client_id ?? '',
  }));
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [newBrand, setNewBrand] = useState('');
  const [addingBrand, setAddingBrand] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const { clients, loading: clientsLoading } = useClients();
  const { brands, loading: brandsLoading, refetch: refetchBrands } =
    useClientBrands(draft.clientId || null);
  const { vendors } = useLegacyVendors();

  // One generic "Influencer" option (061). A new task has no legacy named
  // influencer to preserve, so nothing is passed as the current value.
  const influencerClosers = useMemo(() => closerOptions([], vendors || []), [vendors]);

  // A brand belongs to a client; changing the client makes the old one wrong.
  useEffect(() => { setDraft((d) => ({ ...d, brandId: '' })); }, [draft.clientId]);

  const selectedClient = useMemo(
    () => clients.find((c) => c.id === draft.clientId) ?? null, [clients, draft.clientId]);
  const selectedBrand = useMemo(
    () => brands.find((b) => b.id === draft.brandId) ?? null, [brands, draft.brandId]);

  const steps = stepStatuses(draft);
  const problems = submitProblems(draft);
  const canCreate = role && ['owner', 'admin', 'sales', 'marketing'].includes(role);

  const closerLabel = useMemo(() => {
    if (!draft.salesCloser) return '';
    if (draft.salesCloser.startsWith('p:')) {
      return profiles.find((p) => `p:${p.id}` === draft.salesCloser)?.full_name ?? '';
    }
    return influencerClosers.find((o) => o.key === draft.salesCloser)?.label ?? '';
  }, [draft.salesCloser, profiles, influencerClosers]);

  const labels = {
    clientName: selectedClient?.company_name,
    brandName: selectedBrand?.brand_name,
    signatory: selectedClient?.signatory_name,
    closerLabel,
  };

  const addFiles = (picked: FileList | null) => {
    if (!picked || picked.length === 0) return;
    const incoming = Array.from(picked);
    const bad = attachmentProblems(files, incoming);
    const kept = acceptableFiles(files, incoming);
    if (kept.length) setFiles([...files, ...kept]);
    setError(bad[0] ?? '');
    // Let the same file be picked again after a refusal.
    if (fileRef.current) fileRef.current.value = '';
  };

  const addBrand = async () => {
    if (!draft.clientId || !newBrand.trim()) return;
    setAddingBrand(true); setError('');
    try {
      const created = await createClientBrand(draft.clientId, newBrand.trim());
      await refetchBrands();
      if (created) setDraft((d) => ({ ...d, brandId: created.id }));
      setNewBrand('');
    } catch (e: any) { setError(e?.message ?? String(e)); }
    finally { setAddingBrand(false); }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setSuccess('');
    if (problems.length) { setError(problems[0]); return; }
    if (!selectedClient || !selectedBrand) {
      setError('Pick the client and brand from the lists.');
      return;
    }

    setSubmitting(true);
    try {
      const created = await createSalesTask({
        workspace_id: workspaceId,
        task_name: draft.taskName.trim(),
        brand_name: selectedBrand.brand_name,
        legacy_client_id: selectedClient.cr_number || selectedClient.id,
        client_id: selectedClient.id,
        brand_id: selectedBrand.id,
        // One picker, the two mutually exclusive columns behind it.
        ...closerFields(draft.salesCloser),
        budget: budgetValue(draft.budget),
        details: draft.details.trim() || null,
        creator_id: currentUserId,
      });

      // The files, now that there is something to attach them to. Counted
      // rather than aborted on: the campaign is already made, and losing one
      // file is no reason to leave the person guessing about all of them.
      let failed = 0;
      for (const file of files) {
        try {
          await uploadTaskAttachment({
            file, task_id: created.id, uploader_id: currentUserId, workspace_id: workspaceId,
          });
        } catch { failed += 1; }
      }

      setSuccess(uploadOutcome(files.length, failed));
      setDraft(EMPTY_DRAFT);
      setFiles([]);
      setOpen('who');
      onCreated?.(created.id);
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setSubmitting(false);
    }
  };

  if (!canCreate) {
    return (
      <div className="aq-card animate-fade-in" style={{ padding: 32, textAlign: 'center' }}>
        <h2 style={{ fontSize: 18, fontWeight: 700 }}>Not your screen</h2>
        <p style={{ color: 'var(--aq-text-muted)', marginTop: 8, fontSize: 14 }}>
          Only sales, marketing, admin and owner can create tasks.
          Your role is <strong>{role || 'unset'}</strong>.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="animate-fade-in" style={{ maxWidth: 720 }}>
      <header style={{ marginBottom: 18 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700 }}>New task</h2>
        <p style={{ fontSize: 13, color: 'var(--aq-text-muted)', marginTop: 3 }}>
          Sales fill this in. Marketing takes it from there.
        </p>
      </header>

      <div className="aq-card" style={{ padding: 22 }}>
        {steps.map((step, i) => {
          const isOpen = open === step.key;
          const reachable = stepReachable(step.key, draft);
          const summary = stepSummary(step.key, draft, labels);
          return (
            <Step
              key={step.key}
              index={i + 1}
              last={i === steps.length - 1}
              title={step.title}
              done={step.done && !isOpen}
              open={isOpen}
              reachable={reachable}
              summary={summary}
              onOpen={() => reachable && setOpen(step.key)}
            >
              {step.key === 'who' && (
                <>
                  <Field label="Client">
                    {/* Type-ahead rather than a <select>: the list runs to
                        several hundred rows with near-duplicate company
                        names told apart only by their CR number. */}
                    <SearchablePicker
                      options={clients.map((c) => ({
                        value: c.id,
                        label: c.company_name,
                        hint: c.cr_number ? `CR ${c.cr_number}` : null,
                        keywords: c.vat_number,
                      }))}
                      value={draft.clientId || null}
                      onChange={(v) => set('clientId')(v ?? '')}
                      disabled={clientsLoading}
                      maxWidth="100%"
                      placeholder={clientsLoading
                        ? 'Loading clients…'
                        : clients.length === 0
                          ? 'No clients yet — add one under Clients'
                          : 'Search clients…'}
                      emptyLabel="— No client —"
                    />
                  </Field>

                  {draft.clientId && (
                    <Field label="Brand">
                      {brands.length === 0 && !brandsLoading ? (
                        // The dead end, fixed. This used to be a greyed box
                        // reading "No brands for this client", and the only
                        // way on was to leave the form.
                        <div style={{
                          border: '1px dashed var(--aq-border)',
                          borderRadius: 'var(--aq-radius)', padding: '12px 14px',
                        }}>
                          <div style={{ fontSize: 12.5, color: 'var(--aq-text-secondary)' }}>
                            <strong>{selectedClient?.company_name}</strong> has no brands on file yet.
                          </div>
                          <div style={{ display: 'flex', gap: 8, marginTop: 9 }}>
                            <input
                              className="aq-input"
                              value={newBrand}
                              placeholder="Brand name"
                              disabled={addingBrand}
                              onChange={(e) => setNewBrand(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') { e.preventDefault(); addBrand(); }
                              }}
                            />
                            <button
                              type="button"
                              className="aq-btn aq-btn-secondary"
                              disabled={addingBrand || !newBrand.trim()}
                              onClick={addBrand}
                              style={{ whiteSpace: 'nowrap' }}
                            >{addingBrand ? 'Adding…' : 'Add brand'}</button>
                          </div>
                        </div>
                      ) : (
                        <SearchablePicker
                          options={brands.map((b) => ({ value: b.id, label: b.brand_name }))}
                          value={draft.brandId || null}
                          onChange={(v) => set('brandId')(v ?? '')}
                          disabled={brandsLoading}
                          maxWidth="100%"
                          placeholder={brandsLoading ? 'Loading brands…' : 'Search brands…'}
                          emptyLabel="— No brand —"
                        />
                      )}
                    </Field>
                  )}

                  {selectedClient && (
                    <div style={{
                      fontSize: 12, color: 'var(--aq-text-muted)',
                      padding: '7px 11px', background: 'var(--aq-bg-sunken)',
                      borderRadius: 'var(--aq-radius)',
                    }}>
                      <strong style={{ color: 'var(--aq-text)' }}>{selectedClient.company_name}</strong>
                      {selectedClient.signatory_name && ` · Signatory: ${selectedClient.signatory_name}`}
                      {selectedClient.contact_email && ` · ${selectedClient.contact_email}`}
                    </div>
                  )}

                  <NextButton
                    disabled={!steps[0].done}
                    hint={steps[0].missing[0]}
                    onClick={() => setOpen('what')}
                  >Next — what is it</NextButton>
                </>
              )}

              {step.key === 'what' && (
                <>
                  <Field label="Campaign name">
                    <input
                      className="aq-input"
                      value={draft.taskName}
                      onChange={(e) => set('taskName')(e.target.value)}
                      placeholder="e.g. Ramadan 2026 — Sunbulah"
                    />
                  </Field>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                    <Field label="Sales closer">
                      <select
                        className="aq-select"
                        value={draft.salesCloser}
                        onChange={(e) => set('salesCloser')(e.target.value)}
                      >
                        <option value="">— Select —</option>
                        <optgroup label="Team">
                          {profiles.map((p) => (
                            <option key={p.id} value={`p:${p.id}`}>
                              {p.full_name}
                              {p.role !== 'member' ? ` (${p.role === 'key_account' ? 'Key account' : p.role})` : ''}
                            </option>
                          ))}
                        </optgroup>
                        {/* One option, not the whole register (061). */}
                        {influencerClosers.map((o) => (
                          <option key={o.key} value={o.key}>{o.label}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Budget (SAR)" hint="optional">
                      <input
                        className="aq-input"
                        value={draft.budget}
                        onChange={(e) => set('budget')(e.target.value)}
                        inputMode="decimal"
                        placeholder="0.00"
                      />
                    </Field>
                  </div>
                  <NextButton
                    disabled={!steps[1].done}
                    hint={steps[1].missing[0]}
                    onClick={() => setOpen('brief')}
                  >Next — the brief</NextButton>
                </>
              )}

              {step.key === 'brief' && (
                <>
                  <Field label="Brief" hint="optional">
                    <textarea
                      className="aq-textarea"
                      value={draft.details}
                      onChange={(e) => set('details')(e.target.value)}
                      rows={4}
                      placeholder="Anything marketing should know up front."
                    />
                  </Field>

                  {/* ── Files ────────────────────────────────────────
                      Held here until the campaign exists — there is
                      nothing to attach them to before that. */}
                  <div>
                    <div className="aq-label" style={{ marginBottom: 5 }}>Files</div>
                    {files.length > 0 && (
                      <ul style={{
                        listStyle: 'none', display: 'flex', flexDirection: 'column',
                        gap: 4, marginBottom: 9,
                      }}>
                        {files.map((f, i) => (
                          <li key={`${f.name}-${i}`} style={{
                            display: 'flex', alignItems: 'center', gap: 10,
                            padding: '7px 10px', fontSize: 12.5,
                            border: '1px solid var(--aq-border-light)',
                            borderRadius: 'var(--aq-radius)',
                          }}>
                            <span style={{
                              flex: 1, minWidth: 0, overflow: 'hidden',
                              textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            }}>{f.name}</span>
                            <span style={{ color: 'var(--aq-text-muted)', whiteSpace: 'nowrap' }}>
                              {fileSizeLabel(f.size)}
                            </span>
                            <button
                              type="button"
                              className="aq-btn aq-btn-ghost"
                              onClick={() => setFiles(files.filter((_, j) => j !== i))}
                              style={{ fontSize: 12, padding: '2px 8px' }}
                            >Remove</button>
                          </li>
                        ))}
                      </ul>
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="aq-btn aq-btn-secondary"
                        onClick={() => fileRef.current?.click()}
                        disabled={files.length >= MAX_BRIEF_FILES}
                        style={{ fontSize: 12.5, padding: '6px 12px' }}
                      >{files.length ? 'Add another file' : 'Attach a file'}</button>
                      <span style={{ fontSize: 11.5, color: 'var(--aq-text-muted)' }}>
                        {files.length >= MAX_BRIEF_FILES
                          ? `${MAX_BRIEF_FILES} is the limit here — the rest go on the campaign.`
                          : 'Decks, PDFs, references. Up to 10MB each.'}
                      </span>
                    </div>
                    <input
                      ref={fileRef}
                      type="file"
                      multiple
                      hidden
                      onChange={(e) => addFiles(e.target.files)}
                    />
                  </div>
                </>
              )}
            </Step>
          );
        })}
      </div>

      {/* ── The messages, ABOVE the button ─────────────────────────
          They used to render underneath it, which is where nobody is
          looking at the moment they press it. */}
      {error && (
        <div role="alert" style={{
          marginTop: 14, padding: '10px 14px', borderRadius: 'var(--aq-radius)',
          background: '#fee2e2', color: '#991b1b', fontSize: 13,
        }}>{error}</div>
      )}
      {success && !error && (
        <div role="status" style={{
          marginTop: 14, padding: '10px 14px', borderRadius: 'var(--aq-radius)',
          background: 'var(--aq-accent-light)', color: '#14603a', fontSize: 13, fontWeight: 600,
        }}>{success}</div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 16, flexWrap: 'wrap' }}>
        <button
          className="aq-btn aq-btn-primary"
          type="submit"
          disabled={submitting || problems.length > 0}
        >{submitting ? 'Sending…' : 'Send to marketing'}</button>
        {/* The four grey cards, as the one sentence they always were. */}
        <span style={{ fontSize: 12, color: 'var(--aq-text-muted)' }}>
          {problems.length > 0
            ? problems[0]
            : 'Marketing adds the priority, the service type and a key account manager.'}
        </span>
      </div>
    </form>
  );
}

/* ─────────────────────────────────────────────────────────────── */

function Step({
  index, title, done, open, reachable, summary, last, onOpen, children,
}: {
  index: number;
  title: string;
  done: boolean;
  open: boolean;
  reachable: boolean;
  summary: string;
  last: boolean;
  onOpen: () => void;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: 'flex', gap: 14 }}>
      {/* The spine: a number, and a line down to the next step. */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 24 }}>
        <span style={{
          width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 11.5, fontWeight: 700,
          background: open ? 'var(--aq-accent)' : done ? 'var(--aq-accent-light)' : 'var(--aq-bg-sunken)',
          color: open ? '#fff' : done ? '#14603a' : 'var(--aq-text-muted)',
        }}>{done ? '✓' : index}</span>
        {!last && <span style={{ width: 1, flex: 1, background: 'var(--aq-border-light)', marginTop: 4 }} />}
      </div>

      <div style={{ flex: 1, minWidth: 0, paddingBottom: last ? 0 : 20 }}>
        {open ? (
          <>
            <div style={{ fontSize: 14.5, fontWeight: 700, marginBottom: 12 }}>{title}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>{children}</div>
          </>
        ) : (
          <button
            type="button"
            onClick={onOpen}
            disabled={!reachable}
            style={{
              display: 'flex', alignItems: 'center', gap: 12, width: '100%',
              background: 'none', border: 'none', padding: 0, font: 'inherit',
              textAlign: 'left', cursor: reachable ? 'pointer' : 'default',
            }}
          >
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{
                fontSize: 13.5, fontWeight: 600, display: 'block',
                color: reachable ? 'var(--aq-text-secondary)' : 'var(--aq-text-muted)',
              }}>{title}</span>
              <span style={{
                fontSize: 12, color: 'var(--aq-text-muted)', display: 'block',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>{summary || (reachable ? 'Not answered yet' : 'Pick a client first')}</span>
            </span>
            {reachable && (
              <span style={{ fontSize: 12, color: 'var(--aq-text-secondary)' }}>
                {summary ? 'Change' : 'Open'}
              </span>
            )}
          </button>
        )}
      </div>
    </div>
  );
}

function NextButton({
  disabled, hint, onClick, children,
}: {
  disabled: boolean;
  hint?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 2, flexWrap: 'wrap' }}>
      <button
        type="button"
        className="aq-btn aq-btn-primary"
        onClick={onClick}
        disabled={disabled}
        style={{ fontSize: 13 }}
      >{children}</button>
      {disabled && hint && (
        <span style={{ fontSize: 12, color: 'var(--aq-text-muted)' }}>{hint}</span>
      )}
    </div>
  );
}

function Field({
  label, hint, children,
}: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="aq-label" style={{ marginBottom: 4 }}>
        {label}
        {hint && (
          <span style={{
            fontWeight: 400, textTransform: 'none', letterSpacing: 0,
            color: 'var(--aq-text-muted)',
          }}> · {hint}</span>
        )}
      </div>
      {children}
    </div>
  );
}
