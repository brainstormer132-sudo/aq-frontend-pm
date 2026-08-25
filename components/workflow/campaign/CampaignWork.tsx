'use client';

import React, { useMemo, useState } from 'react';
import {
  useTaskServiceTypes,
  createSubtask, removeSubtask, updateTaskFields, updateTasksBulk,
  offeredSubtaskKinds, isRequestSubtaskKind, isSingletonSubtaskKind,
  SUBTASK_KIND_LABELS,
  TASK_STATUSES, APPROVAL_STAGES, COMPLEXITIES, MEDIA_TYPES,
  displayName, labelFor,
  type PMTask, type SubtaskKind, type WorkspaceRole,
} from '@/hooks/use-workflow';
import { DateField } from '../DateField';
import {
  Card, Fields, F, Val, Pick, Text, Check, Note, UndoBar,
  inkButton, quietButton,
} from './ui';
import { requestStateLine } from '@/lib/campaign-page';
import type { OptimisticSave } from '@/hooks/use-optimistic-save';

const UNDO_MS = 4000;

const WORK_LABELS: Record<string, string> = {
  status: 'Status', due_date: 'Due date', assignee_id: 'Assigned to',
  complexity: 'Complexity', approval_stage: 'Approval', media_type: 'Media type',
  brand_logo_attached: 'Brand logo', keyword_excel_attached: 'Keyword data',
  data_issue_note: 'Data issues', deliverable_attached: 'File attached',
  request_status: 'Request', quotation_no: 'Quotation number',
  invoice_no: 'Invoice number', request_note: 'Note',
};

/**
 * The work that is not a vendor booking.
 *
 * Analysis reports, campaign design, marketing strategy, visuals, and the
 * quotation / invoice / contract request rows. In the drawer these shared one
 * list with the bookings, so a campaign with forty influencers buried its two
 * deliverables at the bottom of row forty-one. Bookings have their own card
 * now; this is everything else.
 *
 * Each kind still gets only its own fields — an analysis report has a
 * complexity and a media type, a visual has a file and a due date, and neither
 * should be asked the other's questions.
 */
export function CampaignWork({
  task, subtasks, role, currentUserId, workspaceId, profiles,
  serviceTypeSteps = [], opt, onChanged,
}: {
  task: PMTask;
  subtasks: PMTask[];
  role: WorkspaceRole | null;
  currentUserId: string;
  workspaceId: string;
  profiles: any[];
  /** The catalogue, so only the kinds this campaign's services define are offered. */
  serviceTypeSteps?: { service_type_id: string; title: string }[];
  opt: OptimisticSave;
  onChanged: () => Promise<void> | void;
}) {
  const { items: taskServiceTypes } = useTaskServiceTypes(task.id);

  const [addKind, setAddKind] = useState<string>('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<{ id: string; title: string; left: number }[]>([]);

  const canEdit = role !== 'member';
  const isPrivileged = !!role && ['owner', 'admin', 'marketing'].includes(role);
  const canFulfil = !!role && ['owner', 'admin', 'operations', 'marketing'].includes(role);

  const others = useMemo(
    () => subtasks.filter((s) => {
      const k = (s as any).subtask_kind;
      return k !== 'vendor' && (s as any).vendor_id == null;
    }),
    [subtasks],
  );

  const offered = useMemo(
    () => offeredSubtaskKinds(taskServiceTypes.map((s) => s.id), serviceTypeSteps),
    [taskServiceTypes, serviceTypeSteps],
  );

  // A kind you can only have one of is offered until you have it, then said to
  // be present rather than silently vanishing — a control that disappears is
  // indistinguishable from a feature that was never there.
  const present = useMemo(
    () => new Set(others.map((s) => String((s as any).subtask_kind ?? ''))),
    [others],
  );

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await fn(); await onChanged(); }
    catch (e: any) { setError(e?.message ?? String(e)); }
    finally { setBusy(false); }
  };

  const add = () => run(async () => {
    const kind = addKind as SubtaskKind;
    await createSubtask({
      parent_task_id: task.id,
      workspace_id: workspaceId,
      creator_id: currentUserId,
      kind,
      title: SUBTASK_KIND_LABELS[kind] ?? 'Subtask',
    });
    setAddKind('');
  });

  const saveOn = (id: string, field: string, value: unknown) =>
    opt.set(id, field, value, { label: WORK_LABELS[field] ?? field });

  const startRemove = (id: string, title: string) => {
    setPending((p) => [...p, { id, title, left: UNDO_MS / 1000 }]);
    const timer = setInterval(() => {
      setPending((p) => {
        const row = p.find((x) => x.id === id);
        if (!row) { clearInterval(timer); return p; }
        if (row.left <= 1) {
          clearInterval(timer);
          void run(async () => { await removeSubtask(id); });
          return p.filter((x) => x.id !== id);
        }
        return p.map((x) => (x.id === id ? { ...x, left: x.left - 1 } : x));
      });
    }, 1000);
  };

  const pendingIds = new Set(pending.map((p) => p.id));
  const shown = others.filter((s) => !pendingIds.has(s.id));

  return (
    <Card
      id="work"
      title="The rest of the work"
      hint={`${others.length} item${others.length === 1 ? '' : 's'}`}
      right={canEdit ? (
        <span style={{ display: 'flex', gap: 8 }}>
          <select
            className="aq-select" aria-label="Kind of work to add"
            value={addKind} onChange={(e) => setAddKind(e.target.value)}
            style={{ fontSize: 12.5, width: 190 }}
          >
            <option value="">Add…</option>
            {offered.filter((k) => k !== 'vendor').map((k) => {
              const only = isSingletonSubtaskKind(k);
              const have = present.has(k);
              return (
                <option key={k} value={k} disabled={only && have}>
                  {SUBTASK_KIND_LABELS[k]}{only && have ? ' — already added' : ''}
                </option>
              );
            })}
          </select>
          <button
            type="button" style={inkButton(busy || !addKind)}
            disabled={busy || !addKind} onClick={add}
          >Add</button>
        </span>
      ) : null}
    >
      {error && <Note tone="bad">{error}</Note>}

      {pending.map((p) => (
        <div key={p.id} style={{ marginBottom: 8 }}>
          <UndoBar
            label={`Removed ${p.title || 'it'}.`}
            seconds={p.left}
            onUndo={() => setPending((x) => x.filter((y) => y.id !== p.id))}
            onNow={() => { setPending((x) => x.filter((y) => y.id !== p.id));
                           void run(async () => { await removeSubtask(p.id); }); }}
          />
        </div>
      ))}

      {!shown.length && !pending.length && (
        <p style={{ fontSize: 13, color: 'var(--aq-text-muted)', margin: '4px 0' }}>
          No reports, designs or document requests on this campaign yet.
        </p>
      )}

      {shown.map((s, i) => {
        const kind = String((s as any).subtask_kind ?? '');
        const open = openId === s.id;
        return (
          <div key={s.id} style={{
            borderTop: i === 0 ? 'none' : '1px solid var(--aq-border-light)', padding: '11px 0',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <button
                type="button" onClick={() => setOpenId(open ? null : s.id)} aria-expanded={open}
                style={{
                  flex: 1, minWidth: 0, textAlign: 'left', background: 'none',
                  border: 'none', padding: 0, font: 'inherit', cursor: 'pointer',
                }}
              >
                <span style={{ display: 'block', fontWeight: 600, fontSize: 13.5 }}>
                  {s.title || SUBTASK_KIND_LABELS[kind as SubtaskKind] || 'Untitled'}
                </span>
                <span style={{ display: 'block', fontSize: 12, color: 'var(--aq-text-muted)' }}>
                  {isRequestSubtaskKind(kind)
                    ? requestStateLine(s as any)
                    : [labelFor(String((s as any).status ?? 'todo')),
                       (s as any).due_date ? `due ${(s as any).due_date}` : 'no due date',
                       (s as any).assignee_id
                         ? displayName(profiles.find((p) => p.id === (s as any).assignee_id))
                         : 'nobody assigned',
                      ].join(' · ')}
                </span>
              </button>
            </div>

            {open && (
              <div style={{ marginTop: 12 }}>
                {isRequestSubtaskKind(kind)
                  ? <RequestFields
                      sub={s} kind={kind} canRequest={isPrivileged} canFulfil={canFulfil}
                      busy={busy} save={saveOn}
                    />
                  : <GeneralFields
                      sub={s} kind={kind} canEdit={canEdit} profiles={profiles} save={saveOn}
                    />}

                {canEdit && (
                  <div style={{ display: 'flex', marginTop: 14 }}>
                    <button
                      type="button"
                      style={{ ...quietButton(busy), color: '#991b1b', marginLeft: 'auto' }}
                      disabled={busy}
                      onClick={() => { setOpenId(null); startRemove(s.id, s.title ?? ''); }}
                    >Remove</button>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </Card>
  );
}

/* ── A quotation / invoice / contract request row ───────────────── */

function RequestFields({ sub, kind, canRequest, canFulfil, busy, save }: {
  sub: PMTask; kind: string; canRequest: boolean; canFulfil: boolean; busy: boolean;
  save: (id: string, field: string, value: unknown) => void;
}) {
  const status = String((sub as any).request_status ?? 'not_requested');
  const numberField = kind === 'quotation' ? 'quotation_no' : kind === 'invoice' ? 'invoice_no' : null;

  const setStatus = (next: string) => {
    save(sub.id, 'request_status', next);
  };

  return (
    <>
      <Fields>
        {numberField && (
          <F k={kind === 'quotation' ? 'Quotation #' : 'Invoice #'}>
            <Text
              canEdit={canRequest || canFulfil}
              value={(sub as any)[numberField]}
              onCommit={(v) => save(sub.id, numberField, v || null)}
            />
          </F>
        )}
        <F k="Note">
          <Text
            canEdit={canRequest || canFulfil}
            value={(sub as any).request_note}
            onCommit={(v) => save(sub.id, 'request_note', v || null)}
          />
        </F>
      </Fields>
      <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap', marginTop: 12 }}>
        {status === 'not_requested' && canRequest && (
          <button type="button" style={inkButton(busy)} disabled={busy}
            onClick={() => setStatus('requested')}>Send the request</button>
        )}
        {status === 'requested' && canFulfil && (
          <button type="button" style={inkButton(busy)} disabled={busy}
            onClick={() => setStatus('fulfilled')}>Mark fulfilled</button>
        )}
        {status === 'requested' && canRequest && (
          <button type="button" style={quietButton(busy)} disabled={busy}
            onClick={() => setStatus('not_requested')}>Cancel the request</button>
        )}
        {status === 'fulfilled' && (canRequest || canFulfil) && (
          <button type="button" style={quietButton(busy)} disabled={busy}
            onClick={() => setStatus('requested')}>Reopen</button>
        )}
      </div>
    </>
  );
}

/* ── An analysis report, or a plain deliverable ─────────────────── */

function GeneralFields({ sub, kind, canEdit, profiles, save }: {
  sub: PMTask; kind: string; canEdit: boolean; profiles: any[];
  save: (id: string, field: string, value: unknown) => void;
}) {
  const isReport = kind === 'analysis_report';
  return (
    <Fields>
      <F k="Status">
        <Pick
          canEdit={canEdit} clearable={false}
          value={(sub as any).status}
          options={[...TASK_STATUSES].map((s) => ({ v: String(s), l: labelFor(String(s)) }))}
          onChange={(v) => save(sub.id, 'status', v)}
        />
      </F>
      <F k="Due">
        {canEdit
          ? <DateField aria-label="Due" value={(sub as any).due_date}
              onCommit={(v) => save(sub.id, 'due_date', v)} />
          : <Val>{(sub as any).due_date ?? '—'}</Val>}
      </F>
      <F k="Assigned to">
        <Pick
          canEdit={canEdit}
          value={(sub as any).assignee_id}
          options={profiles.map((p) => ({ v: p.id, l: displayName(p) }))}
          onChange={(v) => save(sub.id, 'assignee_id', v)}
        />
      </F>
      {isReport ? (
        <>
          <F k="Complexity">
            <Pick
              canEdit={canEdit}
              value={(sub as any).complexity}
              options={[...COMPLEXITIES].map((c) => ({ v: String(c), l: labelFor(String(c)) }))}
              onChange={(v) => save(sub.id, 'complexity', v)}
            />
          </F>
          <F k="Approval">
            <Pick
              canEdit={canEdit}
              value={(sub as any).approval_stage}
              options={[...APPROVAL_STAGES].map((a) => ({ v: String(a), l: labelFor(String(a)) }))}
              onChange={(v) => save(sub.id, 'approval_stage', v)}
            />
          </F>
          <F k="Media type">
            <Pick
              canEdit={canEdit}
              value={(sub as any).media_type}
              options={[...MEDIA_TYPES].map((m) => ({ v: String(m), l: labelFor(String(m)) }))}
              onChange={(v) => save(sub.id, 'media_type', v)}
            />
          </F>
          <F k="Brand logo">
            <Check canEdit={canEdit} checked={!!(sub as any).brand_logo_attached}
              onChange={(v) => save(sub.id, 'brand_logo_attached', v)} />
          </F>
          <F k="Keyword data">
            <Check canEdit={canEdit} checked={!!(sub as any).keyword_excel_attached}
              onChange={(v) => save(sub.id, 'keyword_excel_attached', v)} />
          </F>
          <F k="Data issues">
            <Text canEdit={canEdit} value={(sub as any).data_issue_note}
              onCommit={(v) => save(sub.id, 'data_issue_note', v || null)} />
          </F>
        </>
      ) : (
        <F k="File attached">
          <Check canEdit={canEdit} checked={!!(sub as any).deliverable_attached}
            onChange={(v) => save(sub.id, 'deliverable_attached', v)} />
        </F>
      )}
    </Fields>
  );
}
