'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  useWorkspaceMembers, setWorkspaceMemberRole, useTaskCountsByMember,
  useWorkspaceInvites, deleteWorkspaceInvite, deleteExpiredWorkspaceInvites,
  type WorkspaceRole,
} from '@/hooks/use-workflow';
import { absoluteUrl, withBase } from '@/lib/paths';
import { MyProfileCard } from './MyProfileCard';
import { Chip, Confirm, AddButton, INK } from './RegistryTable';
import {
  buildMembers, sortMembers, filterMembers, teamSummary, teamEmptyMessage,
  isMemberFiltered, firstMemberDir, roleCounts, countOwners,
  canManageTeam, assignableRoles, canChangeRole, roleChangeWarning,
  canRemove, removeWarning,
  buildInvites, inviteSummary, inviteDeleteWarning, clearExpiredWarning,
  emailProblems, createAccountNote,
  ROLES, ROLE_LABELS, ROLE_BLURB, MEMBER_COLUMNS, DEFAULT_MEMBER_SORT, EMPTY_MEMBER_FILTER,
  type MemberRow, type MemberSort, type MemberSortKey, type MemberFilter, type InviteRow,
} from '@/lib/team';

/**
 * Team — everyone in the workspace, what they can do, and what they carry.
 *
 * Before this (Aug 2026) there were **three** team screens:
 *
 *  - `TeamPanel`, inline in page.tsx: twenty lines printing a name and a role
 *    badge, and nothing else.
 *  - `TeamSettingsPanel`, on **Settings**: the same list plus joined date, task
 *    count, a role dropdown, a second badge repeating the role, Remove, and
 *    the legacy invite links.
 *  - `components/team/TeamView.tsx`: 241 lines of an older design, imported by
 *    nothing. Deleted.
 *
 * So the screen named Team could not manage the team, and the screen that
 * could was called Settings — and Settings is `visibleTo: ['owner','admin']`
 * in the sidebar. **That is how nobody below admin could edit their own name:**
 * MyProfileCard lived on a screen they cannot open. Editing yourself is not an
 * admin power, so your profile is the first thing on this page, for everyone.
 *
 * The rest is owner/admin only, and now says what it is doing:
 *
 *  - **A role change is a confirmation, not a dropdown.** It used to apply on
 *    `onChange` — one scroll wheel over the wrong row and somebody is an owner.
 *  - **The role is printed once.** There was a `<select>` and a badge beside it
 *    saying the same word.
 *  - **What a role means is written down.** Nothing in the app said what
 *    "Operations" gets you.
 *  - Joined dates were `toLocaleDateString()` — locale-dependent, and a
 *    hydration mismatch waiting to happen.
 *  - The whole panel re-rendered every second on a `setInterval` so that the
 *    *legacy* invite pills stayed accurate. It ticks once a minute, and only
 *    while there are invites left to expire.
 */
export function TeamView({
  workspaceId, currentUserId, role, onProfileSaved,
}: {
  workspaceId: string;
  currentUserId: string;
  role: WorkspaceRole | null;
  /** So the header stops showing the name you have just changed. */
  onProfileSaved?: (profile: { full_name: string; avatar_url: string | null }) => void;
}) {
  const { members, loading, refetch } = useWorkspaceMembers(workspaceId);
  const { counts } = useTaskCountsByMember(workspaceId);

  const [filter, setFilter] = useState<MemberFilter>(EMPTY_MEMBER_FILTER);
  const [sort, setSort] = useState<MemberSort>(DEFAULT_MEMBER_SORT);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const canManage = canManageTeam(role);

  const rows = useMemo(
    () => buildMembers({ members: members as any, counts, currentUserId }),
    [members, counts, currentUserId],
  );
  const shown = useMemo(
    () => sortMembers(filterMembers(rows, filter), sort),
    [rows, filter, sort],
  );
  const all = useMemo(() => teamSummary(rows), [rows]);
  const view = useMemo(() => teamSummary(shown), [shown]);
  const byRole = useMemo(() => roleCounts(rows), [rows]);
  const owners = useMemo(() => countOwners(rows), [rows]);

  const onSort = (key: MemberSortKey) =>
    setSort((s) => (s.key === key
      ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: firstMemberDir(key) }));

  const filtered = isMemberFiltered(filter);

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Yours first, and for everybody — not an admin power. */}
      <MyProfileCard userId={currentUserId} onSaved={onProfileSaved} />

      <header style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: 20, fontWeight: 700 }}>Team</h2>
        <span style={{ fontSize: 13, color: 'var(--aq-text-muted)' }}>
          {filtered ? `${view.label} — of ${all.label}` : all.label}
        </span>
      </header>

      {error && (
        <div role="alert" style={{
          background: '#fee2e2', border: '1px solid #fecaca', color: '#991b1b',
          padding: '10px 14px', borderRadius: 'var(--aq-radius)', fontSize: 12.5,
        }}>{error}</div>
      )}
      {notice && (
        <div role="status" style={{
          background: 'var(--aq-bg-sunken)', color: 'var(--aq-text-secondary)',
          padding: '10px 14px', borderRadius: 'var(--aq-radius)', fontSize: 12.5,
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <span>{notice}</span>
          <button
            type="button"
            onClick={() => setNotice('')}
            style={{
              font: 'inherit', fontSize: 11, marginLeft: 'auto', background: 'none',
              border: 'none', cursor: 'pointer', color: 'var(--aq-text-muted)',
              textDecoration: 'underline',
            }}
          >dismiss</button>
        </div>
      )}

      {canManage && (
        <CreateAccountCard
          workspaceId={workspaceId}
          callerRole={role}
          onCreated={async (line) => { setNotice(line); await refetch(); }}
          onError={setError}
        />
      )}

      <div className="aq-card">
        <div style={{ padding: '12px 14px 0' }}>
          <input
            className="aq-input"
            value={filter.query}
            onChange={(e) => setFilter((f) => ({ ...f, query: e.target.value }))}
            placeholder="Search a name or a role"
            aria-label="Search the team"
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '12px 14px' }}>
          <Chip
            label="Everyone"
            count={rows.length}
            on={!filter.role}
            onClick={() => setFilter((f) => ({ ...f, role: '' }))}
          />
          {ROLES.filter((r) => byRole[r] > 0).map((r) => (
            <Chip
              key={r}
              label={ROLE_LABELS[r]}
              count={byRole[r]}
              on={filter.role === r}
              onClick={() => setFilter((f) => ({ ...f, role: f.role === r ? '' : r }))}
            />
          ))}
        </div>
      </div>

      {loading ? (
        <div className="aq-card" style={{ padding: 40, textAlign: 'center', color: 'var(--aq-text-muted)' }}>
          Loading the team…
        </div>
      ) : shown.length === 0 ? (
        <div className="aq-card" style={{
          padding: 40, textAlign: 'center', color: 'var(--aq-text-muted)', fontSize: 13,
        }}>{teamEmptyMessage(filter)}</div>
      ) : (
        <div className="aq-card" style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 720 }}>
            <thead>
              <tr>
                {MEMBER_COLUMNS.map((c) => {
                  const on = sort.key === c.key;
                  return (
                    <th
                      key={c.key}
                      scope="col"
                      aria-sort={on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                      style={{
                        textAlign: c.num ? 'right' : 'left', padding: 0,
                        borderBottom: '1px solid var(--aq-border)',
                        background: 'var(--aq-bg-elevated)',
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => onSort(c.key)}
                        title={on
                          ? (sort.dir === 'asc' ? 'Sorted ascending' : 'Sorted descending')
                          : `Sort by ${c.label.toLowerCase()}`}
                        style={{
                          display: 'flex', gap: 4, width: '100%',
                          justifyContent: c.num ? 'flex-end' : 'flex-start',
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
                      </button>
                    </th>
                  );
                })}
                {canManage && (
                  <th style={{
                    padding: '9px 12px', borderBottom: '1px solid var(--aq-border)',
                    background: 'var(--aq-bg-elevated)', width: 1,
                  }}><span style={SR_ONLY}>Actions</span></th>
                )}
              </tr>
            </thead>
            <tbody>
              {shown.map((m) => (
                <MemberLine
                  key={m.id}
                  member={m}
                  workspaceId={workspaceId}
                  callerRole={role}
                  canManage={canManage}
                  owners={owners}
                  onDone={async (line) => { setNotice(line); await refetch(); }}
                  onError={setError}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canManage && (
        <LegacyInvites
          workspaceId={workspaceId}
          onError={setError}
          onDone={setNotice}
        />
      )}
    </div>
  );
}

const SR_ONLY: React.CSSProperties = {
  position: 'absolute', width: 1, height: 1, padding: 0, margin: -1,
  overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
};

/* ── One person ─────────────────────────────────────────────────── */

function MemberLine({
  member, workspaceId, callerRole, canManage, owners, onDone, onError,
}: {
  member: MemberRow;
  workspaceId: string;
  callerRole: WorkspaceRole | null;
  canManage: boolean;
  owners: number;
  onDone: (line: string) => void | Promise<void>;
  onError: (msg: string) => void;
}) {
  const [picking, setPicking] = useState(false);
  const [next, setNext] = useState<string>('');
  const [removing, setRemoving] = useState(false);
  const [busy, setBusy] = useState(false);

  const changeVerdict = canChangeRole({
    caller: callerRole, target: member.role, isSelf: member.isYou,
    next: next || undefined, ownerCount: owners,
  });
  const removeVerdict = canRemove({
    caller: callerRole, target: member.role, isSelf: member.isYou, ownerCount: owners,
  });

  const apply = async () => {
    if (!next || !changeVerdict.allowed) return;
    setBusy(true); onError('');
    try {
      await setWorkspaceMemberRole(member.id, next as WorkspaceRole);
      setPicking(false); setNext('');
      await onDone(member.isYou
        ? `You are now ${ROLE_LABELS[next as WorkspaceRole] ?? next}.`
        : `${member.name} is now ${ROLE_LABELS[next as WorkspaceRole] ?? next}.`);
    } catch (e: any) {
      onError(e?.message ?? String(e));
    } finally { setBusy(false); }
  };

  const remove = async () => {
    setBusy(true); onError('');
    try {
      const response = await fetch(withBase('/api/team/remove-member'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace_id: workspaceId, membership_id: member.id }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result?.ok) {
        throw new Error(result?.error || response.statusText || 'Removal failed');
      }
      setRemoving(false);
      await onDone(member.isYou
        ? 'You have left this workspace.'
        : `${member.name} was removed from the workspace.`);
    } catch (e: any) {
      onError(e?.message ?? String(e));
    } finally { setBusy(false); }
  };

  const open = picking || removing;
  const span = canManage ? 5 : 4;

  return (
    <>
      <tr style={{ borderTop: '1px solid var(--aq-border-light)' }}>
        <Td>
          <span style={{ fontWeight: 600, color: member.named ? undefined : 'var(--aq-text-muted)' }}>
            {member.name}
          </span>
          {member.isYou && (
            <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--aq-text-muted)' }}>(you)</span>
          )}
          {!member.named && (
            <span style={{ display: 'block', fontSize: 11, color: '#a16207', fontWeight: 600, marginTop: 2 }}>
              They have not set a name — their tasks and comments show as blank.
            </span>
          )}
        </Td>
        <Td>
          {/* Printed once. There used to be a select AND a badge beside it. */}
          <span title={member.blurb} style={{
            display: 'inline-block', fontSize: 10.5, fontWeight: 700,
            padding: '2px 9px', borderRadius: 999, whiteSpace: 'nowrap',
            background: member.role === 'owner' ? 'var(--aq-accent-light)'
              : member.role === 'admin' ? '#dbeafe'
              : 'var(--aq-bg-sunken)',
            color: member.role === 'owner' ? '#14603a'
              : member.role === 'admin' ? '#1e40af'
              : 'var(--aq-text-secondary)',
          }}>{member.roleLabel}</span>
          {member.blurb && (
            <span style={{
              display: 'block', fontSize: 11, color: 'var(--aq-text-muted)',
              marginTop: 3, whiteSpace: 'normal', maxWidth: 360,
            }}>{member.blurb}</span>
          )}
        </Td>
        <Td num nowrap muted={member.tasks === 0}>{member.tasks === 0 ? 'free' : member.tasks}</Td>
        <Td muted nowrap>{member.joined}</Td>
        {canManage && (
          <Td num nowrap>
            <span style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="aq-btn aq-btn-ghost"
                style={{ padding: '4px 10px', fontSize: 12, whiteSpace: 'nowrap' }}
                disabled={busy || open || !canChangeRole({
                  caller: callerRole, target: member.role, isSelf: member.isYou, ownerCount: owners,
                }).allowed}
                title={canChangeRole({
                  caller: callerRole, target: member.role, isSelf: member.isYou, ownerCount: owners,
                }).reason || 'Change what this person can do'}
                onClick={() => { setPicking(true); setNext(''); }}
              >Change role</button>
              <button
                type="button"
                className="aq-btn aq-btn-ghost"
                style={{ padding: '4px 10px', fontSize: 12, whiteSpace: 'nowrap', color: removeVerdict.allowed ? '#b91c1c' : undefined }}
                disabled={busy || open || !removeVerdict.allowed}
                title={removeVerdict.reason || (member.isYou ? 'Leave this workspace' : 'Remove from the workspace')}
                onClick={() => setRemoving(true)}
              >{member.isYou ? 'Leave' : 'Remove'}</button>
            </span>
          </Td>
        )}
      </tr>

      {picking && (
        <tr>
          <td colSpan={span} style={{ padding: '0 12px 14px', borderTop: 'none' }}>
            <div style={{
              border: '1px solid var(--aq-border-light)', borderRadius: 'var(--aq-radius)',
              padding: 14, background: 'var(--aq-bg-sunken)',
              display: 'flex', flexDirection: 'column', gap: 10,
            }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12.5 }}>
                  {member.isYou ? 'Change your role to' : `Change ${member.name} to`}
                </span>
                <select
                  className="aq-select"
                  style={{ width: 190 }}
                  value={next}
                  onChange={(e) => setNext(e.target.value)}
                  aria-label={`New role for ${member.name}`}
                >
                  <option value="">Pick a role…</option>
                  {assignableRoles(callerRole)
                    .filter((r) => r !== member.role)
                    .map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                </select>
                <button
                  type="button"
                  className="aq-btn aq-btn-ghost"
                  style={{ fontSize: 12, marginLeft: 'auto' }}
                  onClick={() => { setPicking(false); setNext(''); }}
                  disabled={busy}
                >Cancel</button>
              </div>

              {next && !changeVerdict.allowed && (
                <p style={{ fontSize: 12, color: '#b91c1c', margin: 0 }}>{changeVerdict.reason}</p>
              )}

              {/* A role change is a permissions change, so it is a question —
                  it used to happen on a select's onChange. */}
              {next && changeVerdict.allowed && (
                <Confirm
                  text={roleChangeWarning({
                    name: member.name, from: member.role, to: next, isSelf: member.isYou,
                  })}
                  confirmLabel={`Make ${member.isYou ? 'me' : 'them'} ${ROLE_LABELS[next as WorkspaceRole] ?? next}`}
                  busy={busy}
                  onConfirm={apply}
                  onCancel={() => setNext('')}
                />
              )}
            </div>
          </td>
        </tr>
      )}

      {removing && (
        <tr>
          <td colSpan={span} style={{ padding: '0 12px 14px', borderTop: 'none' }}>
            <Confirm
              text={removeWarning({
                name: member.name, role: member.role, isSelf: member.isYou, tasks: member.tasks,
              })}
              confirmLabel={member.isYou ? 'Leave the workspace' : 'Remove them'}
              busy={busy}
              onConfirm={remove}
              onCancel={() => setRemoving(false)}
            />
          </td>
        </tr>
      )}
    </>
  );
}

/* ── Creating a login ───────────────────────────────────────────── */

function CreateAccountCard({
  workspaceId, callerRole, onCreated, onError,
}: {
  workspaceId: string;
  callerRole: WorkspaceRole | null;
  onCreated: (line: string) => void | Promise<void>;
  onError: (msg: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<WorkspaceRole>('member');
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [account, setAccount] = useState<{
    email: string; password: string | null; role: string; created_new_user: boolean;
  } | null>(null);

  const create = async () => {
    const found = emailProblems(email);
    setProblems(found);
    if (found.length) return;
    setBusy(true); onError(''); setAccount(null);
    try {
      const response = await fetch(withBase('/api/team/admin-create'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace_id: workspaceId, email: email.trim(), role }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result?.ok) {
        throw new Error(result?.error || response.statusText || 'Account creation failed');
      }
      setAccount({
        email: result.email,
        password: result.password ?? null,
        role: result.role,
        created_new_user: Boolean(result.created_new_user),
      });
      setEmail('');
      setRole('member');
      await onCreated(result.created_new_user
        ? `A login was created for ${result.email}. The password is below — it is shown once.`
        : `${result.email} already had a login and was added to this workspace.`);
    } catch (e: any) {
      onError(e?.message ?? String(e));
    } finally { setBusy(false); }
  };

  if (!open && !account) {
    return (
      <div style={{ display: 'flex' }}>
        <AddButton label="+ Add somebody to the team" onClick={() => setOpen(true)} />
      </div>
    );
  }

  return (
    <div className="aq-card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {open && (
        <>
          <div>
            <h3 style={{ fontSize: 15, fontWeight: 700 }}>Add somebody to the team</h3>
            <p style={{ fontSize: 12.5, color: 'var(--aq-text-muted)', marginTop: 3, maxWidth: '68ch' }}>
              {createAccountNote(role)}
            </p>
          </div>

          {problems.length > 0 && (
            <div role="alert" style={{
              background: '#fef3c7', border: '1px solid #fde68a', color: '#78350f',
              padding: '9px 12px', borderRadius: 'var(--aq-radius)', fontSize: 12.5,
            }}>{problems[0]}</div>
          )}

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              className="aq-input"
              style={{ flex: '1 1 240px', width: 'auto', minWidth: 200 }}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="teammate@aqcreativity.com"
              aria-label="Email address"
            />
            <select
              className="aq-select"
              style={{ width: 180 }}
              value={role}
              onChange={(e) => setRole(e.target.value as WorkspaceRole)}
              aria-label="Role"
            >
              {assignableRoles(callerRole).map((r) => (
                <option key={r} value={r}>{ROLE_LABELS[r]}</option>
              ))}
            </select>
            <button
              type="button"
              className="aq-btn"
              onClick={create}
              disabled={busy}
              style={{ background: INK, borderColor: INK, color: '#fff', opacity: busy ? 0.45 : 1 }}
            >{busy ? 'Creating…' : 'Create the login'}</button>
            <button
              type="button"
              className="aq-btn aq-btn-ghost"
              onClick={() => { setOpen(false); setProblems([]); }}
              disabled={busy}
            >Cancel</button>
          </div>
        </>
      )}

      {account && (
        <div style={{
          border: '1px solid var(--aq-border)', borderRadius: 'var(--aq-radius)',
          padding: 14, display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 13.5 }}>
                {account.created_new_user ? 'Pass these on' : 'They already had a login'}
              </div>
              <div style={{ fontSize: 12, color: 'var(--aq-text-muted)', marginTop: 2 }}>
                {account.created_new_user
                  ? `The password is shown once. They join as ${ROLE_LABELS[account.role as WorkspaceRole] ?? account.role} and can change it after signing in.`
                  : `Added to this workspace as ${ROLE_LABELS[account.role as WorkspaceRole] ?? account.role}. Their existing password still works.`}
              </div>
            </div>
            <button
              type="button"
              className="aq-btn aq-btn-ghost"
              style={{ marginLeft: 'auto', fontSize: 12 }}
              onClick={() => setAccount(null)}
            >Done</button>
          </div>
          <CredentialLine label="Email" value={account.email} />
          {account.password && <CredentialLine label="Password" value={account.password} />}
          <CredentialLine label="Sign in at" value={absoluteUrl('/auth')} />
        </div>
      )}
    </div>
  );
}

function CredentialLine({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* they can select it by hand */ }
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{
        fontSize: 10, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase',
        color: 'var(--aq-text-muted)', minWidth: 78,
      }}>{label}</span>
      <code style={{
        flex: 1, fontSize: 12.5, padding: '7px 10px',
        background: 'var(--aq-bg-sunken)', borderRadius: 'var(--aq-radius)', wordBreak: 'break-all',
      }}>{value}</code>
      <button
        type="button"
        className="aq-btn aq-btn-secondary"
        onClick={copy}
        style={{ padding: '5px 12px', fontSize: 12 }}
      >{copied ? 'Copied' : 'Copy'}</button>
    </div>
  );
}

/* ── The old email links ────────────────────────────────────────── */

function LegacyInvites({
  workspaceId, onError, onDone,
}: {
  workspaceId: string;
  onError: (msg: string) => void;
  onDone: (line: string) => void;
}) {
  const { invites, refetch, loading } = useWorkspaceInvites(workspaceId);

  // A minute, not a second — and only while something is still counting down.
  // The whole panel used to re-render every second so these pills stayed
  // accurate, on a table that is usually empty.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => { setNow(Date.now()); }, []);
  const anyLive = invites.some((i) => !i.accepted_at);
  useEffect(() => {
    if (!anyLive) return;
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, [anyLive]);

  const [deleting, setDeleting] = useState<InviteRow | null>(null);
  const [clearing, setClearing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const rows = useMemo(
    () => (now == null ? [] : buildInvites(invites as any, now)),
    [invites, now],
  );
  const summary = useMemo(() => inviteSummary(rows), [rows]);

  if (loading || now == null || invites.length === 0) return null;

  const copy = async (row: InviteRow) => {
    const raw = invites.find((i) => i.id === row.id);
    if (!raw) return;
    try {
      await navigator.clipboard.writeText(absoluteUrl(`/auth?invite=${raw.token}`));
      setCopiedId(row.id);
      setTimeout(() => setCopiedId((id) => (id === row.id ? null : id)), 1500);
    } catch (e: any) {
      onError(`Could not copy the link: ${e?.message ?? e}`);
    }
  };

  const removeOne = async () => {
    if (!deleting) return;
    setBusy(true); onError('');
    try {
      await deleteWorkspaceInvite(deleting.id);
      await refetch();
      onDone(`The link for ${deleting.email} was deleted.`);
      setDeleting(null);
    } catch (e: any) {
      onError(e?.message ?? String(e));
    } finally { setBusy(false); }
  };

  const clearExpired = async () => {
    setBusy(true); onError('');
    try {
      await deleteExpiredWorkspaceInvites(workspaceId);
      await refetch();
      onDone(`${summary.expired} expired ${summary.expired === 1 ? 'link' : 'links'} deleted.`);
      setClearing(false);
    } catch (e: any) {
      onError(e?.message ?? String(e));
    } finally { setBusy(false); }
  };

  return (
    <div className="aq-card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <h3 style={{ fontSize: 15, fontWeight: 700 }}>Old invite links</h3>
          <p style={{ fontSize: 12.5, color: 'var(--aq-text-muted)', marginTop: 3, maxWidth: '68ch' }}>
            From the email flow that came before. Nothing new is created here — a live
            link still works for whoever holds it, which is the reason to clear the
            ones you no longer want used. {summary.label}.
          </p>
        </div>
        {summary.expired > 0 && (
          <button
            type="button"
            className="aq-btn aq-btn-secondary"
            onClick={() => setClearing(true)}
            disabled={busy || clearing}
          >Clear {summary.expired} expired</button>
        )}
      </div>

      {clearing && (
        <Confirm
          text={clearExpiredWarning(summary.expired)}
          confirmLabel="Clear them"
          busy={busy}
          onConfirm={clearExpired}
          onCancel={() => setClearing(false)}
        />
      )}

      <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8, margin: 0, padding: 0 }}>
        {rows.map((row) => (
          <li key={row.id} style={{
            display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap',
            padding: '10px 12px', borderRadius: 'var(--aq-radius)',
            border: '1px solid var(--aq-border-light)',
          }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{row.email}</div>
              <div style={{ fontSize: 11.5, color: 'var(--aq-text-muted)' }}>{row.line}</div>
            </div>
            <span style={{
              fontSize: 10.5, fontWeight: 700, padding: '2px 9px', borderRadius: 999,
              background: row.state === 'accepted' ? 'var(--aq-accent-light)'
                : row.state === 'expired' ? 'var(--aq-bg-sunken)' : '#fef3c7',
              color: row.state === 'accepted' ? '#14603a'
                : row.state === 'expired' ? 'var(--aq-text-muted)' : '#92400e',
            }}>{row.state === 'pending' ? 'still works' : row.state}</span>
            <span style={{ fontSize: 11.5, color: 'var(--aq-text-muted)' }}>{row.roleLabel}</span>
            {row.copyable && (
              <button
                type="button"
                className="aq-btn aq-btn-ghost"
                style={{ padding: '4px 10px', fontSize: 12 }}
                onClick={() => copy(row)}
              >{copiedId === row.id ? 'Copied' : 'Copy link'}</button>
            )}
            <button
              type="button"
              className="aq-btn aq-btn-ghost"
              style={{ padding: '4px 10px', fontSize: 12, color: '#b91c1c' }}
              onClick={() => setDeleting(row)}
              disabled={busy}
            >Delete</button>
          </li>
        ))}
      </ul>

      {deleting && (
        <Confirm
          text={inviteDeleteWarning(deleting)}
          confirmLabel="Delete the link"
          busy={busy}
          onConfirm={removeOne}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  );
}

/* ── Cells ──────────────────────────────────────────────────────── */

function Td({ children, num = false, muted = false, nowrap = false }: {
  children?: React.ReactNode; num?: boolean; muted?: boolean; nowrap?: boolean;
}) {
  return (
    <td style={{
      textAlign: num ? 'right' : 'left', padding: '11px 12px',
      color: muted ? 'var(--aq-text-muted)' : 'var(--aq-text)',
      verticalAlign: 'top',
      whiteSpace: nowrap ? 'nowrap' : undefined,
      fontVariantNumeric: num ? 'tabular-nums' : undefined,
    }}>{children}</td>
  );
}
