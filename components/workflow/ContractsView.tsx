'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  generateContractRequest,
  useContractRequests,
  useGeneratedContractFiles,
  useTaskStubs,
  updateContractRequestStatus,
  type WorkspaceRole,
} from '@/hooks/use-workflow';
import {
  buildRows, sortRows, filterRows, nextSort, summarise, summaryLine, emptyMessage,
  isFiltered, money, nextAction, fileNote, statusLabel, generatedMessage,
  COLUMNS, STATUS_ORDER, DEFAULT_SORT, EMPTY_FILTER, NO_FILTER, sortHint,
  type ContractKind, type ContractRow, type ContractStatus,
  type Filter, type Sort, type TaskLike, type PersonLike,
} from '@/lib/contracts';
import { SkeletonRows } from '@/components/Skeleton';

/**
 * Contracts — the register.
 *
 * Rebuilt Aug 2026, fifth screen of the UI pass. Siraj picked the table, the
 * same shape as All Tasks: two screens that behave identically are one thing
 * to learn.
 *
 * What was here: four stacked cards of equal size, all always open, three of
 * them usually reading "None." — including during every load, which is the
 * same sentence they say when there is genuinely nothing. Every pending row
 * carried Approve, Generate now and Reject at the same weight, and an
 * approved row carried them again, Approve included.
 *
 * The two real bugs are both about things being invisible:
 *
 *   • **Cancelled requests were on no screen at all.** Five statuses in the
 *     database, four rendered. A cancelled request read as a deleted one.
 *   • **A generated contract could not be opened.** The ID was printed as
 *     grey text. The file exists on the backend and the client portal has a
 *     download route; the internal app has none. The button is drawn and
 *     disabled with the reason on it, rather than left out — an absent
 *     control is indistinguishable from a missing feature. Flip
 *     CONTRACTS_CAN_DOWNLOAD once the route ships.
 *
 * All the deciding is in lib/contracts.ts, pure and tested.
 */

/**
 * There is no internal route to a generated contract file yet — only the
 * external portal has one (`/external-portal/contracts/{id}/download/{kind}`,
 * and that is portal-authed). When the backend grows the internal
 * equivalent, set this true and wire `onDownload`.
 */
const CONTRACTS_CAN_DOWNLOAD = false;

const MANAGE_ROLES = ['owner', 'admin', 'marketing', 'key_account'];

export function ContractsView({
  workspaceId, role, onOpenTask, tasks = [], profiles = [],
}: {
  workspaceId: string;
  role: WorkspaceRole | null;
  onOpenTask: (taskId: string) => void;
  /** Campaigns the page already loaded — so a row can name its campaign
   *  rather than repeating the brand. No extra query. */
  tasks?: TaskLike[];
  profiles?: PersonLike[];
}) {
  const { items, loading, refetch } = useContractRequests(workspaceId);

  // Only the generated ones have a file to ask about.
  const contractIds = useMemo(
    () => items.map((r) => r.generated_contract_id).filter(Boolean) as string[],
    [items],
  );
  const { rows: files } = useGeneratedContractFiles(contractIds);

  // A vendor contract is requested from the vendor booking, so this id is
  // the booking's — one hop below the campaign, and never in the parent-only
  // list the page hands us. Fetched by id; the parents come from `tasks`.
  const requestTaskIds = useMemo(
    () => items.map((r) => r.pm_task_id).filter(Boolean) as string[],
    [items],
  );
  const { rows: taskStubs } = useTaskStubs(requestTaskIds);
  const allTasks = useMemo(() => [...tasks, ...taskStubs], [tasks, taskStubs]);

  const [filter, setFilter] = useState<Filter>(EMPTY_FILTER);
  const [sort, setSort] = useState<Sort>(DEFAULT_SORT);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const set = <K extends keyof Filter>(k: K) => (v: Filter[K]) =>
    setFilter((f) => ({ ...f, [k]: v }));

  const [today, setToday] = useState<string | null>(null);
  useEffect(() => { setToday(new Date().toISOString().slice(0, 10)); }, []);

  const canManage = Boolean(role && MANAGE_ROLES.includes(role));

  const rows = useMemo(
    () => (today ? buildRows({ requests: items, generated: files, tasks: allTasks, profiles }, today) : []),
    [items, files, allTasks, profiles, today],
  );
  const shown = useMemo(
    () => sortRows(filterRows(rows, filter, profiles), sort),
    [rows, filter, sort, profiles],
  );
  const summary = summarise(rows, shown);

  // Only offer a status that exists here. A filter that can only ever empty
  // the table is a filter that reads like a broken screen.
  const statuses = useMemo(() => {
    const seen = new Set(rows.map((r) => r.status));
    return STATUS_ORDER.filter((s) => seen.has(s));
  }, [rows]);

  const act = async (row: ContractRow, what: 'approve' | 'reject' | 'generate') => {
    setBusyId(row.id); setError(''); setMessage('');
    try {
      if (what === 'generate') {
        const result = await generateContractRequest(row.id);
        await refetch();
        setMessage(generatedMessage(result));
      } else {
        await updateContractRequestStatus(row.id, what === 'approve' ? 'approved' : 'rejected');
        await refetch();
        setMessage(what === 'approve'
          ? `Approved ${row.party}. It is ready to generate.`
          : `Rejected ${row.party}.`);
      }
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusyId(null);
    }
  };

  const waiting = loading && items.length === 0;

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: 20, fontWeight: 700 }}>Contracts</h2>
        <span style={{ fontSize: 13, color: 'var(--aq-text-muted)' }}>
          {waiting || !today ? 'Loading…' : summaryLine(summary)}
        </span>
      </header>

      {/* Above the table, where somebody who just pressed a button is
          looking — not as a badge pinned to the top of the page. */}
      {error && (
        <div role="alert" style={{
          padding: '10px 14px', borderRadius: 'var(--aq-radius)',
          background: '#fee2e2', color: '#991b1b', fontSize: 13,
        }}>{error}</div>
      )}
      {message && !error && (
        <div role="status" style={{
          padding: '10px 14px', borderRadius: 'var(--aq-radius)',
          background: 'var(--aq-accent-light)', color: '#14603a', fontSize: 13, fontWeight: 600,
        }}>{message}</div>
      )}

      <div className="aq-card">
        <div style={{ padding: '12px 14px 0' }}>
          <input
            className="aq-input"
            placeholder="Search vendor, client, campaign, contract ID, template…"
            value={filter.query}
            onChange={(e) => set('query')(e.target.value)}
          />
        </div>

        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          flexWrap: 'wrap', padding: '12px 14px',
        }}>
          <Chip
            label="Waiting"
            count={summary.waiting}
            on={filter.waitingOnly && !filter.status}
            onClick={() => setFilter((f) => ({ ...f, waitingOnly: !f.waitingOnly, status: null }))}
          />
          <Chip
            label="Vendor"
            on={filter.kind === 'vendor'}
            onClick={() => set('kind')(filter.kind === 'vendor' ? null : 'vendor' as ContractKind)}
          />
          <Chip
            label="Client"
            on={filter.kind === 'client'}
            onClick={() => set('kind')(filter.kind === 'client' ? null : 'client' as ContractKind)}
          />

          <select
            className="aq-select"
            value={filter.status ?? ''}
            onChange={(e) => set('status')((e.target.value || null) as ContractStatus | null)}
            style={{ width: 'auto', fontSize: 12.5, padding: '5px 10px' }}
            aria-label="Status"
          >
            <option value="">Every status</option>
            {statuses.map((s) => (
              <option key={s} value={s}>{statusLabel(s)}</option>
            ))}
          </select>

          {isFiltered(filter) && (
            <button
              type="button"
              className="aq-btn aq-btn-ghost"
              onClick={() => setFilter(NO_FILTER)}
              style={{ fontSize: 12.5, padding: '5px 10px', color: 'var(--aq-text-secondary)' }}
            >Show everything</button>
          )}
        </div>
      </div>

      {waiting || !today ? (
        // Never "None." while loading. That is the same sentence the screen
        // shows when there is genuinely nothing, and it used to be on all
        // four boxes for the whole of every load.
        <SkeletonRows rows={7} height={40} label="Loading contract requests" />
      ) : shown.length === 0 ? (
        <div className="aq-card" style={{
          padding: 34, textAlign: 'center', color: 'var(--aq-text-muted)', fontSize: 13.5,
        }}>
          {emptyMessage(filter, rows.length)}
        </div>
      ) : (
        <div className="aq-card" style={{ overflowX: 'auto' }}>
          <table style={{
            width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 900,
          }}>
            <thead>
              <tr>
                {COLUMNS.map((c) => {
                  const on = sort.key === c.key;
                  return (
                    <th
                      key={c.key}
                      scope="col"
                      aria-sort={on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                      style={{
                        textAlign: c.align, padding: 0,
                        borderBottom: '1px solid var(--aq-border)',
                        position: 'sticky', top: 0, zIndex: 1,
                        background: 'var(--aq-bg-elevated)',
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => setSort(nextSort(sort, c.key))}
                        title={sortHint(c, sort)}
                        style={{
                          display: 'flex', gap: 4, width: '100%',
                          justifyContent: c.align === 'right' ? 'flex-end' : 'flex-start',
                          padding: '9px 12px', border: 'none', background: 'none',
                          font: 'inherit', fontSize: 10, fontWeight: 700,
                          letterSpacing: '.07em', textTransform: 'uppercase',
                          color: on ? 'var(--aq-text)' : 'var(--aq-text-muted)',
                          cursor: 'pointer', whiteSpace: 'nowrap',
                        }}
                      >
                        {c.label}
                        <span aria-hidden style={{ fontSize: 8, opacity: on ? 1 : 0 }}>
                          {on && sort.dir === 'desc' ? '▼' : '▲'}
                        </span>
                        <span style={SR_ONLY}>{sortHint(c, sort)}</span>
                      </button>
                    </th>
                  );
                })}
                <th scope="col" style={{
                  textAlign: 'right', padding: '9px 12px',
                  borderBottom: '1px solid var(--aq-border)',
                  position: 'sticky', top: 0, zIndex: 1,
                  background: 'var(--aq-bg-elevated)',
                  fontSize: 10, fontWeight: 700, letterSpacing: '.07em',
                  textTransform: 'uppercase', color: 'var(--aq-text-muted)',
                  whiteSpace: 'nowrap',
                }}>Next</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <Row
                  key={r.id}
                  row={r}
                  canManage={canManage}
                  busy={busyId === r.id}
                  onOpenTask={onOpenTask}
                  onAct={(what) => act(r, what)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────── */

function Row({
  row, canManage, busy, onOpenTask, onAct,
}: {
  row: ContractRow;
  canManage: boolean;
  busy: boolean;
  onOpenTask: (id: string) => void;
  onAct: (what: 'approve' | 'reject' | 'generate') => void;
}) {
  const action = nextAction(row, { canManage, canDownload: CONTRACTS_CAN_DOWNLOAD });
  const note = fileNote(row);

  return (
    <tr style={{ opacity: busy ? 0.55 : 1 }}>
      <Td>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Repeats what the Age column says in words — red and amber are
              the same dot to a lot of people. */}
          <span
            aria-hidden
            style={{
              width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
              background: row.stale ? '#b91c1c' : 'transparent',
            }}
          />
          <span>
            <span style={{ fontWeight: 600 }}>{row.party}</span>
            {row.category && (
              <span style={{ color: 'var(--aq-text-muted)', marginLeft: 6 }}>{row.category}</span>
            )}
            {row.contractId && (
              <span style={{
                display: 'block', fontSize: 11, color: 'var(--aq-text-muted)',
                fontVariantNumeric: 'tabular-nums',
              }}>
                {row.contractId}
                {/* The PDF failure, on the row. It used to exist only in a
                    message that vanished on the next click. */}
                {note && note !== 'PDF and DOCX' && (
                  <span style={{ color: '#92400e', fontWeight: 600 }}> · {note}</span>
                )}
              </span>
            )}
          </span>
        </span>
      </Td>
      <Td><KindPill kind={row.kind} label={row.kindLabel} /></Td>
      <Td muted italic={!row.campaign}>
        {row.campaign && row.campaignKnown && row.taskId ? (
          <button
            type="button"
            onClick={() => onOpenTask(row.taskId!)}
            style={{
              font: 'inherit', border: 'none', background: 'none', padding: 0,
              color: 'var(--aq-text-secondary)', cursor: 'pointer', textAlign: 'left',
              textDecoration: 'underline', textDecorationColor: 'var(--aq-border)',
              textUnderlineOffset: 3,
            }}
          >{row.campaign}</button>
        ) : (row.campaign ?? 'no campaign')}
      </Td>
      <Td><StatusPill status={row.status} label={row.statusLabel} /></Td>
      <Td>
        <span style={{
          whiteSpace: 'nowrap',
          color: row.stale ? '#b91c1c' : 'var(--aq-text-secondary)',
          fontWeight: row.stale ? 700 : 400,
        }}>{row.ageLabel}</span>
      </Td>
      <Td align="right" muted={row.amount == null}>
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{money(row.amount)}</span>
      </Td>
      <Td align="right">
        <span style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', alignItems: 'center' }}>
          {action.canReject && (
            <button
              type="button"
              className="aq-btn aq-btn-ghost"
              onClick={() => onAct('reject')}
              disabled={busy}
              style={{ fontSize: 12, padding: '4px 9px', color: 'var(--aq-text-secondary)' }}
            >Reject</button>
          )}
          {action.kind !== 'none' && (
            <button
              type="button"
              className={action.primary ? 'aq-btn aq-btn-primary' : 'aq-btn aq-btn-secondary'}
              onClick={() => {
                if (action.kind === 'approve') onAct('approve');
                else if (action.kind === 'generate') onAct('generate');
              }}
              disabled={busy || action.disabled}
              // A disabled button that will not say why is a dead end.
              title={action.reason ?? undefined}
              style={{ fontSize: 12, padding: '4px 11px', whiteSpace: 'nowrap' }}
            >
              {busy && action.primary ? 'Working…' : action.label}
              {action.reason && <span style={SR_ONLY}> — {action.reason}</span>}
            </button>
          )}
          {action.kind === 'none' && (
            <span style={{ color: 'var(--aq-text-muted)' }} title={action.reason ?? undefined}>—</span>
          )}
        </span>
      </Td>
    </tr>
  );
}

function Td({
  children, align = 'left', muted, italic,
}: {
  children: React.ReactNode;
  align?: 'left' | 'right';
  muted?: boolean;
  italic?: boolean;
}) {
  return (
    <td style={{
      padding: '9px 12px', textAlign: align,
      borderBottom: '1px solid var(--aq-border-light)',
      color: muted ? 'var(--aq-text-muted)' : 'var(--aq-text)',
      fontStyle: italic ? 'italic' : 'normal',
      whiteSpace: align === 'right' ? 'nowrap' : undefined,
      verticalAlign: 'middle',
    }}>{children}</td>
  );
}

const STATUS_STYLE: Record<ContractStatus, { bg: string; fg: string }> = {
  pending:   { bg: '#fef3c7', fg: '#92400e' },
  approved:  { bg: '#e0e7ff', fg: '#3730a3' },
  generated: { bg: 'var(--aq-accent-light)', fg: '#14603a' },
  rejected:  { bg: '#fee2e2', fg: '#b91c1c' },
  cancelled: { bg: 'var(--aq-bg-sunken)', fg: 'var(--aq-text-muted)' },
};

function StatusPill({ status, label }: { status: ContractStatus; label: string }) {
  const s = STATUS_STYLE[status];
  return (
    <span style={{
      display: 'inline-block', fontSize: 10.5, fontWeight: 700, letterSpacing: '.03em',
      padding: '3px 9px', borderRadius: 999, whiteSpace: 'nowrap',
      background: s.bg, color: s.fg,
    }}>{label}</span>
  );
}

function KindPill({ kind, label }: { kind: ContractKind; label: string }) {
  return (
    <span style={{
      display: 'inline-block', fontSize: 10, fontWeight: 700, letterSpacing: '.06em',
      textTransform: 'uppercase', padding: '2px 7px', borderRadius: 5, whiteSpace: 'nowrap',
      background: kind === 'vendor' ? '#eef2ff' : '#ecfdf5',
      color: kind === 'vendor' ? '#3730a3' : '#14603a',
    }}>{label}</span>
  );
}

function Chip({
  label, count, on, onClick,
}: {
  label: string;
  count?: number;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      style={{
        font: 'inherit', fontSize: 12, fontWeight: on ? 600 : 500,
        padding: '5px 11px', borderRadius: 999, cursor: 'pointer', whiteSpace: 'nowrap',
        border: `1px solid ${on ? 'var(--aq-text)' : 'var(--aq-border-light)'}`,
        background: on ? 'var(--aq-text)' : 'var(--aq-bg-elevated)',
        color: on ? '#fff' : 'var(--aq-text-secondary)',
      }}
    >
      {label}
      {count != null && count > 0 && (
        <span style={{ marginLeft: 5, opacity: 0.65, fontVariantNumeric: 'tabular-nums' }}>
          {count}
        </span>
      )}
    </button>
  );
}

const SR_ONLY: React.CSSProperties = {
  position: 'absolute', width: 1, height: 1, padding: 0, margin: -1,
  overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
};
