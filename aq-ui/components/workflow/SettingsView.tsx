'use client';

import { useMemo, useState } from 'react';
import {
  useTaskSources, useClientCategories, useTaskPlatforms, useLookupUsage,
  useVendorCategoriesLegacy,
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
  const { categories: vendorCats } = useVendorCategoriesLegacy();

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
    contractsCanDownload: false,
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
          background: '#fee2e2', border: '1px solid #fecaca', color: '#991b1b',
          padding: '10px 14px', borderRadius: 'var(--aq-radius)', fontSize: 12.5,
        }}>{error}</div>
      )}

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
            Shared by every workspace, so it is not edited here. It decides two
            things you would not guess from the Vendors screen: which identifier
            a vendor is asked for, and whether booking one puts a row on the
            campaign's tracking sheet.
          </p>
        </header>

        {trackingWarning && (
          <div role="alert" style={{
            background: '#fef3c7', border: '1px solid #fde68a', color: '#78350f',
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
          background: '#fef3c7', border: '1px solid #fde68a', color: '#78350f',
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
                      style={{ padding: '4px 10px', fontSize: 12, color: '#b91c1c' }}
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
