'use client';

import { useMemo, useState } from 'react';
import {
  useTaskSources, useClientCategories, useTaskPlatforms, useLookupUsage,
  useVendorCategoriesLegacy,
  useDeletedTasks, restoreTask, useRecentActivity,
  createTaskSource, updateTaskSource, deleteTaskSource,
  createClientCategory, updateClientCategory, deleteClientCategory,
  createTaskPlatform, updateTaskPlatform, deleteTaskPlatform,
  TRACKABLE_VENDOR_CATEGORIES,
  type WorkspaceRole,
} from '@/hooks/use-workflow';
import { Confirm, INK } from './RegistryTable';
import { MAX_BRIEF_FILES, MAX_BRIEF_FILE_BYTES } from '@/lib/new-task';
import { MAX_AVATAR_BYTES } from '@/lib/profile';
import { TRIAGE_PATIENCE_DAYS } from '@/lib/attention';
import { VAT_RATE } from '@/lib/tracking';
import {
  buildLookup, deleteWarning, renameNote, nameProblems, nextPosition, moveSwap,
  lookupSummary, buildVendorCategories, trackingMatchWarning, fixedSettings,
  LOOKUP_COPY,
  type LookupKind, type LookupRow,
} from '@/lib/settings';
import { createClient } from '@/lib/supabase-browser';
import { useOverrideCode, useOverrideLog } from '@/hooks/use-overrides';
import {
  RULES, ruleLabel, codeShapeError,
  actorLabel, overrideTally, byPerson, byRule,
  sortOverrides, filterOverrides, overrideSummary,
} from '@/lib/overrides';

/**
 * Settings — the vocabularies every campaign picks from, and the numbers the
 * app runs on.
 *
 * This screen used to be the team screen (see TeamView.tsx). What was actually
 * *settings* on it was one card, `OperationsLookupsPanel`, editing two of the
 * workspace's four vocabularies. This is that card, corrected and finished.
 *
 * The correction is the important part. Deleting an entry used to end in a
 * `Confirm` button that said nothing, under a grey tip at the bottom of the
 * card claiming:
 *
 *   "Tasks already using a deleted entry will keep their value but it won't
 *    appear in the picker anymore."
 *
 * `pm_tasks.source_id`, `pm_tasks.client_category_id` and
 * `clients.client_category_id` are all `on delete set null`. The rows do not
 * keep their value — they lose it, silently, and nothing said how many. Every
 * delete now counts the rows and says what happens to them.
 *
 * Two vocabularies were missing entirely:
 *
 *  - **Platforms** (`task_platforms`, migration 042) is read by the campaign's
 *    Platform picker and had no create, update or delete anywhere in the app.
 *    The list could only be changed with SQL.
 *  - **Vendor categories** (`vendor_categories`, migration 029) is a global
 *    table that decides whether a vendor is asked for an ID or a licence, and
 *    whether booking one seeds the tracking sheet. It is shown here read-only,
 *    because it is not this workspace's to edit — and because
 *    `isTrackableVendorCategory()` matches it by **text**, so a rename in the
 *    database silently stops the seeding. The screen says when that has
 *    happened.
 *
 * And the numbers that live in the code are on the screen with the reason they
 * cannot be typed here — an absent control is indistinguishable from a missing
 * feature.
 */
export function SettingsView({
  workspaceId, role,
}: {
  workspaceId: string;
  role: WorkspaceRole | null;
}) {
  const canEdit = role === 'owner' || role === 'admin';

  const sources = useTaskSources(workspaceId);
  const categories = useClientCategories(workspaceId);
  const platforms = useTaskPlatforms(workspaceId);
  const { usage, refetch: refetchUsage } = useLookupUsage(workspaceId);
  const { categories: vendorCats, refetch: refetchVendorCats } = useVendorCategoriesLegacy();
  // Which category row is mid-save, so its tick cannot be clicked twice.
  const [savingCat, setSavingCat] = useState('');
  // Only an owner or admin can read this at all — the RPC enforces it, so a
  // marketing user simply sees an empty bin rather than a forbidden one.
  const { items: deleted, refetch: refetchDeleted } = useDeletedTasks(workspaceId);
  // The full log. The dashboard shows six; this is where you come when you
  // need to know who did something and when.
  const { items: log } = useRecentActivity(workspaceId, 100);

  const [error, setError] = useState('');

  const platformUsage = useMemo(() => {
    // pm_tasks.platforms holds the name, so the count is keyed by name.
    const out: Record<string, { campaigns: number }> = {};
    for (const p of platforms.items) {
      out[p.id] = { campaigns: usage.platforms[(p.name ?? '').trim()] ?? 0 };
    }
    return out;
  }, [platforms.items, usage.platforms]);

  const vendorRows = useMemo(
    () => buildVendorCategories(vendorCats as any, TRACKABLE_VENDOR_CATEGORIES),
    [vendorCats],
  );
  const trackingWarning = trackingMatchWarning(vendorRows);

  const fixed = useMemo(() => fixedSettings({
    vatRate: VAT_RATE,
    triageDays: TRIAGE_PATIENCE_DAYS,
    briefFiles: MAX_BRIEF_FILES,
    briefFileBytes: MAX_BRIEF_FILE_BYTES,
    avatarBytes: MAX_AVATAR_BYTES,
    pageSize: 1000,
    contractsCanDownload: true,
  }), []);

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <header>
        <h2 style={{ fontSize: 20, fontWeight: 700 }}>Settings</h2>
        <p style={{ fontSize: 13, color: 'var(--aq-text-muted)', marginTop: 4, maxWidth: '70ch' }}>
          The lists every campaign picks from, and the numbers the app runs on.
          People, roles and logins live on <strong>Team</strong>.
        </p>
      </header>

      {error && (
        <div role="alert" style={{
          background: 'var(--aq-red-bg)', border: '1px solid var(--aq-red-border)', color: 'var(--aq-red-strong)',
          padding: '10px 14px', borderRadius: 'var(--aq-radius)', fontSize: 12.5,
        }}>{error}</div>
      )}

      {canEdit && <BackgroundJobs workspaceId={workspaceId} />}

      <LookupCard
        kind="source"
        items={sources.items}
        usage={usage.sources ? mapCounts(usage.sources) : {}}
        canEdit={canEdit}
        onError={setError}
        onCreate={(name, position) => createTaskSource(workspaceId, name, position)}
        onUpdate={updateTaskSource}
        onDelete={deleteTaskSource}
        refetch={async () => { await sources.refetch(); await refetchUsage(); }}
      />

      <LookupCard
        kind="category"
        items={categories.items}
        usage={usage.categories}
        canEdit={canEdit}
        onError={setError}
        onCreate={(name, position) => createClientCategory(workspaceId, name, position)}
        onUpdate={updateClientCategory}
        onDelete={deleteClientCategory}
        refetch={async () => { await categories.refetch(); await refetchUsage(); }}
      />

      <LookupCard
        kind="platform"
        items={platforms.items}
        usage={platformUsage}
        canEdit={canEdit}
        onError={setError}
        onCreate={(name, position) => createTaskPlatform(workspaceId, name, position)}
        onUpdate={updateTaskPlatform}
        onDelete={deleteTaskPlatform}
        refetch={async () => { await platforms.refetch(); await refetchUsage(); }}
      />

      {/* ── Vendor categories, read-only ─────────────────────────── */}
      <section className="aq-card" style={{ padding: 18 }}>
        <header style={{ marginBottom: 10 }}>
          <h3 style={{ fontSize: 15, fontWeight: 700 }}>Vendor categories</h3>
          <p style={{ fontSize: 12.5, color: 'var(--aq-text-muted)', marginTop: 3, maxWidth: '70ch' }}>
            Shared by every workspace. It decides three things you would not
            guess from the Vendors screen: which identifier a vendor is asked
            for, whether booking one puts a row on the campaign's tracking
            sheet, and whether a booking with that vendor needs a contract
            before it can be marked complete.
          </p>
        </header>

        {trackingWarning && (
          <div role="alert" style={{
            background: 'var(--aq-amber-bg)', border: '1px solid var(--aq-amber-border)', color: 'var(--aq-amber-deep)',
            padding: '10px 12px', borderRadius: 'var(--aq-radius)', fontSize: 12.5, marginBottom: 12,
          }}>{trackingWarning}</div>
        )}

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 520 }}>
            <thead>
              <tr>
                <Th>Category</Th>
                <Th>Identifier on file</Th>
                <Th>Tracking sheet</Th>
                <Th>Contract required</Th>
              </tr>
            </thead>
            <tbody>
              {vendorRows.map((c) => (
                <tr key={c.id} style={{ borderTop: '1px solid var(--aq-border-light)' }}>
                  <Td>
                    <span style={{ fontWeight: 600, color: c.active ? undefined : 'var(--aq-text-muted)' }}>
                      {c.label}
                    </span>
                    {!c.active && (
                      <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--aq-text-muted)' }}>
                        not offered
                      </span>
                    )}
                  </Td>
                  <Td muted>{c.identifier}</Td>
                  <Td muted={!c.tracked}>
                    {c.tracked ? 'Booking one adds a row' : '—'}
                  </Td>
                  {/* Excusing a category here is the alternative to passing
                      the rule one booking at a time. It is deliberately the
                      easier of the two to find and the harder of the two to
                      do: migration 126 makes writing this table owner and
                      admin only, because an exemption easier to reach than
                      the override defeats the override. */}
                  <Td>
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6,
                      cursor: canEdit ? 'pointer' : 'default' }}>
                      <input
                        type="checkbox"
                        checked={c.requiresContract}
                        disabled={!canEdit || savingCat === c.id}
                        onChange={async (e) => {
                          const on = e.target.checked;
                          setSavingCat(c.id); setError('');
                          const { error: err } = await (createClient() as any)
                            .from('vendor_categories')
                            .update({ requires_contract: on })
                            .eq('id', c.id);
                          if (err) setError(err.message ?? String(err));
                          else await refetchVendorCats();
                          setSavingCat('');
                        }}
                      />
                      <span style={{ color: c.requiresContract ? undefined : 'var(--aq-text-muted)' }}>
                        {c.requiresContract ? 'Yes' : 'Excused'}
                      </span>
                    </label>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* -- Passing a rule --------------------------------------- */}
      <RuleOverrides workspaceId={workspaceId} canEdit={canEdit} />

      {/* ── Deleted tasks ────────────────────────────────────────── */}
      {(canEdit || deleted.length > 0) && (
        <section className="aq-card" style={{ padding: 18 }}>
          <header style={{ marginBottom: 10 }}>
            <h3 style={{ fontSize: 15, fontWeight: 700 }}>Recently deleted</h3>
            <p style={{ fontSize: 12.5, color: 'var(--aq-text-muted)', marginTop: 3, maxWidth: '70ch' }}>
              A deleted campaign disappears from every screen immediately, and
              stays here for 30 days in case it was a mistake. After that it is
              removed for good, along with its bookings, ads and tracking rows.
              This is the only place it can be seen.
            </p>
          </header>

          {deleted.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--aq-text-muted)', margin: 0 }}>
              Nothing deleted in the last 30 days.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {deleted.map((d) => (
                <div key={d.id} style={{
                  display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto auto',
                  gap: 14, alignItems: 'center', padding: '11px 0',
                  borderTop: '1px solid var(--aq-border-light)',
                }}>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600 }}>
                      {d.task_name || 'Untitled campaign'}
                    </span>
                    <span style={{ display: 'block', fontSize: 12, color: 'var(--aq-text-muted)', marginTop: 2 }}>
                      {[
                        d.brand_name,
                        d.bookings > 0
                          ? `${d.bookings} ${d.bookings === 1 ? 'booking' : 'bookings'} went with it`
                          : null,
                        d.deleted_by_name ? `deleted by ${d.deleted_by_name}` : null,
                      ].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  {/* Red inside a week: the point of a countdown is that it
                      is read before it runs out. */}
                  <span style={{
                    fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap',
                    fontVariantNumeric: 'tabular-nums',
                    color: d.days_left <= 7 ? 'var(--aq-red)' : 'var(--aq-text-muted)',
                  }}>
                    {d.days_left === 0
                      ? 'gone today'
                      : `${d.days_left} ${d.days_left === 1 ? 'day' : 'days'} left`}
                  </span>
                  {canEdit && (
                    <button
                      type="button"
                      className="aq-btn aq-btn-secondary"
                      style={{ fontSize: 12, padding: '4px 11px' }}
                      onClick={async () => {
                        setError('');
                        try { await restoreTask(d.id); await refetchDeleted(); }
                        catch (e: any) { setError(e?.message ?? String(e)); }
                      }}
                    >Restore</button>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ── The log ──────────────────────────────────────────────── */}
      <section className="aq-card" style={{ padding: 18 }}>
        <header style={{ marginBottom: 10 }}>
          <h3 style={{ fontSize: 15, fontWeight: 700 }}>Activity log</h3>
          <p style={{ fontSize: 12.5, color: 'var(--aq-text-muted)', marginTop: 3, maxWidth: '70ch' }}>
            Who did what, newest first. Entries are never edited or removed —
            not even by an owner — and they outlive what they describe, so a
            campaign removed for good still has its history here.
          </p>
        </header>

        {log.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--aq-text-muted)', margin: 0 }}>
            Nothing logged yet.
          </p>
        ) : (
          <div style={{ maxHeight: 420, overflowY: 'auto' }}>
            {log.map((a) => (
              <div key={a.id} style={{
                display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto',
                gap: 14, alignItems: 'baseline', padding: '9px 0',
                borderTop: '1px solid var(--aq-border-light)', fontSize: 12.5,
              }}>
                <span style={{ minWidth: 0 }}>
                  <strong style={{ fontWeight: 600 }}>
                    {a.user_name ?? (a.user_id ? 'Someone' : 'The system')}
                  </strong>
                  {' '}<span style={{ color: 'var(--aq-text-secondary)' }}>{logVerb(a.action)}</span>
                  {a.entity_name && (
                    <>
                      {' '}
                      <span style={{
                        textDecoration: a.task_exists ? undefined : 'line-through',
                        color: a.task_exists ? 'var(--aq-text)' : 'var(--aq-text-muted)',
                      }}>{a.entity_name}</span>
                    </>
                  )}
                  {a.entity_kind === 'booking' && (
                    <span style={{ color: 'var(--aq-text-muted)' }}> (a booking)</span>
                  )}
                  {typeof a.details?.bookings === 'number' && a.details.bookings > 0 && (
                    <span style={{ color: 'var(--aq-text-muted)' }}>
                      {' · '}{a.details.bookings} {a.details.bookings === 1 ? 'booking' : 'bookings'} went with it
                    </span>
                  )}
                </span>
                <span style={{
                  color: 'var(--aq-text-muted)', whiteSpace: 'nowrap',
                  fontVariantNumeric: 'tabular-nums',
                }}>
                  {new Date(a.created_at).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Fixed in the code ────────────────────────────────────── */}
      <section className="aq-card" style={{ padding: 18 }}>
        <header style={{ marginBottom: 10 }}>
          <h3 style={{ fontSize: 15, fontWeight: 700 }}>Set in the code</h3>
          <p style={{ fontSize: 12.5, color: 'var(--aq-text-muted)', marginTop: 3, maxWidth: '70ch' }}>
            These are not typed here — they are values the app is built with, and
            changing one is a deploy. They are on this screen so that nobody has
            to guess what the app is doing.
          </p>
        </header>
        <dl style={{ display: 'flex', flexDirection: 'column', gap: 0, margin: 0 }}>
          {fixed.map((f) => (
            <div key={f.label} style={{
              display: 'grid', gridTemplateColumns: 'minmax(150px, 190px) minmax(90px, auto) 1fr',
              gap: 14, padding: '11px 0', borderTop: '1px solid var(--aq-border-light)',
              alignItems: 'baseline',
            }}>
              <dt style={{ fontSize: 12.5, fontWeight: 600 }}>{f.label}</dt>
              <dd style={{ margin: 0, fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                {f.value}
              </dd>
              <dd style={{ margin: 0, fontSize: 12, color: 'var(--aq-text-muted)', lineHeight: 1.5 }}>
                {f.effect}
                <span style={{ display: 'block', marginTop: 2, opacity: 0.8 }}>{f.where}</span>
              </dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}

function mapCounts(counts: Record<string, number>): Record<string, { campaigns: number }> {
  const out: Record<string, { campaigns: number }> = {};
  for (const [id, n] of Object.entries(counts ?? {})) out[id] = { campaigns: n };
  return out;
}

/* ── One vocabulary ─────────────────────────────────────────────── */

function LookupCard({
  kind, items, usage, canEdit, onCreate, onUpdate, onDelete, refetch, onError,
}: {
  kind: LookupKind;
  items: { id: string; name: string; position: number }[];
  usage: Record<string, { campaigns?: number; clients?: number }>;
  canEdit: boolean;
  onCreate: (name: string, position: number) => Promise<unknown>;
  onUpdate: (id: string, fields: { name?: string; position?: number }) => Promise<unknown>;
  onDelete: (id: string) => Promise<unknown>;
  refetch: () => Promise<void>;
  onError: (msg: string) => void;
}) {
  const copy = LOOKUP_COPY[kind];
  const rows = useMemo(() => buildLookup(items as any, usage as any), [items, usage]);

  const [adding, setAdding] = useState('');
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const deleting = rows.find((r) => r.id === deletingId) ?? null;
  const editing = rows.find((r) => r.id === editingId) ?? null;

  const add = async () => {
    const found = nameProblems(adding, rows);
    setProblems(found);
    if (found.length) return;
    setBusy(true); onError('');
    try {
      await onCreate(adding.trim(), nextPosition(rows));
      setAdding('');
      await refetch();
    } catch (e: any) {
      onError(e?.message ?? String(e));
    } finally { setBusy(false); }
  };

  const saveName = async () => {
    if (!editing) return;
    const found = nameProblems(draft, rows, editing.id);
    setProblems(found);
    if (found.length) return;
    if (draft.trim() === editing.name) { setEditingId(null); return; }
    setBusy(true); onError('');
    try {
      await onUpdate(editing.id, { name: draft.trim() });
      setEditingId(null);
      await refetch();
    } catch (e: any) {
      onError(e?.message ?? String(e));
    } finally { setBusy(false); }
  };

  const move = async (id: string, dir: -1 | 1) => {
    const swap = moveSwap(rows, id, dir);
    if (!swap) return;
    setBusy(true); onError('');
    try {
      await onUpdate(swap.a.id, { position: swap.a.position });
      try {
        await onUpdate(swap.b.id, { position: swap.b.position });
      } catch (e) {
        // Put the first one back rather than leaving two rows on one number,
        // which is how the arrows stop working.
        const before = rows.find((r) => r.id === swap.a.id);
        if (before) await onUpdate(swap.a.id, { position: before.position });
        throw e;
      }
      await refetch();
    } catch (e: any) {
      onError(e?.message ?? String(e));
    } finally { setBusy(false); }
  };

  const remove = async () => {
    if (!deleting) return;
    setBusy(true); onError('');
    try {
      await onDelete(deleting.id);
      setDeletingId(null);
      await refetch();
    } catch (e: any) {
      onError(e?.message ?? String(e));
    } finally { setBusy(false); }
  };

  return (
    <section className="aq-card" style={{ padding: 18 }}>
      <header style={{ marginBottom: 12, display: 'flex', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <h3 style={{ fontSize: 15, fontWeight: 700 }}>{copy.title}</h3>
        <span style={{ fontSize: 12, color: 'var(--aq-text-muted)' }}>{lookupSummary(rows, kind)}</span>
        <p style={{
          flexBasis: '100%', fontSize: 12.5, color: 'var(--aq-text-muted)',
          marginTop: 2, maxWidth: '70ch',
        }}>{copy.blurb}</p>
      </header>

      {problems.length > 0 && (
        <div role="alert" style={{
          background: 'var(--aq-amber-bg)', border: '1px solid var(--aq-amber-border)', color: 'var(--aq-amber-deep)',
          padding: '9px 12px', borderRadius: 'var(--aq-radius)', fontSize: 12.5, marginBottom: 10,
        }}>{problems[0]}</div>
      )}

      {canEdit && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          <input
            className="aq-input"
            style={{ flex: '1 1 220px', width: 'auto', minWidth: 180 }}
            value={adding}
            onChange={(e) => { setAdding(e.target.value); setProblems([]); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
            placeholder={copy.addLabel}
            aria-label={copy.addLabel}
            disabled={busy}
          />
          <button
            type="button"
            className="aq-btn"
            onClick={add}
            disabled={busy || !adding.trim()}
            style={{
              background: INK, borderColor: INK, color: '#fff',
              opacity: busy || !adding.trim() ? 0.45 : 1,
            }}
          >Add</button>
        </div>
      )}

      {rows.length === 0 ? (
        <p style={{ fontSize: 12.5, color: 'var(--aq-text-muted)' }}>
          Nothing on the list yet{canEdit ? ' — add the first one above.' : '.'}
        </p>
      ) : (
        <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4, margin: 0, padding: 0 }}>
          {rows.map((row) => (
            <li key={row.id} style={{
              border: '1px solid var(--aq-border-light)',
              borderRadius: 'var(--aq-radius)',
              padding: '8px 10px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{
                  fontSize: 11, color: 'var(--aq-text-muted)', width: 20,
                  fontVariantNumeric: 'tabular-nums',
                }}>{row.index}</span>

                {editingId === row.id ? (
                  <input
                    className="aq-input"
                    style={{ flex: 1, width: 'auto' }}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); saveName(); }
                      if (e.key === 'Escape') { setEditingId(null); setProblems([]); }
                    }}
                    aria-label={`Rename ${row.name}`}
                    autoFocus
                  />
                ) : (
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{row.name}</span>
                    <span style={{
                      display: 'block', fontSize: 11,
                      color: row.used === 0 ? 'var(--aq-text-muted)' : 'var(--aq-text-secondary)',
                      marginTop: 1,
                    }}>{row.used === 0 ? 'on nothing' : `on ${row.usedLine}`}</span>
                  </span>
                )}

                {canEdit && editingId === row.id && (
                  <>
                    <button
                      type="button" className="aq-btn aq-btn-secondary"
                      style={{ padding: '4px 10px', fontSize: 12 }}
                      onClick={saveName} disabled={busy}
                    >Save</button>
                    <button
                      type="button" className="aq-btn aq-btn-ghost"
                      style={{ padding: '4px 10px', fontSize: 12 }}
                      onClick={() => { setEditingId(null); setProblems([]); }} disabled={busy}
                    >Cancel</button>
                  </>
                )}

                {canEdit && editingId !== row.id && (
                  <>
                    <button
                      type="button" className="aq-btn aq-btn-ghost"
                      style={{ padding: '2px 8px', fontSize: 12 }}
                      onClick={() => move(row.id, -1)}
                      disabled={busy || row.first}
                      title="Move up"
                      aria-label={`Move ${row.name} up`}
                    >↑</button>
                    <button
                      type="button" className="aq-btn aq-btn-ghost"
                      style={{ padding: '2px 8px', fontSize: 12 }}
                      onClick={() => move(row.id, 1)}
                      disabled={busy || row.last}
                      title="Move down"
                      aria-label={`Move ${row.name} down`}
                    >↓</button>
                    <button
                      type="button" className="aq-btn aq-btn-ghost"
                      style={{ padding: '4px 10px', fontSize: 12, whiteSpace: 'nowrap' }}
                      onClick={() => { setEditingId(row.id); setDraft(row.name); setProblems([]); }}
                      disabled={busy || deletingId === row.id}
                    >Rename</button>
                    <button
                      type="button" className="aq-btn aq-btn-ghost"
                      style={{ padding: '4px 10px', fontSize: 12, color: 'var(--aq-red)' }}
                      onClick={() => setDeletingId(row.id)}
                      disabled={busy || deletingId === row.id}
                    >Delete</button>
                  </>
                )}
              </div>

              {editingId === row.id && (
                <p style={{ fontSize: 11.5, color: 'var(--aq-text-muted)', margin: '8px 0 0 28px' }}>
                  {renameNote(row, kind)}
                </p>
              )}

              {deletingId === row.id && (
                <div style={{ marginTop: 10 }}>
                  <Confirm
                    text={deleteWarning(row, kind)}
                    confirmLabel={`Delete “${row.name}”`}
                    busy={busy}
                    onConfirm={remove}
                    onCancel={() => setDeletingId(null)}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ── Cells ──────────────────────────────────────────────────────── */

function Th({ children }: { children?: React.ReactNode }) {
  return (
    <th style={{
      textAlign: 'left', padding: '8px 10px', fontSize: 10, fontWeight: 700,
      color: 'var(--aq-text-muted)', textTransform: 'uppercase', letterSpacing: '.07em',
      whiteSpace: 'nowrap', borderBottom: '1px solid var(--aq-border)',
    }}>{children}</th>
  );
}

function Td({ children, muted = false }: { children?: React.ReactNode; muted?: boolean }) {
  return (
    <td style={{
      padding: '9px 10px',
      color: muted ? 'var(--aq-text-muted)' : 'var(--aq-text)',
    }}>{children}</td>
  );
}

/** The verb, in the past tense somebody would say out loud. */
function logVerb(action: string): string {
  const m: Record<string, string> = {
    created: 'created',
    updated: 'updated',
    deleted: 'deleted',
    restored: 'restored',
    // Nobody did this one on the day it happened — its 30 days ran out.
    purged: 'removed for good:',
    completed: 'completed',
    assigned: 'assigned',
    unassigned: 'unassigned',
    commented: 'commented on',
    moved: 'moved',
    status_changed: 'changed the status of',
    priority_changed: 'changed the priority of',
    contract_requested: 'requested a contract for',
    contract_generated: 'got a signed contract for',
    sheet_published: 'published the tracking sheet for',
  };
  return m[action] ?? action;
}

/* ── Background jobs: run the daily checks on demand ─────────────── */

interface JobDef {
  key: string;
  label: string;
  blurb: string;
  path: string;
  /** Turn the route's JSON result into a one-line outcome. */
  summary: (r: any) => string;
}

const JOBS: JobDef[] = [
  {
    key: 'expiry',
    label: 'Check papers expiry',
    blurb: 'Notify owners/admins of CRs and licences that are expired or within 30 days.',
    path: '/api/registry/expiry-check',
    summary: (r) => `${r.notified} notice${r.notified === 1 ? '' : 's'} sent, ${r.skipped} already current.`,
  },
  {
    key: 'contracts',
    label: 'Chase stuck contracts',
    blurb: 'Notify about contract requests waiting with Legal for more than three days.',
    path: '/api/contracts/chase',
    summary: (r) => `${r.notified} chased, ${r.skipped} already flagged.`,
  },
  {
    key: 'payments',
    label: 'Check payments due',
    blurb: 'Notify finance about client money overdue or ready to invoice.',
    path: '/api/finance/payments-due',
    summary: (r) => `${r.notified} notice${r.notified === 1 ? '' : 's'} sent, ${r.skipped} already flagged.`,
  },
];

/**
 * The three daily crons, each with a Run now button. They normally fire on a
 * schedule (early-morning UTC); this is for when you want the inbox notices
 * now rather than tomorrow. Each POSTs to its route, which re-checks that the
 * caller is an owner/admin of this workspace and scans only this workspace.
 * De-duplication still applies, so a second click in the same window reports
 * everything as already flagged rather than sending twice.
 */
function BackgroundJobs({ workspaceId }: { workspaceId: string }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<Record<string, { ok: boolean; text: string }>>({});

  const run = async (job: JobDef) => {
    setBusy(job.key);
    setResult((r) => ({ ...r, [job.key]: { ok: true, text: 'Running…' } }));
    try {
      const res = await fetch(job.path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace_id: workspaceId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.error) {
        setResult((r) => ({ ...r, [job.key]: { ok: false, text: data?.error || `Failed (${res.status})` } }));
      } else {
        setResult((r) => ({ ...r, [job.key]: { ok: true, text: job.summary(data) } }));
      }
    } catch (e: any) {
      setResult((r) => ({ ...r, [job.key]: { ok: false, text: e?.message ?? String(e) } }));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="aq-card" style={{ padding: 18 }}>
      <header style={{ marginBottom: 10 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700 }}>Background jobs</h3>
        <p style={{ fontSize: 12.5, color: 'var(--aq-text-muted)', marginTop: 2 }}>
          These run automatically each morning. Run one now to send its inbox notices without waiting.
        </p>
      </header>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {JOBS.map((job) => {
          const r = result[job.key];
          return (
            <div key={job.key} style={{
              display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
              padding: '10px 0', borderTop: '1px solid var(--aq-border-light)',
            }}>
              <div style={{ flex: 1, minWidth: 220 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{job.label}</div>
                <div style={{ fontSize: 12, color: 'var(--aq-text-muted)' }}>{job.blurb}</div>
                {r && (
                  <div style={{
                    fontSize: 12, marginTop: 4, fontWeight: 600,
                    color: r.ok ? 'var(--aq-green-strong)' : 'var(--aq-red-strong)',
                  }}>{r.text}</div>
                )}
              </div>
              <button
                type="button"
                className="aq-btn aq-btn-secondary aq-btn-sm"
                disabled={busy === job.key}
                onClick={() => run(job)}
                style={{ whiteSpace: 'nowrap' }}
              >{busy === job.key ? 'Running…' : 'Run now'}</button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/**
 * The override code, and the record of every time somebody used it.
 *
 * Siraj: "every rule can be bypassed but will be documented".
 *
 * -- WHY THE CODE HAS NO "SHOW" BUTTON ------------------------------
 *
 * There is nowhere to read it from. The hash lives in a table with RLS on and
 * NO POLICIES (migration 125), so no signed-in caller can fetch it, and the
 * only function that touches it compares and never returns. Setting a new one
 * replaces the old; there is no recovering the old one, and that is the
 * correct shape for a shared secret.
 *
 * -- WHY THE REFUSALS ARE ON SCREEN ---------------------------------
 *
 * A log with only the successes in it cannot tell you somebody spent ten
 * minutes guessing. The counts and the rows both show refused attempts, and
 * the per-person list carries them in their own column, because "Omar passed
 * one rule" and "Omar passed one rule after four wrong codes" are different
 * facts about the same afternoon.
 */
function RuleOverrides({ workspaceId, canEdit }: { workspaceId: string; canEdit: boolean }) {
  const { hasCode, setCode, error: codeErr } = useOverrideCode(workspaceId);
  const { rows, loading, error: logErr, reload } = useOverrideLog(workspaceId);

  const [open, setOpen] = useState(false);
  const [code, setCodeText] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [q, setQ] = useState('');
  const [showAll, setShowAll] = useState(false);

  // ONE memo. Every number and every row below comes from this, so the
  // heading cannot disagree with what is under it.
  const view = useMemo(() => ({
    tally: overrideTally(rows),
    summary: overrideSummary(rows),
    people: byPerson(rows),
    rules: byRule(rows),
    list: sortOverrides(filterOverrides(rows, q)),
  }), [rows, q]);

  const shapeErr = code ? codeShapeError(code) : null;
  const mismatch = code && again && code !== again ? 'Those two do not match.' : null;

  return (
    <section className="aq-card" style={{ padding: 18 }}>
      <header style={{ marginBottom: 10 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700 }}>Passing a rule</h3>
        <p style={{ fontSize: 12.5, color: 'var(--aq-text-muted)', marginTop: 3, maxWidth: '70ch' }}>
          Every rule in the app can be passed with one shared code, and every
          use of it is written down here - who, why, what, and when. A rule
          nobody can pass is a rule people work around, and the way around is
          worse than the rule. What this buys is the record, not the wall.
        </p>
      </header>

      {(codeErr || logErr || msg) && (
        <div className="aq-badge aq-badge-warning" style={{ display: 'block', padding: 9, marginBottom: 10 }}>
          {msg || codeErr || logErr}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        paddingBottom: 12, borderBottom: '1px solid var(--aq-border-light)' }}>
        <span style={{ fontSize: 13 }}>
          {hasCode === null ? 'Checking…'
            : hasCode
              ? 'A code is set.'
              : 'No code has been set, so no rule can be passed at all.'}
        </span>
        {canEdit && !open && (
          <button className="aq-btn aq-btn-ghost" style={{ padding: '4px 10px' }}
            onClick={() => { setOpen(true); setMsg(''); }}>
            {hasCode ? 'Change it' : 'Set a code'}
          </button>
        )}
        {!canEdit && (
          <span style={{ fontSize: 12, color: 'var(--aq-text-muted)' }}>
            Only an owner or an admin can set it.
          </span>
        )}
      </div>

      {open && (
        <div style={{ background: 'var(--aq-bg-sunken)', borderRadius: 'var(--aq-radius)',
          padding: 12, marginTop: 12 }}>
          <p style={{ fontSize: 12.5, color: 'var(--aq-text-secondary)', marginBottom: 8 }}>
            Anyone who has this code can pass any rule, under their own name.
            It cannot be read back afterwards - not here and not anywhere - so
            if it is forgotten, set a new one.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input className="aq-input" type="password" autoComplete="new-password"
              value={code} onChange={(e) => setCodeText(e.target.value)}
              placeholder="A new code" style={{ flex: '1 1 200px', minWidth: 0 }} />
            <input className="aq-input" type="password" autoComplete="new-password"
              value={again} onChange={(e) => setAgain(e.target.value)}
              placeholder="Type it again" style={{ flex: '1 1 200px', minWidth: 0 }} />
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10 }}>
            <span style={{ flex: 1, minWidth: 0, fontSize: 11.5,
              color: shapeErr || mismatch ? 'var(--aq-error)' : 'var(--aq-text-muted)' }}>
              {shapeErr || mismatch || 'At least 6 characters. Short enough to say down a phone.'}
            </span>
            <button className="aq-btn aq-btn-ghost" disabled={busy}
              onClick={() => { setOpen(false); setCodeText(''); setAgain(''); }}>Cancel</button>
            <button className="aq-btn aq-btn-primary"
              disabled={busy || !!shapeErr || !!mismatch || !code || code !== again}
              onClick={async () => {
                setBusy(true); setMsg('');
                try {
                  await setCode(code);
                  setOpen(false); setCodeText(''); setAgain('');
                  setMsg('The code is set. Nothing shows it again.');
                } catch (e: any) { setMsg(e?.message ?? 'That did not go through.'); }
                finally { setBusy(false); }
              }}>
              {busy ? 'Saving…' : 'Save the code'}
            </button>
          </div>
        </div>
      )}

      <div style={{ marginTop: 14 }}>
        <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
          {loading ? 'Loading the log…' : view.summary}
        </p>

        {!loading && (view.tally.passed + view.tally.refused) > 0 && (
          <>
            {/* Group before you cap. Who, and which rules - two short lists
                that answer the question the rows are only evidence for. */}
            <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', marginBottom: 12 }}>
              <div style={{ minWidth: 220 }}>
                <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--aq-text-muted)', marginBottom: 4 }}>
                  Counted per person
                </p>
                <ul style={{ listStyle: 'none', fontSize: 12.5 }}>
                  {view.people.slice(0, 10).map((p) => (
                    <li key={p.actor} style={{ padding: '2px 0' }}>
                      <b>{p.passed}</b> {p.passed === 1 ? 'rule' : 'rules'} passed
                      {' · '}{p.name}
                      {p.refused > 0 && (
                        <span style={{ color: 'var(--aq-text-muted)' }}>
                          {' · '}{p.refused} wrong {p.refused === 1 ? 'code' : 'codes'}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
              <div style={{ minWidth: 220 }}>
                <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--aq-text-muted)', marginBottom: 4 }}>
                  Which rules
                </p>
                <ul style={{ listStyle: 'none', fontSize: 12.5 }}>
                  {view.rules.slice(0, 10).map((r) => (
                    <li key={r.key} style={{ padding: '2px 0' }}>
                      <b>{r.passed}</b>{' · '}{r.label}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
              <input className="aq-input" value={q} onChange={(e) => setQ(e.target.value)}
                placeholder="Search by person, reason, rule or what it was"
                style={{ flex: '1 1 auto', minWidth: 0 }} />
              <button className="aq-btn aq-btn-ghost" style={{ padding: '4px 10px' }}
                onClick={() => { void reload(); }}>Refresh</button>
            </div>

            <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column' }}>
              {view.list.slice(0, showAll ? 200 : 15).map((r, i) => (
                <li key={r.id} style={{ padding: '7px 2px',
                  borderTop: i === 0 ? 'none' : '1px solid var(--aq-border-light)' }}>
                  <span style={{ fontSize: 12.5, display: 'block' }}>
                    <span className={`aq-badge ${r.passed ? 'aq-badge-warning' : 'aq-badge-error'}`}
                      style={{ marginRight: 6 }}>
                      {r.passed ? 'Passed' : 'Wrong code'}
                    </span>
                    <b>{ruleLabel(r.rule_key)}</b>
                    {r.entity_name ? <span dir="auto">{' · '}{r.entity_name}</span> : null}
                  </span>
                  <span dir="auto" style={{ fontSize: 12, color: 'var(--aq-text-muted)' }}>
                    {actorLabel(r)}
                    {r.created_at ? `, ${new Date(r.created_at).toLocaleString()}` : ''}
                    {' — '}{'“'}{r.reason}{'”'}
                  </span>
                </li>
              ))}
            </ul>
            {view.list.length > 15 && !showAll && (
              <button className="aq-btn aq-btn-ghost" style={{ padding: '4px 0', fontSize: 12.5 }}
                onClick={() => setShowAll(true)}>
                Show more ({view.list.length} in all)
              </button>
            )}
            {showAll && view.list.length > 200 && (
              <p style={{ fontSize: 12.5, color: 'var(--aq-text-muted)', marginTop: 8 }}>
                Showing 200 of {view.list.length}. Search to narrow it.
              </p>
            )}
          </>
        )}

        {/* The rules that exist, so somebody can see what the code opens
            before they hand it to anybody. */}
        <p style={{ fontSize: 12, color: 'var(--aq-text-muted)', marginTop: 14 }}>
          {RULES.length === 1 ? 'The rule it opens: ' : `The ${RULES.length} rules it opens: `}
          {RULES.map((r) => r.label).join('; ')}.
        </p>
      </div>
    </section>
  );
}
