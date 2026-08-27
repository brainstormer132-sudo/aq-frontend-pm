/**
 * The Team screen: who is in the workspace, what they can do, and how much
 * they are carrying.
 *
 * Pure. No React, no Supabase, no argless `new Date()`.
 *
 * Three things in here are not cosmetic:
 *
 *  1. **The task count.** `useTaskCountsByMember` counted a task once for the
 *     assignee and again for the same person's `task_members` row, so anybody
 *     assigned to their own task was counted twice — and it counted
 *     *cancelled* work as open, because the filter was `status != 'done'`.
 *     `taskCounts()` de-duplicates by (person, task) and treats cancelled as
 *     closed. The Dashboard's Workload panel reads the same hook, so both
 *     screens were wrong in the same way.
 *
 *  2. **Role changes.** They used to happen on a `<select>`'s onChange with no
 *     confirmation — one scroll wheel over the wrong row and somebody is an
 *     owner. Every change now goes through `roleChangeWarning()`, which says
 *     in words what the new role can do.
 *
 *  3. **What a role means.** Nowhere in the app said what "Operations" gets
 *     you. `ROLE_BLURB` says it, and every line is taken from what the code
 *     actually gates on — WorkflowSidebar's `visibleTo` and the `canX` checks
 *     on each screen. If those change, these change.
 */

// ── Small shared helpers ────────────────────────────────────────────

function txt(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function isoDay(v: unknown): string {
  const s = txt(v);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
}

/**
 * "6 Aug 2026". Built by hand rather than through toLocaleDateString, which
 * reads the machine's locale and renders differently on the server and in the
 * browser — the team list did exactly that on every row.
 */
export function longDate(value: unknown): string {
  const day = isoDay(value);
  if (!day) return 'unknown';
  const [y, m, d] = day.split('-');
  return `${Number(d)} ${MONTHS[Number(m) - 1] ?? '?'} ${y}`;
}

export function dayMs(value: unknown): number {
  const day = isoDay(value);
  return day ? Date.parse(`${day}T00:00:00Z`) : 0;
}

// ── Roles ───────────────────────────────────────────────────────────

export const ROLES = [
  'owner', 'admin', 'operations', 'sales', 'marketing', 'key_account', 'member',
] as const;
export type Role = typeof ROLES[number];

export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Owner',
  admin: 'Admin',
  operations: 'Operations',
  sales: 'Sales',
  marketing: 'Marketing',
  key_account: 'Key account',
  member: 'Member',
};

/**
 * What each role actually gets, taken from WorkflowSidebar's `visibleTo` and
 * the per-screen permission checks. Said out loud because a role you cannot
 * describe is a role nobody assigns correctly.
 */
export const ROLE_BLURB: Record<Role, string> = {
  owner: 'Everything, including making somebody else an owner.',
  admin: 'Everything except handing out ownership.',
  operations: 'All Tasks and Tracking Sheets. Fulfils quotation, invoice and contract requests.',
  sales: 'New Task, CRM, Clients, Tracking Sheets and Data. Can delete a campaign they raised.',
  marketing: 'Marketing Inbox, New Task, CRM, Clients, Vendors, Tracking Sheets and every task.',
  key_account: 'All Tasks, CRM, Tracking Sheets and Data. Approves and rejects contract requests.',
  member: 'Dashboard, Inbox and Team. Can be assigned work and mentioned on it.',
};

export function isRole(v: unknown): v is Role {
  return (ROLES as readonly string[]).includes(txt(v));
}

export function roleLabel(raw: unknown): string {
  const r = txt(raw);
  if (isRole(r)) return ROLE_LABELS[r];
  if (!r) return 'No role';
  const words = r.replace(/[_-]+/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Seniority order, for sorting. Owner first. */
export function roleRank(raw: unknown): number {
  const i = (ROLES as readonly string[]).indexOf(txt(raw));
  return i === -1 ? ROLES.length : i;
}

// ── Open work ───────────────────────────────────────────────────────

/**
 * A task somebody is still carrying.
 *
 * `done` and `cancelled` are both finished. The hook filtered on
 * `status != 'done'`, so every cancelled campaign in the workspace was still
 * being counted against whoever it had been assigned to.
 */
export function isOpenStatus(status: unknown): boolean {
  const s = txt(status).toLowerCase();
  return s !== 'done' && s !== 'cancelled';
}

export interface CountableTask {
  id: string;
  assignee_id?: string | null;
  status?: string | null;
}

export interface CountableMembership {
  task_id: string;
  user_id: string;
  status?: string | null;
}

/**
 * How much open work each person is carrying.
 *
 * De-duplicated by (person, task): being the assignee AND a member of the same
 * task is one piece of work, not two. That double count was making the busiest
 * people look busier than they are on both this screen and the Dashboard.
 */
export function taskCounts(input: {
  tasks?: CountableTask[];
  memberships?: CountableMembership[];
}): Record<string, number> {
  const pairs = new Set<string>();

  for (const t of input.tasks ?? []) {
    const who = txt(t.assignee_id);
    const id = txt(t.id);
    if (!who || !id || !isOpenStatus(t.status)) continue;
    pairs.add(`${who}|${id}`);
  }
  for (const m of input.memberships ?? []) {
    const who = txt(m.user_id);
    const id = txt(m.task_id);
    if (!who || !id || !isOpenStatus(m.status)) continue;
    pairs.add(`${who}|${id}`);
  }

  const out: Record<string, number> = {};
  for (const key of pairs) {
    const who = key.slice(0, key.indexOf('|'));
    out[who] = (out[who] ?? 0) + 1;
  }
  return out;
}

// ── The roster ──────────────────────────────────────────────────────

export interface MemberInput {
  id: string;
  user_id: string;
  role?: string | null;
  joined_at?: string | null;
  profile?: { full_name?: string | null; avatar_url?: string | null } | null;
}

export interface MemberRow {
  /** workspace_members.id — what a role change or a removal is addressed to. */
  id: string;
  userId: string;
  name: string;
  /** False when the profile row has no name yet, so the UI can say so kindly. */
  named: boolean;
  avatar: string | null;
  role: string;
  roleLabel: string;
  roleRank: number;
  blurb: string;
  isYou: boolean;
  joined: string;
  joinedMs: number;
  tasks: number;
  search: string;
}

export function buildMembers(input: {
  members: MemberInput[];
  counts?: Record<string, number>;
  currentUserId?: string | null;
}): MemberRow[] {
  const me = txt(input.currentUserId);
  return (input.members ?? []).map((m) => {
    const named = Boolean(txt(m.profile?.full_name));
    const name = named ? txt(m.profile?.full_name) : 'Name not set';
    const role = txt(m.role);
    return {
      id: txt(m.id),
      userId: txt(m.user_id),
      name,
      named,
      avatar: txt(m.profile?.avatar_url) || null,
      role,
      roleLabel: roleLabel(role),
      roleRank: roleRank(role),
      blurb: isRole(role) ? ROLE_BLURB[role] : '',
      isYou: Boolean(me) && txt(m.user_id) === me,
      joined: longDate(m.joined_at),
      joinedMs: dayMs(m.joined_at),
      tasks: input.counts?.[txt(m.user_id)] ?? 0,
      search: `${name} ${roleLabel(role)}`.toLowerCase(),
    };
  });
}

export type MemberSortKey = 'name' | 'role' | 'tasks' | 'joined';
export type SortDir = 'asc' | 'desc';
export interface MemberSort { key: MemberSortKey; dir: SortDir }

export const DEFAULT_MEMBER_SORT: MemberSort = { key: 'role', dir: 'asc' };

export const MEMBER_COLUMNS: { key: MemberSortKey; label: string; num?: boolean }[] = [
  { key: 'name', label: 'Name' },
  { key: 'role', label: 'Role' },
  { key: 'tasks', label: 'Open work', num: true },
  { key: 'joined', label: 'Joined' },
];

/** Text opens A–Z; role opens at the top of the tree; a count opens at the most. */
export function firstMemberDir(key: MemberSortKey): SortDir {
  if (key === 'tasks' || key === 'joined') return 'desc';
  return 'asc';
}

export function sortMembers(rows: MemberRow[], sort: MemberSort): MemberRow[] {
  const dir = sort.dir === 'asc' ? 1 : -1;
  const out = [...(rows ?? [])];
  out.sort((a, b) => {
    let d = 0;
    switch (sort.key) {
      case 'name': d = a.name.localeCompare(b.name); break;
      case 'role': d = a.roleRank - b.roleRank; break;
      case 'tasks': d = a.tasks - b.tasks; break;
      case 'joined': d = a.joinedMs - b.joinedMs; break;
    }
    if (d !== 0) return d * dir;
    return a.name.localeCompare(b.name);
  });
  return out;
}

export interface MemberFilter { query: string; role: string }
export const EMPTY_MEMBER_FILTER: MemberFilter = { query: '', role: '' };

export function isMemberFiltered(f: MemberFilter): boolean {
  return Boolean(txt(f.query) || txt(f.role));
}

export function filterMembers(rows: MemberRow[], f: MemberFilter): MemberRow[] {
  const q = txt(f.query).toLowerCase();
  const role = txt(f.role);
  return (rows ?? []).filter((r) => {
    if (q && !r.search.includes(q)) return false;
    if (role && r.role !== role) return false;
    return true;
  });
}

export interface TeamSummary {
  people: number;
  free: number;
  unnamed: number;
  label: string;
}

export function teamSummary(rows: MemberRow[]): TeamSummary {
  const list = rows ?? [];
  const free = list.filter((r) => r.tasks === 0).length;
  const unnamed = list.filter((r) => !r.named).length;
  const parts = [`${list.length} ${list.length === 1 ? 'person' : 'people'}`];
  if (list.length) parts.push(free ? `${free} with nothing open` : 'everyone has work open');
  return { people: list.length, free, unnamed, label: parts.join(' · ') };
}

export function teamEmptyMessage(f: MemberFilter): string {
  if (txt(f.query)) return `Nobody here matches “${txt(f.query)}”.`;
  if (txt(f.role)) return `Nobody is ${roleLabel(f.role).toLowerCase()}.`;
  return 'Nobody has joined this workspace yet.';
}

/** How many people hold each role, for the filter chips. */
export function roleCounts(rows: MemberRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of ROLES) out[r] = 0;
  for (const m of rows ?? []) out[m.role] = (out[m.role] ?? 0) + 1;
  return out;
}

// ── What one person may do to another ───────────────────────────────
//
// The server is the authority (RLS on workspace_members, and
// /api/team/remove-member). These say the same thing early, so the screen can
// explain a refusal instead of drawing a control that fails.

export interface Verdict {
  allowed: boolean;
  /** Why not. Empty when allowed. */
  reason: string;
}

const ADMINISH = ['owner', 'admin'];

export function canManageTeam(caller: unknown): boolean {
  return ADMINISH.includes(txt(caller));
}

/** Which roles this caller may hand out. An admin cannot create an owner. */
export function assignableRoles(caller: unknown): Role[] {
  if (txt(caller) === 'owner') return [...ROLES];
  if (txt(caller) === 'admin') return ROLES.filter((r) => r !== 'owner');
  return [];
}

export function canChangeRole(input: {
  caller: unknown;
  target: unknown;
  isSelf: boolean;
  next?: unknown;
  /** How many owners the workspace has, so the last one cannot be demoted. */
  ownerCount?: number;
}): Verdict {
  const caller = txt(input.caller);
  const target = txt(input.target);
  const next = txt(input.next);

  if (!canManageTeam(caller)) {
    return { allowed: false, reason: 'Only an owner or an admin can change roles.' };
  }
  if (target === 'owner' && caller !== 'owner') {
    return { allowed: false, reason: 'Only an owner can change another owner’s role.' };
  }
  if (next && next === target) {
    return { allowed: false, reason: 'That is already their role.' };
  }
  if (next === 'owner' && caller !== 'owner') {
    return { allowed: false, reason: 'Only an owner can make somebody else an owner.' };
  }
  if (input.isSelf && target === 'owner' && next && next !== 'owner') {
    const others = (input.ownerCount ?? 1) - 1;
    if (others <= 0) {
      return { allowed: false, reason: 'You are the only owner. Make somebody else an owner first.' };
    }
  }
  return { allowed: true, reason: '' };
}

/**
 * What the confirmation says. Every role change gets one — it used to happen
 * on a select's onChange, which is a permissions change on a scroll wheel.
 */
export function roleChangeWarning(input: {
  name: string;
  from: unknown;
  to: unknown;
  isSelf: boolean;
}): string {
  const to = txt(input.to);
  const toLabel = roleLabel(to);
  const fromLabel = roleLabel(input.from);
  const who = input.isSelf ? 'You' : txt(input.name) || 'This person';
  const gets = isRole(to) ? ` ${ROLE_BLURB[to]}` : '';

  if (to === 'owner') {
    return `${who} will be an Owner, not ${aOrAn(fromLabel)}.${gets} An owner can change anybody's role, including yours.`;
  }
  if (input.isSelf) {
    return `You will be ${aOrAn(toLabel)}, not ${aOrAn(fromLabel)}.${gets} You may lose screens you can see right now, and you cannot put yourself back.`;
  }
  return `${who} will be ${aOrAn(toLabel)}, not ${aOrAn(fromLabel)}.${gets}`;
}

function aOrAn(label: string): string {
  return /^[AEIOU]/i.test(label) ? `an ${label}` : `a ${label}`;
}

export function canRemove(input: {
  caller: unknown;
  target: unknown;
  isSelf: boolean;
  ownerCount?: number;
}): Verdict {
  const caller = txt(input.caller);
  const target = txt(input.target);

  if (!canManageTeam(caller)) {
    return { allowed: false, reason: 'Only an owner or an admin can remove somebody.' };
  }
  if (target === 'owner' && caller !== 'owner') {
    return { allowed: false, reason: 'An admin cannot remove an owner.' };
  }
  if (target === 'owner' && (input.ownerCount ?? 1) <= 1) {
    return {
      allowed: false,
      reason: input.isSelf
        ? 'You are the only owner. Make somebody else an owner first.'
        : 'This is the only owner. Make somebody else an owner first.',
    };
  }
  return { allowed: true, reason: '' };
}

export function removeWarning(input: {
  name: string;
  role: unknown;
  isSelf: boolean;
  tasks?: number;
}): string {
  const label = roleLabel(input.role);
  const open = input.tasks ?? 0;
  const carrying = open > 0
    ? ` ${input.isSelf ? 'You are' : 'They are'} still carrying ${open} open ${open === 1 ? 'task' : 'tasks'}, which will stay assigned to ${input.isSelf ? 'you' : 'them'}.`
    : '';

  if (input.isSelf) {
    return `You will lose access to this workspace.${carrying} Your login is kept, so an owner can add you back.`;
  }
  const who = txt(input.name) || 'This person';
  return `${who} will lose access to this workspace as ${aOrAn(label)}.${carrying} Their login is kept, so they can be added back.`;
}

export function countOwners(rows: { role: string }[]): number {
  return (rows ?? []).filter((r) => txt(r.role) === 'owner').length;
}

// ── Legacy invite links ─────────────────────────────────────────────

export type InviteState = 'pending' | 'accepted' | 'expired';

export interface InviteInput {
  id: string;
  email?: string | null;
  role?: string | null;
  accepted_at?: string | null;
  expires_at?: string | null;
  inviter?: { full_name?: string | null } | null;
}

export function inviteState(invite: InviteInput, nowMs: number): InviteState {
  if (txt(invite.accepted_at)) return 'accepted';
  const ends = Date.parse(txt(invite.expires_at));
  if (Number.isFinite(ends) && ends <= nowMs) return 'expired';
  return 'pending';
}

export interface InviteRow {
  id: string;
  email: string;
  role: string;
  roleLabel: string;
  state: InviteState;
  line: string;
  /** Only a live link is worth copying. */
  copyable: boolean;
}

export function buildInvites(invites: InviteInput[], nowMs: number): InviteRow[] {
  return (invites ?? []).map((inv) => {
    const state = inviteState(inv, nowMs);
    const by = txt(inv.inviter?.full_name) || 'somebody who has left';
    const when = longDate(inv.expires_at);
    return {
      id: txt(inv.id),
      email: txt(inv.email),
      role: txt(inv.role),
      roleLabel: roleLabel(inv.role),
      state,
      line: state === 'accepted'
        ? `Sent by ${by} · already used`
        : state === 'expired'
          ? `Sent by ${by} · expired ${when}`
          : `Sent by ${by} · expires ${when}`,
      copyable: state === 'pending',
    };
  });
}

export function inviteSummary(rows: InviteRow[]): {
  pending: number; accepted: number; expired: number; label: string;
} {
  let pending = 0, accepted = 0, expired = 0;
  for (const r of rows ?? []) {
    if (r.state === 'accepted') accepted += 1;
    else if (r.state === 'expired') expired += 1;
    else pending += 1;
  }
  const parts: string[] = [];
  if (pending) parts.push(`${pending} still live`);
  if (expired) parts.push(`${expired} expired`);
  if (accepted) parts.push(`${accepted} already used`);
  return { pending, accepted, expired, label: parts.join(' · ') || 'none' };
}

export function inviteDeleteWarning(row: InviteRow): string {
  if (row.state === 'accepted') {
    return `${row.email} has already used this link. Deleting it removes the record, not their access.`;
  }
  if (row.state === 'expired') {
    return `The expired link for ${row.email} will be deleted. It already does not work.`;
  }
  return `${row.email}'s link will stop working immediately.`;
}

export function clearExpiredWarning(count: number): string {
  return `${count} expired ${count === 1 ? 'link' : 'links'} will be deleted. Live links and used ones are kept.`;
}

// ── Creating an account ─────────────────────────────────────────────

export function emailProblems(email: unknown): string[] {
  const e = txt(email);
  if (!e) return ['An email address is needed.'];
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) return [`“${e}” does not look like an email address.`];
  return [];
}

/** Said before the button is pressed, because it creates a real login. */
export function createAccountNote(role: unknown): string {
  const label = roleLabel(role);
  const gets = isRole(txt(role)) ? ` ${ROLE_BLURB[txt(role) as Role]}` : '';
  return `A login is created straight away and no email is sent — you get a one-time password to pass on. They join as ${aOrAn(label)}.${gets}`;
}
