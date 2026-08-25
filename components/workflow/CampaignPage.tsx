'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  useTask, useTaskSubtasks, useAdLinesForSubtasks, useTrackingRows,
  useLegacyVendors, useClients, useClientBrands, useWorkspaceProfiles,
  useTaskSources, useClientCategories, useTaskPlatforms, useContractRequests,
  useTaskComments, useDocumentRequests, useServiceTypes, usePublishedTrackingRows,
  updateTaskFields, markTaskCompleted, deleteTask, displayName,
  AD_TYPES, AD_TYPE_NEEDS_DETAIL, APPROVAL_STAGES, TASK_STATUSES, labelFor,
  type WorkspaceRole,
} from '@/hooks/use-workflow';
import { SearchablePicker } from './SearchablePicker';
import { CampaignBookings } from './campaign/CampaignBookings';
import { CampaignPaperwork } from './campaign/CampaignPaperwork';
import { CampaignVendorContracts } from './campaign/CampaignVendorContracts';
import { CampaignWork } from './campaign/CampaignWork';
import { CampaignTracking } from './campaign/CampaignTracking';
import { CampaignActivity } from './campaign/CampaignActivity';
import {
  FailureBanner, SavingDot, UndoBar, MultiPick, StringList, OverridableMoney,
} from './campaign/ui';
import { useOptimisticSave } from '@/hooks/use-optimistic-save';
import { useRealtime } from '@/hooks/use-realtime';
import { failureLine, failureSummary } from '@/lib/pending-writes';
import { DateField } from './DateField';
import {
  moneyBar, postingStrip, stripTotals, bookingRows, campaignGaps, gapSummary,
  pageIndex, money, moneyRound, shortDate, longDate, initials,
  type Gap, type StripBucket, type BookingRow,
} from '@/lib/campaign-page';

/**
 * A campaign, as a page.
 *
 * The drawer it replaces was never chosen — a "view task" button landed on it
 * two years ago, and because a drawer is one narrow column, fifty-three fields
 * had no choice but to stack in the order the migrations added them. Opening a
 * vendor from inside a campaign put a slide-over on top of a slide-over.
 *
 * A page can say three things the stack could not:
 *
 *  - **The three figures the agency lives on, at the top.** Budget, what the
 *    vendors cost, and the net with its RATE beside it — the absolute goes up
 *    whenever we do more work; the rate says whether the work was worth doing.
 *    They were in row forty.
 *  - **What is missing, on the campaign it belongs to.** The same rules as the
 *    Dashboard's Needs attention, so the two cannot disagree, phrased for
 *    somebody looking at this one campaign.
 *  - **When the ads go out.** The tracking sheet answers that one row at a
 *    time; nothing answered it as a shape.
 *
 * The fields are grouped by the question they answer rather than by the
 * migration that added them, and the two figures the app works out — vendor
 * cost and net — are drawn read-only, so it is obvious which numbers a person
 * is expected to type.
 *
 * The drawer stays for subtasks and for a four-second fix from All Tasks. This
 * is where you go to work on a campaign, not where you are forced to go to
 * change one field.
 */
export function CampaignPage({
  taskId, workspaceId, role, currentUserId, backHref = '/dashboard/workflow',
}: {
  taskId: string;
  workspaceId: string;
  role: WorkspaceRole | null;
  currentUserId: string;
  backHref?: string;
}) {
  const { task, loading, refetch } = useTask(taskId);
  const { subtasks, refetch: refetchSubtasks } = useTaskSubtasks(taskId);
  const { rows: trackingRows, refetch: refetchTracking } = useTrackingRows(taskId);
  const { vendors } = useLegacyVendors();
  const { clients } = useClients();
  const { profiles } = useWorkspaceProfiles(workspaceId);
  const { items: taskSources } = useTaskSources(workspaceId);
  const { items: clientCategories } = useClientCategories(workspaceId);
  const { items: taskPlatforms } = useTaskPlatforms(workspaceId);
  const { items: requests, refetch: refetchRequests } = useContractRequests(workspaceId, taskId);
  const { comments, refetch: refetchComments } = useTaskComments(taskId);
  const { items: docRequests, refetch: refetchDocs } = useDocumentRequests(taskId);
  const { steps } = useServiceTypes(workspaceId);
  const { rows: publishedRows } = usePublishedTrackingRows(taskId);

  const { brands } = useClientBrands(task?.client_id ?? null);

  // The client row itself, not just its name — a contract request needs its
  // CR, VAT and signatory, and the readiness check reads them off this.
  const currentClient = useMemo(
    () => (clients as any[]).find((c) => String(c.id) === String(task?.client_id ?? '')) ?? null,
    [clients, task?.client_id],
  );

  const subtaskIds = useMemo(() => subtasks.map((s) => s.id), [subtasks]);
  const { bySubtask } = useAdLinesForSubtasks(subtaskIds);

  const router = useRouter();
  const [error, setError] = useState('');

  // Saves do not block the screen any more. The value lands immediately, the
  // write goes out behind it, and the page refetches once after a burst rather
  // than once per field.
  const opt = useOptimisticSave(async () => {
    await refetch();
    await refetchSubtasks();
  });

  // Everything below reads the campaign as the user believes it to be: what
  // the server last sent, plus whatever is still in flight.
  const view = task ? opt.view(task as any) : null;
  const shownSubtasks = useMemo(() => opt.viewAll(subtasks as any), [opt, subtasks]);

  /* ── Nobody should have to press refresh ───────────────────────── */
  //
  // Siraj: *"Quotation and invoice doesnt show it was asked until a refresh
  // make sure everything in the task updates for the person and others
  // without a refresh same thing for lines added."*
  //
  // 055 published only pm_tasks, so a quotation raised by somebody else, a
  // contract coming back from Legal and an ad line added by a colleague were
  // all invisible until the page was reloaded. 067 publishes the rest; these
  // subscriptions are what listen to them.
  //
  // The refetches are the hooks' own, so a change made by anyone — including
  // this person in another tab — lands the same way.
  const refetchAll = React.useCallback(() => {
    void refetch();
    void refetchSubtasks();
    void refetchDocs();
    void refetchRequests();
    void refetchTracking();
    void refetchComments();
  }, [refetch, refetchSubtasks, refetchDocs, refetchRequests, refetchTracking, refetchComments]);

  // The campaign row and everything hanging off it.
  useRealtime({ table: 'pm_tasks', filter: `id=eq.${taskId}`, onChange: refetchAll });
  useRealtime({ table: 'pm_tasks', filter: `parent_task_id=eq.${taskId}`, onChange: refetchAll });
  useRealtime({ table: 'document_requests', filter: `pm_task_id=eq.${taskId}`, onChange: refetchAll });
  useRealtime({ table: 'tracking_rows', filter: `task_id=eq.${taskId}`, onChange: refetchAll });
  useRealtime({ table: 'comments', filter: `task_id=eq.${taskId}`, onChange: refetchAll });
  // Ad lines belong to a SUBTASK, so there is no column here to filter on —
  // the subscription is workspace-wide and the refetch is cheap and debounced
  // by the hooks themselves.
  useRealtime({ table: 'vendor_ad_lines', onChange: refetchAll });
  useRealtime({ table: 'contract_requests', filter: `pm_task_id=eq.${taskId}`, onChange: refetchAll });

  // Today after mount, never during render — the server does not know what day
  // it is where you are, and a date that differs is a hydration mismatch.
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => { setToday(new Date().toISOString().slice(0, 10)); }, []);

  const canEdit = role !== 'member';
  // Same gate the drawer used: owners, admins and marketing, or the salesperson
  // who raised it. Deleting a campaign takes everything under it.
  const canDelete = !!role
    && (['owner', 'admin', 'marketing'].includes(role)
        || (role === 'sales' && (task as any)?.creator_id === currentUserId));

  const save = (field: string, value: unknown) => {
    if (!task) return;
    opt.set(task.id, field, value, {
      label: FIELD_LABELS[field] ?? field,
      was: (task as any)[field],
      rowName: task.task_name ?? task.title ?? 'this campaign',
    });
  };

  /* ── Deleting the campaign ─────────────────────────────────────── */

  const [deleting, setDeleting] = useState<number | null>(null);
  const deleteTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopDelete = () => {
    if (deleteTimer.current) { clearInterval(deleteTimer.current); deleteTimer.current = null; }
    setDeleting(null);
  };

  const commitDelete = async () => {
    stopDelete();
    if (!task) return;
    try {
      // Leave first: the row is going, and staying on its page to watch it
      // vanish is how you end up looking at "That campaign is not here."
      router.push(backHref);
      await deleteTask(task.id);
    } catch (e: any) {
      setError(`The campaign was not deleted — ${e?.message ?? String(e)}`);
    }
  };

  const startDelete = () => {
    setDeleting(5);
    deleteTimer.current = setInterval(() => {
      setDeleting((n) => {
        if (n == null) return null;
        if (n <= 1) { void commitDelete(); return null; }
        return n - 1;
      });
    }, 1000);
  };

  useEffect(() => () => { if (deleteTimer.current) clearInterval(deleteTimer.current); }, []);

  const vendorNames = useMemo(() => {
    const m = new Map<number, string>();
    for (const v of vendors as any[]) m.set(Number(v.id), String(v.name ?? ''));
    return m;
  }, [vendors]);

  const contractStatusById = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of requests as any[]) m.set(String(r.id), String(r.status ?? ''));
    return m;
  }, [requests]);

  const vendorSubtasks = useMemo(
    () => (shownSubtasks as any[]).filter(
      (s) => s.subtask_kind === 'vendor' || s.vendor_id != null),
    [shownSubtasks],
  );

  const allAdLines = useMemo(() => {
    const out: any[] = [];
    for (const [subtaskId, lines] of bySubtask) {
      for (const l of lines) out.push({ ...l, subtask_id: subtaskId });
    }
    return out;
  }, [bySubtask]);

  const bookings = useMemo(
    () => bookingRows({
      subtasks: vendorSubtasks as any,
      ads: allAdLines,
      vendorNames,
      contractStatusById,
    }),
    [vendorSubtasks, allAdLines, vendorNames, contractStatusById],
  );

  // The masthead adds up the SAME rows the Bookings card shows, rather than
  // reading price off each subtask separately. rollupCampaignMoney reads the
  // stored booking price, which for a per-line booking is only correct once
  // syncBookingPriceFromAds has run — so the top of the page and the list
  // underneath it could disagree for a round trip. Now they cannot.
  const rollup = useMemo(() => {
    let breakdown = 0;
    let net = 0;
    for (const b of bookings) {
      if (b.price != null) breakdown += b.price;
      if (b.net != null) net += b.net;
    }
    return { breakdown, net, vendorCount: bookings.length };
  }, [bookings]);
  const bar = useMemo(
    () => moneyBar({ budget: (view as any)?.budget, vendorCost: rollup.breakdown }),
    [view, rollup.breakdown],
  );

  const strip = useMemo(
    () => (today ? postingStrip(trackingRows as any, today) : []),
    [trackingRows, today],
  );
  const totals = useMemo(() => stripTotals(trackingRows as any), [trackingRows]);
  const adsWithoutDate = useMemo(
    () => (trackingRows as any[]).filter((r) => !r.posting_date).length,
    [trackingRows],
  );

  const gaps = useMemo(
    () => (today && view
      ? campaignGaps({
          budget: (view as any).budget,
          invoiceNumbers: (view as any).invoice_numbers ?? [],
          clientPaymentStatus: (view as any).client_payment_status,
          dueDate: view.due_date,
          bookings,
          adsWithoutDate,
          today,
        })
      : []),
    [view, bookings, adsWithoutDate, today],
  );

  const index = useMemo(() => pageIndex({
    bookings: bookings.length,
    contractsWaiting: (requests as any[]).filter((r) => r.status === 'pending').length,
    contractsTotal: (requests as any[]).length,
    trackingRows: trackingRows.length,
    adsPosted: totals.Posted,
    adsTotal: trackingRows.length,
    reports: (docRequests as any[]).length,
    comments: comments.length,
  }), [bookings.length, requests, trackingRows.length, totals.Posted, docRequests, comments.length]);

  if (loading || !task || !view) {
    return (
      <div style={{ padding: 40, color: 'var(--aq-text-muted)' }}>
        {loading ? 'Loading the campaign…' : 'That campaign is not here.'}
      </div>
    );
  }

  const name = view.task_name || view.title || 'Untitled campaign';
  const drawerHref = `${backHref}?task=${task.id}`;

  return (
    <div style={{ background: 'var(--aq-bg)', minHeight: '100vh' }}>
      {/* ── Breadcrumb ─────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        padding: '11px 22px', borderBottom: '1px solid var(--aq-border-light)',
        background: 'var(--aq-bg-elevated)', fontSize: 12.5, color: 'var(--aq-text-muted)',
      }}>
        <Link href={backHref} style={{ color: 'var(--aq-text-secondary)', textDecoration: 'none' }}>
          All Tasks
        </Link>
        <span style={{ opacity: .5 }}>›</span>
        <span>{view.brand_name || 'No brand'}</span>
        <span style={{ opacity: .5 }}>›</span>
        <span style={{ color: 'var(--aq-text)' }}>{name}</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <SavingDot n={opt.inFlight} />
          <Link href={drawerHref} className="aq-btn aq-btn-secondary" style={SMALL_BTN}>
            Open the old panel
          </Link>
          {canEdit && task.status !== 'done' && (
            <button
              type="button"
              className="aq-btn aq-btn-secondary"
              style={SMALL_BTN}
              onClick={() => {
                opt.set(task.id, 'status', 'done', { label: 'Status', was: task.status });
                void markTaskCompleted(task.id).then(() => refetch());
              }}
            >Mark complete</button>
          )}
          {canDelete && deleting == null && (
            <button
              type="button"
              className="aq-btn aq-btn-secondary"
              style={{ ...SMALL_BTN, color: '#b91c1c' }}
              onClick={startDelete}
            >Delete campaign</button>
          )}
        </span>
      </div>

      {/* Deleting takes the bookings, the ads, the tracking sheet and the
          comments with it, so it says so — and gives you five seconds and a
          way out rather than a dialog you learn to click through. */}
      {deleting != null && (
        <div style={{ maxWidth: 1280, margin: '12px auto 0', padding: '0 22px' }}>
          <UndoBar
            label={`Deleting ${name} — its ${subtasks.length} bookings, ads, tracking sheet and comments go too.`}
            seconds={deleting}
            onUndo={stopDelete}
            onNow={() => { void commitDelete(); }}
          />
        </div>
      )}

      {(opt.failures.length > 0 || error) && (
        <div style={{ maxWidth: 1280, margin: '12px auto 0', padding: '0 22px' }}>
          {error && (
            <div role="alert" style={{
              padding: '12px 15px', borderRadius: 10, marginBottom: 10,
              background: '#fee2e2', color: '#991b1b', fontSize: 13,
            }}>{error}</div>
          )}
          <FailureBanner
            failures={opt.failures}
            summary={failureSummary(opt.failures)}
            lines={opt.failures.map((f) => failureLine(f, name))}
            onRetry={opt.retry}
            onDiscard={opt.discard}
          />
        </div>
      )}

      {/* ── Masthead ───────────────────────────────────────────── */}
      <header style={{ background: 'var(--aq-bg-elevated)', borderBottom: '1px solid var(--aq-border-light)' }}>
        <div style={{
          maxWidth: 1280, margin: '0 auto', padding: '26px 22px 0',
          display: 'flex', gap: 28, alignItems: 'flex-start', flexWrap: 'wrap',
        }}>
          <div style={{ flex: '1 1 320px', minWidth: 0 }}>
            <h1 style={{
              fontSize: 'clamp(24px, 3.2vw, 36px)', fontWeight: 800,
              letterSpacing: '-0.03em', lineHeight: 1.06, margin: 0,
            }}>{name}</h1>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap',
              marginTop: 9, fontSize: 13.5, color: 'var(--aq-text-secondary)',
            }}>
              <StagePill stage={view.stage} />
              <span>{[view.brand_name, (view as any).client_name].filter(Boolean).join(' · ') || '—'}</span>
              <Dot />
              <span>
                due <strong style={{ color: 'var(--aq-text)' }}>
                  {today ? shortDate(task.due_date, today) : longDate(task.due_date)}
                </strong>
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 30, flexWrap: 'wrap' }}>
            <Fig k="Budget" v={moneyRound(bar.budget)} />
            <Fig k="Vendors cost" v={moneyRound(bar.vendorCost)} />
            <Fig
              k="Net"
              v={moneyRound(bar.net)}
              sub={bar.marginRate == null ? undefined : `${bar.marginRate}%`}
              lead
              bad={bar.overspent}
            />
          </div>
        </div>

        {/* The one flourish: what the agency lives on, as a shape. */}
        <div style={{ maxWidth: 1280, margin: '0 auto', padding: '20px 22px 22px' }}>
          <div
            role="img"
            aria-label={bar.sentence}
            title={bar.sentence}
            style={{
              display: 'flex', height: 34, borderRadius: 9, overflow: 'hidden',
              background: 'var(--aq-bg-sunken)',
            }}
          >
            {bar.vendorCost != null && (
              <span style={{
                flex: `0 0 ${bar.costPct}%`, display: 'flex', alignItems: 'center',
                padding: '0 12px', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap',
                overflow: 'hidden',
                background: bar.overspent ? '#b91c1c' : 'var(--aq-text)',
                color: '#fff',
              }}>{moneyRound(bar.vendorCost)} to vendors</span>
            )}
            {!bar.overspent && bar.net != null && bar.net > 0 && (
              <span style={{
                flex: 1, display: 'flex', alignItems: 'center', padding: '0 12px',
                fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden',
                background: 'var(--aq-accent-light)', color: '#14603a',
              }}>{moneyRound(bar.net)} net</span>
            )}
          </div>
          <p style={{ fontSize: 11.5, color: 'var(--aq-text-muted)', margin: '9px 0 0' }}>
            {bar.sentence}
          </p>
        </div>
      </header>

      {error && (
        <div role="alert" style={{
          maxWidth: 1280, margin: '14px auto 0', padding: '10px 14px',
          background: '#fee2e2', border: '1px solid #fecaca', color: '#991b1b',
          borderRadius: 'var(--aq-radius)', fontSize: 12.5,
        }}>{error}</div>
      )}

      {/* ── Body ───────────────────────────────────────────────── */}
      <div style={{
        maxWidth: 1280, margin: '0 auto', padding: 22,
        display: 'grid', gridTemplateColumns: 'minmax(0, 194px) minmax(0, 1fr)',
        gap: 26, alignItems: 'start',
      }}>
        <nav style={{ position: 'sticky', top: 16, display: 'flex', flexDirection: 'column', gap: 1 }}>
          {index.map((e) => (
            <a key={e.key} href={e.anchor} style={IX}>
              {e.flag && <i style={FLAG} aria-hidden />}
              <span>{e.label}</span>
              {e.count && <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--aq-text-muted)' }}>{e.count}</span>}
            </a>
          ))}
          <p style={{
            fontSize: 11, color: 'var(--aq-text-muted)', padding: '12px 11px 0',
            lineHeight: 1.5, borderTop: '1px solid var(--aq-border-light)', marginTop: 10,
          }}>
            Everything belonging to this campaign, in one page.
          </p>
        </nav>

        <main style={{ display: 'flex', flexDirection: 'column', gap: 18, minWidth: 0 }}>
          {gaps.length > 0 && (
            <Card title="Needs answering" hint={gapSummary(gaps)}>
              {gaps.map((g) => <GapRow key={g.key} gap={g} />)}
            </Card>
          )}

          <section id="fields">
            <Card title="The campaign" hint={canEdit ? 'click any value to change it' : 'read only'}>
              <Group title="Who it's for" />
              <Fields>
                <F k="Client">
                  {canEdit ? (
                    <SearchablePicker
                      options={(clients as any[]).map((c) => ({
                        value: c.id, label: c.company_name,
                        hint: c.cr_number ? `CR ${c.cr_number}` : null,
                      }))}
                      value={view.client_id}
                      onChange={(v) => save('client_id', v || null)}
                      placeholder="Search clients…"
                      emptyLabel="— No client —"
                    />
                  ) : <Val>{(view as any).client_name ?? '—'}</Val>}
                </F>
                <F k="Brand">
                  {canEdit ? (
                    <SearchablePicker
                      options={(brands as any[]).map((b) => ({ value: b.id, label: b.brand_name }))}
                      value={(view as any).brand_id}
                      onChange={(v) => save('brand_id', v || null)}
                      disabled={!view.client_id}
                      placeholder={view.client_id ? 'Search brands…' : 'Pick a client first'}
                      emptyLabel="— No brand —"
                    />
                  ) : <Val>{view.brand_name ?? '—'}</Val>}
                </F>
                <F k="Category">
                  <Pick
                    value={(view as any).client_category_id}
                    options={(clientCategories as any[]).map((c) => ({ v: c.id, l: c.name }))}
                    onChange={(v) => save('client_category_id', v)}
                    canEdit={canEdit}
                  />
                </F>
                <F k="Came from">
                  <Pick
                    value={(view as any).source_id}
                    options={(taskSources as any[]).map((s) => ({ v: s.id, l: s.name }))}
                    onChange={(v) => save('source_id', v)}
                    canEdit={canEdit}
                  />
                </F>
                <F k="Key account">
                  <Pick
                    value={(view as any).key_account_id}
                    options={(profiles as any[]).map((p) => ({ v: p.id, l: displayName(p) }))}
                    onChange={(v) => save('key_account_id', v)}
                    canEdit={canEdit}
                  />
                </F>
                <F k="Priority">
                  <Pick
                    value={task.priority}
                    options={['urgent', 'high', 'medium', 'low'].map((p) => ({ v: p, l: labelFor(p) }))}
                    onChange={(v) => save('priority', v)}
                    canEdit={canEdit}
                  />
                </F>
              </Fields>

              <Group title="What it is" />
              <Fields>
                <F k="Ad type">
                  <Pick
                    value={task.ad_type}
                    options={AD_TYPES.map((t) => ({ v: t, l: t }))}
                    onChange={(v) => save('ad_type', v)}
                    canEdit={canEdit}
                  />
                </F>
                {task.ad_type === AD_TYPE_NEEDS_DETAIL && (
                  <F k="Which services">
                    <Text
                      value={(view as any).ad_type_custom}
                      placeholder="Required for Multi Service"
                      onCommit={(v) => save('ad_type_custom', v || null)}
                      canEdit={canEdit}
                      warn={!(view as any).ad_type_custom}
                    />
                  </F>
                )}
                <F k="Platforms">
                  <MultiPick
                    values={((view as any).platforms ?? []) as string[]}
                    options={(taskPlatforms as any[]).map((p) => String(p.name ?? '')).filter(Boolean)}
                    onChange={(next) => save('platforms', next)}
                    canEdit={canEdit}
                  />
                </F>
                {/* One date could not say when a campaign runs — only when it
                    was due. Both are kept: the run is start → end, and the due
                    date stays as the deadline everything else already sorts by. */}
                <F k="Runs from">
                  {canEdit
                    ? <DateField aria-label="Runs from" value={(view as any).package_start_date}
                        onCommit={(v) => save('package_start_date', v)} />
                    : <Val>{longDate((view as any).package_start_date)}</Val>}
                </F>
                <F k="Runs to">
                  {canEdit
                    ? <DateField aria-label="Runs to" value={(view as any).package_end_date}
                        onCommit={(v) => save('package_end_date', v)} />
                    : <Val>{longDate((view as any).package_end_date)}</Val>}
                </F>
                <F k="Due">
                  {canEdit
                    ? <DateField aria-label="Due" value={view.due_date} onCommit={(v) => save('due_date', v)} />
                    : <Val>{longDate(view.due_date)}</Val>}
                </F>
                <F k="Approval">
                  <Pick
                    value={(view as any).approval_stage}
                    options={APPROVAL_STAGES.map((a) => ({ v: a, l: labelFor(a) }))}
                    onChange={(v) => save('approval_stage', v)}
                    canEdit={canEdit}
                  />
                </F>
                <F k="Status">
                  <Pick
                    value={task.status}
                    options={TASK_STATUSES.map((s) => ({ v: s, l: labelFor(s) }))}
                    onChange={(v) => save('status', v)}
                    canEdit={canEdit}
                    clearable={false}
                  />
                </F>
              </Fields>

              <Group title="Money & paperwork" />
              <Fields>
                <F k="Budget">
                  <Text
                    value={(view as any).budget != null ? String((view as any).budget) : ''}
                    placeholder="0.00"
                    onCommit={(v) => save('budget', v === '' ? null : Number(v))}
                    canEdit={canEdit}
                  />
                </F>
                <F k="Client paid">
                  <Pick
                    value={(view as any).client_payment_status}
                    options={PAYMENT_STATES}
                    onChange={(v) => save('client_payment_status', v)}
                    canEdit={canEdit}
                  />
                </F>
                <F k="Paid on">
                  {canEdit
                    ? <DateField aria-label="Paid on" value={(view as any).client_payment_date}
                        onCommit={(v) => save('client_payment_date', v)} />
                    : <Val>{longDate((view as any).client_payment_date)}</Val>}
                </F>
                <F k="Amount paid">
                  <Text
                    value={(view as any).client_payment_amount != null
                      ? String((view as any).client_payment_amount) : ''}
                    placeholder="0.00"
                    onCommit={(v) => save('client_payment_amount', v === '' ? null : Number(v))}
                    canEdit={canEdit}
                  />
                </F>
                <F k="Breakdown">
                  <Pick
                    value={(view as any).quotation_breakdown}
                    options={[
                      { v: 'With Breakdown', l: 'With breakdown' },
                      { v: 'Without Breakdown', l: 'Without breakdown' },
                    ]}
                    onChange={(v) => save('quotation_breakdown', v)}
                    canEdit={canEdit}
                  />
                </F>
                <F k="Quotation">
                  <StringList
                    values={((view as any).quotation_numbers ?? []) as string[]}
                    onChange={(next) => save('quotation_numbers', next)}
                    canEdit={canEdit}
                    placeholder="QT-2026-118, then Enter"
                  />
                </F>
                <F k="Invoice">
                  <StringList
                    values={((view as any).invoice_numbers ?? []) as string[]}
                    onChange={(next) => save('invoice_numbers', next)}
                    canEdit={canEdit}
                    placeholder="INV-2026-004, then Enter"
                  />
                </F>
                {/* Added up from the bookings, but not locked: Siraj asked for
                    it to be automatic and still editable. An override says so
                    on its face and offers the way back — a silently overruled
                    total is how the money stops adding up with nobody able to
                    see where. */}
                <F k="Vendors cost">
                  <OverridableMoney
                    computed={bar.vendorCost ?? 0}
                    override={(view as any).vendor_cost_override}
                    onCommit={(v) => save('vendor_cost_override', v)}
                    canEdit={canEdit}
                    format={money}
                  />
                </F>
                <F k="Net">
                  <Val calc>
                    {money(bar.net)}{bar.marginRate == null ? '' : ` · ${bar.marginRate}%`}
                  </Val>
                </F>
              </Fields>
            </Card>
          </section>

          <section id="ads">
            <Card
              title="When the ads go out"
              hint={`${trackingRows.length} ${trackingRows.length === 1 ? 'ad' : 'ads'} · ${totals.Posted} posted`}
            >
              {strip.length === 0 || trackingRows.length === 0 ? (
                <p style={{ fontSize: 13, color: 'var(--aq-text-muted)', margin: 0 }}>
                  No ads on the tracking sheet yet.
                </p>
              ) : (
                <>
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: `repeat(${Math.min(strip.length, 4)}, minmax(0, 1fr))`,
                    gap: 8,
                  }}>
                    {strip.map((b) => <Week key={b.key} bucket={b} />)}
                  </div>
                  <Legend totals={totals} />
                </>
              )}
            </Card>
          </section>

          <CampaignPaperwork
            task={view as any}
            client={currentClient}
            requests={requests as any}
            docRequests={docRequests as any}
            role={role}
            currentUserId={currentUserId}
            today={today ?? ''}
            opt={opt}
            onChanged={async () => { await refetch(); await refetchSubtasks(); }}
          />

          <CampaignVendorContracts
            task={task}
            subtasks={shownSubtasks as any}
            bookings={bookings}
            client={currentClient}
            role={role}
            currentUserId={currentUserId}
            today={today ?? ''}
            opt={opt}
            onChanged={async () => { await refetch(); await refetchSubtasks(); }}
          />

          <CampaignWork
            task={task}
            subtasks={shownSubtasks as any}
            role={role}
            currentUserId={currentUserId}
            workspaceId={workspaceId}
            profiles={profiles as any}
            serviceTypeSteps={steps as any}
            opt={opt}
            onChanged={async () => { await refetch(); await refetchSubtasks(); }}
          />

          <CampaignTracking
            task={view as any}
            rowCount={trackingRows.length}
            publishedCount={(publishedRows as any[]).length}
            role={role}
            brandName={view.brand_name}
            onChanged={async () => { await refetch(); await refetchTracking(); }}
          />

          <CampaignBookings
            task={task}
            subtasks={shownSubtasks as any}
            adLinesBySubtask={bySubtask}
            bookings={bookings}
            role={role}
            currentUserId={currentUserId}
            workspaceId={workspaceId}
            client={currentClient}
            taskPlatforms={taskPlatforms as any}
            profiles={profiles as any}
            opt={opt}
            onChanged={async () => { await refetch(); await refetchSubtasks(); }}
          />
          <CampaignActivity
            task={task}
            workspaceId={workspaceId}
            currentUserId={currentUserId}
            role={role}
            profiles={profiles as any}
            comments={comments as any}
            onChanged={async () => { await refetchComments(); }}
          />
        </main>
      </div>
    </div>
  );
}

/* ── Pieces ─────────────────────────────────────────────────────── */

/**
 * What the client's payment can be.
 *
 * The drawer offered three (pending / partial / paid), which could not
 * describe a refund, a credit note, an adjustment, or a campaign that was
 * never going to be invoiced at all — so those all sat as "pending" forever
 * and the Dashboard chased them.
 */
const PAYMENT_STATES = [
  { v: 'unpaid', l: 'Unpaid' },
  { v: 'partial', l: 'Partial payment' },
  { v: 'paid', l: 'Paid' },
  { v: 'no_payment', l: 'No payment due' },
  { v: 'refund', l: 'Refunded' },
  { v: 'credit', l: 'Credit note' },
  { v: 'adjustment', l: 'Adjustment' },
];

/** What each column is called when a save for it fails. */
const FIELD_LABELS: Record<string, string> = {
  budget: 'Budget',
  due_date: 'Due date',
  task_name: 'Campaign name',
  client_id: 'Client',
  brand_id: 'Brand',
  brand_name: 'Brand',
  source: 'Came from',
  client_category_id: 'Category',
  priority: 'Priority',
  ad_type: 'Ad type',
  ad_type_custom: 'Which services',
  approval_stage: 'Approval',
  status: 'Status',
  platforms: 'Platforms',
  invoice_no: 'Invoice number',
  quotation_no: 'Quotation number',
  client_payment_status: 'Client paid',
  contract_status: 'Contract status',
  contract_length: 'Contract length',
  contract_length_unit: 'Contract length',
  price: 'Price',
  net_amount: 'Net',
  vendor_id: 'Vendor',
  has_tracking: 'Tracking sheet',
  quotation_numbers: 'Quotation numbers',
  invoice_numbers: 'Invoice numbers',
  quotation_breakdown: 'Breakdown',
  vendor_cost_override: 'Vendors cost',
  client_payment_date: 'Paid on',
  client_payment_amount: 'Amount paid',
  package_start_date: 'Runs from',
  package_end_date: 'Runs to',
};

const SMALL_BTN: React.CSSProperties = { padding: '5px 11px', fontSize: 12.5, textDecoration: 'none' };

const IX: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 9, padding: '8px 11px',
  borderRadius: 9, fontSize: 13, color: 'var(--aq-text-secondary)', textDecoration: 'none',
};
const FLAG: React.CSSProperties = {
  width: 6, height: 6, borderRadius: '50%', background: '#b45309', flex: '0 0 auto',
};

function Dot() {
  return <span aria-hidden style={{ opacity: .4 }}>·</span>;
}

function Fig({ k, v, sub, lead, bad }: {
  k: string; v: string; sub?: string; lead?: boolean; bad?: boolean;
}) {
  return (
    <div>
      <div style={{
        fontSize: 10.5, fontWeight: 700, letterSpacing: '.09em',
        textTransform: 'uppercase', color: 'var(--aq-text-muted)',
      }}>{k}</div>
      <div style={{
        fontSize: 25, fontWeight: 700, letterSpacing: '-0.025em', marginTop: 2,
        lineHeight: 1.1, fontVariantNumeric: 'tabular-nums',
        color: bad ? '#b91c1c' : lead ? 'var(--aq-accent)' : undefined,
      }}>
        {v}
        {sub && (
          <small style={{ fontSize: 13, fontWeight: 600, color: 'var(--aq-text-muted)', letterSpacing: 0 }}>
            {' '}{sub}
          </small>
        )}
      </div>
    </div>
  );
}

function StagePill({ stage }: { stage: string }) {
  const s = String(stage ?? '');
  const style = s === 'completed'
    ? { bg: 'var(--aq-accent-light)', fg: '#14603a' }
    : s === 'pending_marketing'
      ? { bg: '#fef3c7', fg: '#92400e' }
      : { bg: '#dbeafe', fg: '#1e40af' };
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 999,
      background: style.bg, color: style.fg, whiteSpace: 'nowrap',
    }}>{labelFor(s)}</span>
  );
}

function Card({ title, hint, children }: {
  title: string; hint?: string; children: React.ReactNode;
}) {
  return (
    <section className="aq-card">
      <header style={{
        display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap',
        padding: '15px 18px 0',
      }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0, letterSpacing: '-0.01em' }}>{title}</h2>
        {hint && <span style={{ fontSize: 12, color: 'var(--aq-text-muted)' }}>{hint}</span>}
      </header>
      <div style={{ padding: '14px 18px 18px' }}>{children}</div>
    </section>
  );
}

function Group({ title }: { title: string }) {
  return (
    <div style={{
      fontSize: 10.5, fontWeight: 700, letterSpacing: '.09em', textTransform: 'uppercase',
      color: 'var(--aq-text-muted)', margin: '20px 0 10px',
      display: 'flex', alignItems: 'center', gap: 10,
    }}>
      {title}
      <span aria-hidden style={{ flex: 1, height: 1, background: 'var(--aq-border-light)' }} />
    </div>
  );
}

function Fields({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
      gap: '10px 26px',
    }}>{children}</div>
  );
}

/**
 * One labelled field.
 *
 * The label is passed to the control as its accessible name as well as being
 * drawn beside it — a <span> next to an <input> is a caption, not a label, and
 * a screen reader reading this page would otherwise announce eighteen unnamed
 * boxes.
 */
function F({ k, children }: { k: string; children: React.ReactNode }) {
  const named = React.isValidElement(children)
    ? React.cloneElement(children as React.ReactElement<any>, { label: k })
    : children;
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '104px minmax(0, 1fr)',
      gap: 10, alignItems: 'center',
    }}>
      <span style={{ fontSize: 11.5, color: 'var(--aq-text-muted)' }}>{k}</span>
      <span style={{ minWidth: 0 }}>{named}</span>
    </div>
  );
}

function Val({ children, calc, mono, warn, label }: {
  children: React.ReactNode; calc?: boolean; mono?: boolean; warn?: boolean; label?: string;
}) {
  return (
    <span data-field={label} data-calc={calc ? 'yes' : undefined} style={{
      display: 'flex', alignItems: 'center', minHeight: 32,
      border: `1px ${calc ? 'dashed' : 'solid'} ${warn ? '#b45309' : 'var(--aq-border)'}`,
      borderRadius: 8, padding: '6px 10px', fontSize: 13,
      background: calc ? 'var(--aq-bg-sunken)' : warn ? '#fef3c7' : 'var(--aq-bg-elevated)',
      color: calc ? 'var(--aq-text-secondary)' : warn ? '#92400e' : 'var(--aq-text)',
      fontFamily: mono ? 'ui-monospace, SFMono-Regular, Menlo, monospace' : undefined,
      fontVariantNumeric: 'tabular-nums',
    }}>{children}</span>
  );
}

function Pick({ value, options, onChange, canEdit, clearable = true, label }: {
  value: string | null | undefined;
  options: { v: string; l: string }[];
  onChange: (v: string | null) => void;
  canEdit: boolean;
  clearable?: boolean;
  label?: string;
}) {
  const current = options.find((o) => o.v === value);
  if (!canEdit) return <Val>{current?.l ?? '—'}</Val>;
  return (
    <select
      className="aq-select"
      aria-label={label}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || null)}
      style={{ width: '100%', fontSize: 13 }}
    >
      {clearable && <option value="">— None —</option>}
      {options.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
    </select>
  );
}

function Text({ value, placeholder, onCommit, canEdit, warn, label }: {
  value: string | null | undefined;
  placeholder?: string;
  onCommit: (v: string) => void;
  canEdit: boolean;
  warn?: boolean;
  label?: string;
}) {
  const [draft, setDraft] = useState(value ?? '');
  useEffect(() => { setDraft(value ?? ''); }, [value]);
  if (!canEdit) return <Val warn={warn}>{value || '—'}</Val>;
  return (
    <input
      className="aq-input"
      aria-label={label}
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { if (draft !== (value ?? '')) onCommit(draft.trim()); }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      style={{
        width: '100%', fontSize: 13,
        borderColor: warn ? '#b45309' : undefined,
        background: warn ? '#fef3c7' : undefined,
      }}
    />
  );
}

function GapRow({ gap }: { gap: Gap }) {
  const blocking = gap.weight === 'blocking';
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px',
      borderRadius: 10, marginBottom: 8, fontSize: 13,
      background: blocking ? '#fee2e2' : '#fef3c7',
      color: blocking ? '#991b1b' : '#78350f',
    }}>
      <i aria-hidden style={{
        width: 7, height: 7, borderRadius: '50%', background: 'currentColor', flex: '0 0 auto',
      }} />
      <span><strong>{gap.what}</strong> {gap.why}</span>
      <a href={gap.anchor} style={{
        marginLeft: 'auto', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap',
        border: '1px solid currentColor', borderRadius: 7, padding: '4px 11px',
        color: 'inherit', textDecoration: 'none',
      }}>{gap.action}</a>
    </div>
  );
}

const BEAD_COLOUR: Record<string, string> = {
  Posted: 'var(--aq-accent)',
  Shot: '#1e40af',
  Scheduled: '#b45309',
  'Not started': 'var(--aq-bg-sunken)',
  Cancelled: 'var(--aq-bg-sunken)',
};

function Week({ bucket }: { bucket: StripBucket }) {
  return (
    <div style={{
      border: `1px solid ${bucket.now ? 'var(--aq-text)' : 'var(--aq-border-light)'}`,
      boxShadow: bucket.now ? '0 0 0 1px var(--aq-text)' : undefined,
      borderRadius: 10, padding: '10px 11px', background: 'var(--aq-bg-elevated)',
    }}>
      <div style={{
        fontSize: 10.5, fontWeight: 700, letterSpacing: '.07em',
        textTransform: 'uppercase', color: 'var(--aq-text-muted)',
      }}>{bucket.label}</div>
      <div style={{ fontSize: 19, fontWeight: 700, letterSpacing: '-0.02em', marginTop: 1 }}>
        {bucket.count}{' '}
        <small style={{ fontSize: 12, fontWeight: 500, color: 'var(--aq-text-muted)' }}>
          {bucket.noun}
        </small>
      </div>
      <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginTop: 8 }}>
        {bucket.beads.map((b, i) => (
          <i key={i} aria-hidden style={{
            width: 12, height: 12, borderRadius: 3, background: BEAD_COLOUR[b],
          }} />
        ))}
      </div>
    </div>
  );
}

function Legend({ totals }: { totals: Record<string, number> }) {
  const items = [
    ['Posted', 'Posted'], ['Shot', 'Shot'],
    ['Scheduled', 'Scheduled'], ['Not started', 'No date'],
  ] as const;
  return (
    <div style={{
      display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 12,
      fontSize: 11.5, color: 'var(--aq-text-muted)',
    }}>
      {items.filter(([k]) => totals[k] > 0).map(([k, label]) => (
        <span key={k}>
          <i aria-hidden style={{
            display: 'inline-block', width: 9, height: 9, borderRadius: 2,
            marginRight: 6, background: BEAD_COLOUR[k],
          }} />
          <strong style={{ color: 'var(--aq-text-secondary)', fontWeight: 600 }}>{label}</strong>{' '}
          {totals[k]}
        </span>
      ))}
    </div>
  );
}

function BookingLine({ row, first, href }: { row: BookingRow; first: boolean; href: string }) {
  return (
    <a href={href} style={{
      display: 'grid', gridTemplateColumns: '30px minmax(0, 1fr) auto auto',
      gap: 12, alignItems: 'center', padding: '11px 0', textDecoration: 'none',
      color: 'inherit', borderTop: first ? 'none' : '1px solid var(--aq-border-light)',
    }}>
      <span style={{
        width: 30, height: 30, borderRadius: 9, background: 'var(--aq-bg-sunken)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 11.5, fontWeight: 700, color: 'var(--aq-text-secondary)',
      }}>{row.initials}</span>
      <span style={{ minWidth: 0 }}>
        <span style={{ fontSize: 13.5, fontWeight: 600, display: 'block' }}>{row.name}</span>
        <span style={{
          fontSize: 11.5, marginTop: 1, display: 'block',
          color: row.problem ? '#b45309' : 'var(--aq-text-muted)',
        }}>{row.meta}</span>
      </span>
      <span style={{ width: 74, height: 5, borderRadius: 3, background: 'var(--aq-bg-sunken)', overflow: 'hidden' }}>
        <i style={{ display: 'block', height: '100%', width: `${row.progressPct}%`, background: 'var(--aq-accent)' }} />
      </span>
      <span style={{
        fontSize: 13.5, fontWeight: 600, textAlign: 'right', whiteSpace: 'nowrap',
        fontVariantNumeric: 'tabular-nums',
        color: row.price == null ? '#b91c1c' : undefined,
      }}>{row.price == null ? '—' : moneyRound(row.price)}</span>
    </a>
  );
}
