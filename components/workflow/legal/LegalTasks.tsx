'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  useContractBatches, useBatchContracts, useClientBrands,
  useLegalPlaceholders, useManagedLists, useDeletedBatches,
} from '@/hooks/use-legal';
import { useClients, useLegacyVendors } from '@/hooks/use-workflow';
import { SearchablePicker } from '@/components/workflow/SearchablePicker';
import { ContractFill, MultiChoice } from '@/components/workflow/legal/ContractFill';
import {
  batchProgress, contractStatusLabel, contractStatusBadge, sortListValues, taskReference,
  recoveryLabel, recoveryUrgent, cappedList, LIST_SHOW_MAX,
} from '@/lib/legal';
import {
  startPending, cancelPending, tickPending, flushPending, removedLabel, pendingIds,
  type Pending,
} from '@/lib/pending-removal';
import { UndoBar } from '@/components/workflow/campaign/ui';
import {
  moneyText, datedValues, arabicWeekday, parsePlatforms,
  UGC_DATE_KEY, UGC_DAY_KEY, UGC_BRAND_KEY, UGC_PLATFORM_KEY, UGC_AD_TYPE_KEY,
} from '@/lib/legal-prefill';
import { AqDrawingBlock } from '@/components/AQLoading';

/**
 * Tasks: the standalone way to raise contracts that have no campaign behind
 * them. Siraj: "the screen your building is in case legal needs to do a
 * contract thats not connected to a project."
 *
 * The shape is the contract app's bulk flow (createSubtasksBulk, app.js:1974):
 * name the task, set the terms everyone shares - brand, date, duration, price,
 * ad type, platform - say how many vendors, and it creates one DRAFT CONTRACT
 * PER VENDOR carrying those terms. A vendor contract is one per vendor (109),
 * so ninety-nine influencers are ninety-nine contracts, not a table.
 *
 * The vendors are left blank on purpose. A job is agreed before anybody knows
 * which influencers will take it: "I want to add 20 vendors at the same time
 * and then edit later to add the vendor name and data." The rows exist first
 * and fill in as the names come back.
 *
 * The list of contracts is deliberately plain - Siraj: "dont make vendors too
 * distracting i only want to click on them then be able to work on their
 * data". One line each, click to open the fill screen.
 */
export function LegalTasks({ workspaceId }: { workspaceId?: string }) {
  const ws = workspaceId ?? null;
  const { batches, loading, error, busy, create, addMore, remove, reload } = useContractBatches(ws);
  const [openBatch, setOpenBatch] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  /* -- Deleting, with a way back ------------------------------------
   *
   * The `x` on a task row used to delete immediately, with no confirmation of
   * any kind - one stray click and the task was gone. The rest of the app
   * answers this with an undo window rather than a dialog (see
   * lib/pending-removal for why), so this does too.
   *
   * ONE interval for the whole list, not one per row: the arithmetic lives in
   * lib/pending-removal where it is tested, and there are no timer handles to
   * leak. Anything still counting when the screen closes is committed, because
   * the user asked for it and only undo takes that back. */
  const [pending, setPending] = useState<Pending[]>([]);
  const commit = useRef<(id: string) => void>(() => {});
  commit.current = (id: string) => { void remove(id); };

  useEffect(() => {
    if (!pending.length) return undefined;
    const t = setInterval(() => {
      setPending((list) => {
        const { next, due } = tickPending(list);
        for (const id of due) commit.current(id);
        return next;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [pending.length]);

  // Leaving the screen is not undoing. Committed on the way out, once.
  const onUnmount = useRef<() => void>(() => {});
  onUnmount.current = () => {
    const { due } = flushPending(pending);
    for (const id of due) commit.current(id);
  };
  useEffect(() => () => { onUnmount.current(); }, []);

  const hidden = pendingIds(pending);
  // Capped, like every other list screen in here. This one drew every batch
  // in the workspace, which is fine with twenty and is the shape of every
  // performance bug this project has had.
  const live = batches.filter((b) => !hidden.has(b.id));
  const { shown, hidden: over } = cappedList(live, LIST_SHOW_MAX);

  /* -- The bin (migration 120) ---------------------------------------
   *
   * A deleted task comes back for thirty days. Loaded only when the drawer
   * is opened: the bin is looked at rarely, and fetching it on every visit
   * to Tasks would spend a round trip on something nobody asked for. */
  const bin = useDeletedBatches(ws);
  const [binOpen, setBinOpen] = useState(false);
  useEffect(() => { if (binOpen) void bin.reload(); }, [binOpen]);  // eslint-disable-line react-hooks/exhaustive-deps

  if (openBatch) {
    const b = batches.find((x) => x.id === openBatch) ?? null;
    return (
      <TaskDetail workspaceId={ws} batchId={openBatch} title={b?.title ?? 'Task'}
        shared={b?.shared ?? {}} busy={busy}
        onAddMore={(n) => addMore(openBatch, n)}
        onBack={() => setOpenBatch(null)} />
    );
  }

  return (
    <div className="aq-view" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ flex: 1, fontSize: 13, color: 'var(--aq-text-secondary)' }}>
          A task is one set of terms and one contract per vendor. Use it when there is no
          campaign behind the work.
        </span>
        <button className="aq-btn aq-btn-primary" onClick={() => setFormOpen(true)}>New task</button>
      </div>

      {error && <div className="aq-badge aq-badge-error" style={{ display: 'block', padding: 10 }}>{error}</div>}

      {formOpen && (
        <NewTaskForm workspaceId={ws} busy={busy}
          onCancel={() => setFormOpen(false)}
          onCreate={async (title, count, shared) => {
            const id = await create(title, count, shared);
            setFormOpen(false);
            setOpenBatch(id);
          }} />
      )}

      {loading ? (
        <div className="aq-card" style={{ padding: 8 }}><AqDrawingBlock label={'Loading tasks\u2026'} /></div>
      ) : (shown.length === 0 && pending.length === 0) ? (
        <div className="aq-card" style={{ padding: 24, textAlign: 'center' }}>
          <p style={{ color: 'var(--aq-text-secondary)', fontSize: 14 }}>No tasks yet.</p>
          <p style={{ color: 'var(--aq-text-muted)', fontSize: 12.5, marginTop: 6 }}>
            A contract raised from a campaign does not need one - this is for work that has no campaign.
          </p>
        </div>
      ) : (
        <section className="aq-card" style={{ padding: 18 }}>
          {pending.map((p) => (
            <div key={p.id} style={{ marginBottom: 10 }}>
              <UndoBar label={removedLabel(p.title, 'task')} seconds={p.left}
                onUndo={() => setPending((l) => cancelPending(l, p.id))}
                onNow={() => {
                  setPending((l) => cancelPending(l, p.id));
                  commit.current(p.id);
                }} />
            </div>
          ))}
          <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column' }}>
            {shown.map((b, i) => (
              <li key={b.id} style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '10px 4px',
                borderTop: i === 0 ? 'none' : '1px solid var(--aq-border-light)',
              }}>
                <span role="button" tabIndex={0} onClick={() => setOpenBatch(b.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenBatch(b.id); } }}
                  style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}>
                  <span dir="auto" style={{ fontSize: 14, fontWeight: 600, display: 'block' }}>{b.title}</span>
                  <span style={{ fontSize: 12, color: 'var(--aq-text-muted)' }}>
                    {/* Siraj: "the task should have an id". A batch has no
                        number of its own, so this is the same eight uppercase
                        characters the printed contract carries - an id quoted
                        off a task and one quoted off a contract look like the
                        same kind of thing. */}
                    <code style={{ direction: 'ltr', fontSize: 11.5 }}>{taskReference(b)}</code>
                    {' \u00b7 '}
                    {batchProgress(b)}
                    {b.shared[UGC_BRAND_KEY] ? <> {'\u00b7'} <span dir="auto">{b.shared[UGC_BRAND_KEY]}</span></> : null}
                  </span>
                </span>
                {b.unassigned > 0 && <span className="aq-badge aq-badge-warning">{b.unassigned} to fill</span>}
                <button className="aq-btn aq-btn-ghost" style={{ padding: '4px 8px' }} disabled={busy}
                  title="Delete the task. The contracts stay in the Register."
                  onClick={() => { setPending((l) => startPending(l, b.id, b.title)); }}>&times;</button>
                <span role="button" tabIndex={0} onClick={() => setOpenBatch(b.id)}
                  style={{ fontSize: 14, color: 'var(--aq-text-muted)', cursor: 'pointer' }}>&rsaquo;</span>
              </li>
            ))}
          </ul>
          {over > 0 && (
            <p style={{
              fontSize: 12.5, color: 'var(--aq-text-muted)', marginTop: 12, paddingTop: 12,
              borderTop: '1px solid var(--aq-border-light)',
            }}>
              Showing the first {LIST_SHOW_MAX} of {live.length}. The newest are first.
            </p>
          )}
        </section>
      )}

      {/* The bin. A link rather than a section, because an empty recycle bin
          taking up a card is a screen telling you about itself. */}
      <div>
        <button className="aq-btn aq-btn-ghost" style={{ padding: '4px 8px', fontSize: 12.5 }}
          onClick={() => setBinOpen((v) => !v)}>
          {binOpen ? 'Hide recently deleted' : 'Recently deleted'}
        </button>
        {binOpen && (
          <section className="aq-card" style={{ padding: 16, marginTop: 8 }}>
            <p style={{ fontSize: 12.5, color: 'var(--aq-text-muted)', marginBottom: 10 }}>
              A deleted task is kept for 30 days, then removed for good. Its contracts
              stay in the Register either way.
            </p>
            {bin.error && (
              <div className="aq-badge aq-badge-error" style={{ display: 'block', padding: 9, marginBottom: 10 }}>
                {bin.error}
              </div>
            )}
            {bin.loading ? (
              <AqDrawingBlock label={'Loading\u2026'} />
            ) : bin.rows.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--aq-text-secondary)' }}>Nothing deleted recently.</p>
            ) : (
              <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column' }}>
                {cappedList(bin.rows, LIST_SHOW_MAX).shown.map((d, i) => (
                  <li key={d.id} style={{
                    display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '9px 2px',
                    borderTop: i === 0 ? 'none' : '1px solid var(--aq-border-light)',
                  }}>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span dir="auto" style={{ fontSize: 13.5, fontWeight: 600, display: 'block' }}>
                        {d.title}
                      </span>
                      <span style={{ fontSize: 12, color: 'var(--aq-text-muted)' }}>
                        <code style={{ direction: 'ltr', fontSize: 11.5 }}>{taskReference(d)}</code>
                        {' \u00b7 '}
                        {d.contracts} contract{d.contracts === 1 ? '' : 's'}
                        {d.deleted_by_name ? <> {'\u00b7'} deleted by <span dir="auto">{d.deleted_by_name}</span></> : null}
                      </span>
                    </span>
                    {/* tabular-nums so a countdown does not jitter as it ticks. */}
                    <span style={{
                      fontSize: 12, fontVariantNumeric: 'tabular-nums',
                      color: recoveryUrgent(d.days_left) ? 'var(--aq-red)' : 'var(--aq-text-muted)',
                    }}>{recoveryLabel(d.days_left)}</span>
                    <button className="aq-btn aq-btn-secondary" style={{ padding: '4px 10px', fontSize: 12.5 }}
                      onClick={async () => { await bin.restore(d.id); await reload(); }}>
                      Bring it back
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

/** The terms every contract in the task starts with, asked once. */
function NewTaskForm({
  workspaceId, busy, onCancel, onCreate,
}: {
  workspaceId: string | null;
  busy: boolean;
  onCancel: () => void;
  onCreate: (title: string, count: number, shared: Record<string, string>) => Promise<void>;
}) {
  const reg = useLegalPlaceholders(workspaceId);
  const lists = useManagedLists(workspaceId);
  const { clients } = useClients();
  const [clientId, setClientId] = useState<string | null>(null);
  const brands = useClientBrands(clientId);

  const riyadhToday = useMemo(
    () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' }),
    [],
  );

  const [title, setTitle] = useState('');
  const [count, setCount] = useState('10');
  const [brand, setBrand] = useState('');
  const [date, setDate] = useState(riyadhToday);
  const [duration, setDuration] = useState('');
  const [price, setPrice] = useState('');
  const [adType, setAdType] = useState('');
  const [platform, setPlatform] = useState('');
  const [err, setErr] = useState('');

  const optionsFor = (key: string) => {
    const f = reg.placeholders.find((p) => p.key === key);
    if (!f?.list_id) return [];
    return sortListValues((lists.valuesByList[f.list_id] ?? []).filter((v) => v.active));
  };
  const adOptions = optionsFor(UGC_AD_TYPE_KEY);
  const platformOptions = optionsFor(UGC_PLATFORM_KEY);
  // `platform` holds them comma-joined, as one contract_field value does.
  const chosenPlatforms = parsePlatforms(platform);
  const chosenAdTypes = parsePlatforms(adType);

  const n = Number(count);
  const submit = async () => {
    setErr('');
    if (!title.trim()) { setErr('Give the task a name.'); return; }
    if (!Number.isFinite(n) || n < 1 || n > 200) { setErr('How many vendors? Between 1 and 200.'); return; }
    const money = moneyText(price);
    // The date and the weekday are set together, always - the contract's
    // opening sentence names both.
    const dated = datedValues({}, date);
    const shared: Record<string, string> = {
      [UGC_BRAND_KEY]: brand.trim(),
      [UGC_DATE_KEY]: dated[UGC_DATE_KEY] ?? '',
      [UGC_DAY_KEY]: dated[UGC_DAY_KEY] ?? '',
      duration: duration.trim(),
      // The number alone - the contract's own sentence supplies the rest.
      Amount_full: money,
      [UGC_AD_TYPE_KEY]: adType,
      [UGC_PLATFORM_KEY]: platform,
    };
    try { await onCreate(title, Math.round(n), shared); }
    catch { /* the hook surfaces it */ }
  };

  return (
    <section className="aq-card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <h3 style={{ fontSize: 16, fontWeight: 700 }}>New task</h3>
      <div style={{ fontSize: 12.5, color: 'var(--aq-text-muted)' }}>
        Everything here is copied onto every contract the task makes. Each one can still be
        edited on its own afterwards - one influencer on a different price does not change the rest.
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <label style={{ flex: '2 1 240px' }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Task name</div>
          <input dir="auto" className="aq-input" value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Rabea tea - autumn" style={{ width: '100%' }} />
        </label>
        <label style={{ flex: '1 1 120px' }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>How many vendors</div>
          <input type="number" min={1} max={200} className="aq-input" value={count}
            onChange={(e) => setCount(e.target.value)} style={{ width: '100%' }} />
          <div style={{ fontSize: 11.5, color: 'var(--aq-text-muted)', marginTop: 3 }}>
            Rows now, names later. You can add more at any time.
          </div>
        </label>
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 220px' }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Client</div>
          <SearchablePicker
            options={(clients as any[]).map((c) => ({ value: String(c.id), label: String(c.company_name ?? '') }))}
            value={clientId}
            onChange={(v) => { setClientId(v); setBrand(''); }}
            placeholder={'Search clients\u2026'}
          />
        </div>
        <div style={{ flex: '1 1 220px' }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Brand</div>
          {clientId && brands.length ? (
            <SearchablePicker
              options={brands.map((b) => ({ value: b.brand_name, label: b.brand_name }))}
              value={brand || null}
              onChange={(v) => setBrand(v ?? '')}
              placeholder={'Search their brands\u2026'}
            />
          ) : (
            <input dir="auto" className="aq-input" value={brand} onChange={(e) => setBrand(e.target.value)}
              placeholder={clientId ? 'That client has no brands on file - type it' : 'Choose a client, or type the brand'}
              style={{ width: '100%' }} />
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <label style={{ flex: '1 1 160px' }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Date</div>
          <input type="date" className="aq-input" value={date} onChange={(e) => setDate(e.target.value)}
            style={{ width: '100%' }} />
          <div dir="auto" style={{ fontSize: 11.5, color: 'var(--aq-text-muted)', marginTop: 3 }}>
            {arabicWeekday(date) || '-'}
          </div>
        </label>
        <label style={{ flex: '1 1 140px' }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Duration (days)</div>
          <input type="number" min={1} className="aq-input" value={duration}
            onChange={(e) => setDuration(e.target.value)} style={{ width: '100%' }} />
          <div style={{ fontSize: 11.5, color: 'var(--aq-text-muted)', marginTop: 3 }}>
            Asked once, for the whole task.
          </div>
        </label>
        <label style={{ flex: '1 1 160px' }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Price per vendor</div>
          <input type="number" min={0} step="0.01" className="aq-input" value={price}
            onChange={(e) => setPrice(e.target.value)} style={{ width: '100%' }} />
          <div style={{ fontSize: 11.5, color: 'var(--aq-text-muted)', marginTop: 3 }}>
            {moneyText(price) || 'The vendor\u2019s fee, not the client price.'}
          </div>
        </label>
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: '2 1 320px' }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Platform</div>
          {/* The same control the fill screen uses, so what is ticked here and
              what is ticked on a contract cannot come to mean different things.
              Tick more than one and every contract in the task asks for a
              handle per platform. */}
          <MultiChoice value={platform} options={platformOptions} editable onChange={setPlatform} />
          <div style={{ fontSize: 11.5, color: 'var(--aq-text-muted)', marginTop: 4 }}>
            {chosenPlatforms.length > 1
              ? `${chosenPlatforms.length} platforms - each contract will ask for ${chosenPlatforms.length} handles.`
              : 'Tick more than one if the same ad runs on several.'}
          </div>
        </div>
        <div style={{ flex: '2 1 320px' }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Ad type</div>
          {/* Tick as many as the job is. One vendor doing a reel and three
              stories is one contract naming both. */}
          <MultiChoice value={adType} options={adOptions} editable onChange={setAdType} />
          <div style={{ fontSize: 11.5, color: 'var(--aq-text-muted)', marginTop: 4 }}>
            {chosenAdTypes.length > 1
              ? `${chosenAdTypes.length} ad types on every contract in this task.`
              : 'Tick more than one if the vendor is doing several.'}
          </div>
        </div>
      </div>

      {err && <div className="aq-badge aq-badge-error" style={{ display: 'block', padding: 10 }}>{err}</div>}

      <div style={{ display: 'flex', gap: 8 }}>
        <button className="aq-btn aq-btn-primary" disabled={busy} onClick={() => { void submit(); }}>
          {busy ? 'Creating\u2026' : `Create ${Number.isFinite(n) && n > 0 ? Math.round(n) : ''} contract${n === 1 ? '' : 's'}`}
        </button>
        <button className="aq-btn aq-btn-ghost" disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </section>
  );
}

/** One task: its contracts, one line each, click to fill one in. */
function TaskDetail({
  workspaceId, batchId, title, shared, busy, onAddMore, onBack,
}: {
  workspaceId: string | null;
  batchId: string;
  title: string;
  shared: Record<string, string>;
  busy: boolean;
  onAddMore: (n: number) => Promise<void>;
  onBack: () => void;
}) {
  const { rows, loading, error, reload } = useBatchContracts(workspaceId, batchId);
  const { vendors } = useLegacyVendors();
  const [openContract, setOpenContract] = useState<string | null>(null);
  const [more, setMore] = useState('5');

  const vendorName = useMemo(() => {
    const m = new Map<string, string>();
    for (const v of (vendors as any[])) m.set(String(v.id), String(v.name ?? ''));
    return m;
  }, [vendors]);

  if (openContract) {
    return (
      <ContractFill workspaceId={workspaceId ?? undefined} contractId={openContract}
        onBack={() => { setOpenContract(null); void reload(); }} />
    );
  }

  const n = Number(more);

  return (
    <div className="aq-view" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button className="aq-btn aq-btn-ghost" onClick={onBack}>&larr; Tasks</button>
        <span dir="auto" style={{ flex: 1, minWidth: 0, fontSize: 16, fontWeight: 700 }}>{title}</span>
      </div>

      <section className="aq-card" style={{ padding: 14, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <Term label="Brand" value={shared[UGC_BRAND_KEY]} />
        <Term label="Date" value={shared[UGC_DATE_KEY]} />
        <Term label="Duration" value={shared.duration ? `${shared.duration} days` : ''} />
        <Term label="Price" value={shared.Amount_full} />
        <Term label="Platform" value={shared[UGC_PLATFORM_KEY]} />
        <Term label="Ad type" value={shared[UGC_AD_TYPE_KEY]} />
      </section>

      {error && <div className="aq-badge aq-badge-error" style={{ display: 'block', padding: 10 }}>{error}</div>}

      {loading ? (
        <div className="aq-card" style={{ padding: 8 }}><AqDrawingBlock label={'Loading contracts\u2026'} /></div>
      ) : (
        <section className="aq-card" style={{ padding: 18 }}>
          <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column' }}>
            {cappedList(rows, LIST_SHOW_MAX).shown.map((c, i) => {
              const who = c.vendor_id != null ? (vendorName.get(String(c.vendor_id)) || `Vendor ${c.vendor_id}`) : '';
              return (
                <li key={c.id} style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '8px 4px',
                  borderTop: i === 0 ? 'none' : '1px solid var(--aq-border-light)',
                }}>
                  <span role="button" tabIndex={0} onClick={() => setOpenContract(c.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenContract(c.id); } }}
                    style={{ flex: 1, minWidth: 0, cursor: 'pointer', display: 'flex',
                      alignItems: 'baseline', gap: 8 }}>
                    <span style={{ fontSize: 12, color: 'var(--aq-text-muted)', minWidth: 28 }}>{i + 1}</span>
                    {who ? (
                      <span dir="auto" style={{ fontSize: 14, fontWeight: 600 }}>{who}</span>
                    ) : (
                      <span style={{ fontSize: 13.5, color: 'var(--aq-text-muted)', fontStyle: 'italic' }}>
                        no vendor yet
                      </span>
                    )}
                    {c.contract_no && (
                      <code style={{ fontSize: 11.5, direction: 'ltr', color: 'var(--aq-text-muted)' }}>{c.contract_no}</code>
                    )}
                  </span>
                  <span className={`aq-badge ${contractStatusBadge(c.status)}`}>{contractStatusLabel(c.status)}</span>
                  <span role="button" tabIndex={0} onClick={() => setOpenContract(c.id)}
                    style={{ fontSize: 14, color: 'var(--aq-text-muted)', cursor: 'pointer' }}>&rsaquo;</span>
                </li>
              );
            })}
          </ul>
          {/* "Add more vendors" takes 200 at a time and nothing caps how often
              it is repeated, so a task can hold more contracts than one page.
              This was the only list left in the feature with neither a cap nor
              a counted line - on the screen whose whole job is "which of these
              still has no vendor". */}
          {cappedList(rows, LIST_SHOW_MAX).hidden > 0 && (
            <p style={{
              fontSize: 12.5, color: 'var(--aq-text-muted)', marginTop: 12, paddingTop: 12,
              borderTop: '1px solid var(--aq-border-light)',
            }}>
              Showing the first {LIST_SHOW_MAX} of {rows.length}, oldest first.
            </p>
          )}
        </section>
      )}

      <section className="aq-card" style={{ padding: 14, display: 'flex', alignItems: 'flex-end',
        gap: 10, flexWrap: 'wrap' }}>
        <label>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Add more vendors</div>
          <input type="number" min={1} max={200} className="aq-input" value={more}
            onChange={(e) => setMore(e.target.value)} style={{ width: 120 }} />
        </label>
        <button className="aq-btn aq-btn-secondary" disabled={busy || !Number.isFinite(n) || n < 1}
          onClick={async () => { await onAddMore(Math.round(n)); await reload(); }}>
          {busy ? 'Adding\u2026' : 'Add'}
        </button>
        <span style={{ fontSize: 12, color: 'var(--aq-text-muted)' }}>
          They get the same terms as the rest of the task.
        </span>
      </section>
    </div>
  );
}

function Term({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
        color: 'var(--aq-text-muted)' }}>{label}</div>
      <div dir="auto" style={{ fontSize: 13.5 }}>
        {value || <span style={{ color: 'var(--aq-text-muted)' }}>{'\u2014'}</span>}
      </div>
    </div>
  );
}
