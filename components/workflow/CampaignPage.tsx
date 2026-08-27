'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  useTask, useTaskSubtasks, useAdLinesForSubtasks, useTrackingRows,
  useLegacyVendors, useClients, useClientBrands, useWorkspaceProfiles,
  useTaskSources, useClientCategories, useTaskPlatforms, useContractRequests,
  useCommentsForTasks, useAttachmentsForTasks,
  useDocumentRequests, useServiceTypes, usePublishedTrackingRows,
  updateTaskFields, markTaskCompleted, deleteTask, displayName,
  AD_TYPES, AD_TYPE_NEEDS_DETAIL, APPROVAL_STAGES, TASK_STATUSES,
  CONTRACT_STATUSES, labelFor,
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
  TONE,
  Card, Group, Fields, F, Val, Pick, Text, HILITE } from './campaign/ui';
import { useOptimisticSave } from '@/hooks/use-optimistic-save';
import { useRealtime } from '@/hooks/use-realtime';
import { failureLine, failureSummary } from '@/lib/pending-writes';
import { DateField } from './DateField';
import { CampaignLoading } from './CampaignSkeleton';
import { closerKey, closerFields, closerOptions } from '@/lib/sales-closer';
import {
  moneyBar, stripTotals, bookingRows, campaignGaps, gapSummary,
  pageIndex, PAGE_SECTION_IDS, indexProgress, money, moneyRound, shortDate, longDate, initials,
  amountOrNull as pos, brandMark,
  type Gap, type BookingRow, type IndexEntry,
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
 *
 * The fields are grouped by the question they answer rather than by the
 * migration that added them, and the two figures the app works out — vendor
 * cost and net — are drawn read-only, so it is obvious which numbers a person
 * is expected to type.
 *
 * The drawer is now deleted. Everything it could do that this could not has
 * moved here — the campaign's name and brief, the closer, the client contract
 * status, a booking's assignee, due date and name, a report's priority and
 * platforms — and comments and files left against a BOOKING are shown on this
 * page with the booking named on them, rather than being stranded at an id no
 * screen fetches.
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
  // The campaign AND everything under it. Comments and files stored against
  // a booking were only ever reachable through the drawer; with the drawer
  // gone they would have become invisible rather than deleted, which is the
  // worse of the two because nothing would say so.
  const activityIds = useMemo(
    () => [taskId, ...subtasks.map((s) => s.id)],
    [taskId, subtasks],
  );
  const { comments, refetch: refetchComments } = useCommentsForTasks(activityIds);
  const { attachments, refetch: refetchFiles } = useAttachmentsForTasks(activityIds);
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
    void refetchFiles();
  }, [refetch, refetchSubtasks, refetchDocs, refetchRequests, refetchTracking,
      refetchComments, refetchFiles]);

  // The campaign row and everything hanging off it.
  useRealtime({ table: 'pm_tasks', filter: `id=eq.${taskId}`, onChange: refetchAll });
  useRealtime({ table: 'pm_tasks', filter: `parent_task_id=eq.${taskId}`, onChange: refetchAll });
  useRealtime({ table: 'document_requests', filter: `pm_task_id=eq.${taskId}`, onChange: refetchAll });
  useRealtime({ table: 'tracking_rows', filter: `task_id=eq.${taskId}`, onChange: refetchAll });
  // No filter: a comment on a BOOKING carries the booking's id, not the
  // campaign's, so filtering on task_id here would miss exactly the rows
  // this card exists to keep visible.
  useRealtime({ table: 'comments', onChange: refetchAll });
  useRealtime({ table: 'task_attachments', onChange: refetchAll });
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
  //
  // `breakdown` is the sum of what the CLIENT is charged per booking; `cost`
  // is the sum of what the VENDORS take. They are not the same number and the
  // bar used to be handed the first one under the second one's name.
  const rollup = useMemo(() => {
    let breakdown = 0;
    let cost = 0;
    let anyCost = false;
    for (const b of bookings) {
      if (b.price != null) breakdown += b.price;
      if (b.net != null) { cost += b.net; anyCost = true; }
    }
    // Null, not 0: a campaign where nobody has entered what the vendors take
    // has an unknown cost, and calling it zero prints a full margin on work
    // we have not costed.
    return { breakdown, cost: anyCost ? cost : null, vendorCount: bookings.length };
  }, [bookings]);

  // An override is a number somebody typed instead of the sum, so it stands
  // in for the sum everywhere below — the bar, the margin and the figure.
  const vendorCostOverride = pos((view as any)?.vendor_cost_override);
  const vendorCost = vendorCostOverride ?? rollup.cost;

  const bar = useMemo(
    () => moneyBar({
      budget: (view as any)?.budget,
      vendorCost,
      breakdown: rollup.breakdown,
    }),
    [view, vendorCost, rollup.breakdown],
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
    // A booking that has no price, or no contract asked for, is the reason
    // somebody opens this page. The index says so before you scroll to it.
    bookingsUnready: bookings.filter((b) => b.price == null || b.contract === 'none').length,
    // The campaign's own fields, judged by the same rules the "Needs
    // answering" card uses — so the tick and the card can never disagree.
    campaignMissing: gaps.filter((g) => g.anchor === '#fields').length,
    trackingPublished: !!(view as any)?.tracking_published_at,
    trackingStale: !!(view as any)?.tracking_published_at
      && publishedRows.length !== trackingRows.length,
    // Client contract, quotation, invoice — how many of the three are done.
    paperworkTotal: 3,
    paperworkDone:
      ((view as any)?.contract_status === 'signed_attached' ? 1 : 0)
      + (((view as any)?.quotation_numbers ?? []).length ? 1 : 0)
      + (((view as any)?.invoice_numbers ?? []).length ? 1 : 0),
  }), [bookings, requests, trackingRows.length, totals.Posted, docRequests,
       comments.length, view, gaps, publishedRows.length]);

  // Named after the vendor where there is one, so a comment says which
  // booking it was left on rather than showing a uuid.
  const subtaskNames = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of bookings) m.set(b.id, b.name);
    for (const st of subtasks) {
      if (!m.has(st.id)) m.set(st.id, (st as any).title || 'a booking');
    }
    return m;
  }, [bookings, subtasks]);

  const progress = useMemo(() => indexProgress(index), [index]);

  /* ── Where am I on the page ───────────────────────────────────── */
  //
  // The list down the left was seven pieces of static text: no hover, nothing
  // saying which section you were looking at, and — worse — two of its links
  // pointed at ids that have never existed, so clicking Reports or Comments
  // did nothing whatsoever. Siraj: *"its bland and not usable"*.
  //
  // An observer rather than a scroll handler: it fires only when a section
  // crosses the line, not on every pixel of every scroll.
  const [here, setHere] = useState<string>('fields');
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const seen = new Map<string, number>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) seen.set(e.target.id, e.intersectionRatio);
        // The section showing the most of itself wins. Picking "the first one
        // intersecting" makes the highlight jitter between two neighbours
        // whenever a short card sits above a long one.
        let best = ''; let ratio = 0;
        for (const [id, r] of seen) if (r > ratio) { best = id; ratio = r; }
        if (best) setHere(best);
      },
      // Ignores the top 12% and bottom 55%, so "here" means the band you are
      // actually reading rather than whatever is clipping the viewport edge.
      { rootMargin: '-12% 0px -55% 0px', threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    for (const id of PAGE_SECTION_IDS) {
      const el = document.getElementById(id);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
    // Sections mount as their data arrives, so this re-runs when the counts move.
  }, [index.length, bookings.length, trackingRows.length]);

  /* ── Fields that are not one column ──────────────────────────── */
  //
  // `pm_tasks` has no `client_name`. The page was reading `view.client_name`
  // in the masthead and as the read-only client value, and there is no such
  // column on the table — it exists on `contract_requests` — so both rendered
  // blank on every campaign, for every user without edit rights.
  const clientName = currentClient?.company_name ?? null;

  // Picking a client invalidates the brand: brands belong to clients, and
  // leaving brand_id pointing at the previous client's brand is how a
  // contract goes out naming somebody else's brand. The category follows the
  // client when the client carries one, and never blanks a manual choice.
  const changeClient = (v: string | null) => {
    const c = (clients as any[]).find((x) => String(x.id) === String(v ?? ''));
    opt.setMany(taskId, {
      client_id: v || null,
      legacy_client_id: c ? (c.cr_number || c.id) : null,
      brand_id: null,
      brand_name: null,
      ...(c?.client_category_id ? { client_category_id: c.client_category_id } : {}),
    }, {
      labels: {
        client_id: 'Client', legacy_client_id: 'Client',
        brand_id: 'Brand', brand_name: 'Brand', client_category_id: 'Category',
      },
      was: {
        client_id: view?.client_id,
        legacy_client_id: (view as any)?.legacy_client_id,
        brand_id: (view as any)?.brand_id,
        brand_name: (view as any)?.brand_name,
        client_category_id: (view as any)?.client_category_id,
      },
    });
  };

  // `brand_name` is a real column and nothing syncs it from `brand_id` —
  // there is no trigger; I checked every migration. The page was writing only
  // the id, and `clientContractReadiness` tests the NAME, so a brand picked
  // here left the client contract blocked with no way on this screen to
  // unblock it, while the masthead went on showing the old brand.
  const changeBrand = (v: string | null) => {
    const b = (brands as any[]).find((x) => String(x.id) === String(v ?? ''));
    opt.setMany(taskId, {
      brand_id: v || null,
      brand_name: b?.brand_name ?? null,
    }, {
      labels: { brand_id: 'Brand', brand_name: 'Brand' },
      was: { brand_id: (view as any)?.brand_id, brand_name: (view as any)?.brand_name },
    });
  };

  const goTo = (anchor: string) => {
    const el = document.getElementById(anchor.replace('#', ''));
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // Move the keyboard as well as the eye, or tabbing after a jump carries
    // on from the link rather than from where you have just landed.
    el.setAttribute('tabindex', '-1');
    el.focus({ preventScroll: true });
    setHere(el.id);
  };

  /**
   * A booking is not a campaign.
   *
   * Nothing here has ever guarded on `parent_task_id`, so handing this page a
   * subtask id drew that subtask as though it were a campaign — its title in
   * the masthead, its price as the budget, and a Bookings card listing
   * nothing. The drawer used to absorb those ids; it is gone, so the guard
   * lives here. Stale links, bookmarks and any notification that slipped
   * past the redirect land on the campaign the booking belongs to.
   */
  useEffect(() => {
    const parent = (task as any)?.parent_task_id;
    if (parent) router.replace(`/dashboard/campaign/${parent}`);
  }, [task, router]);

  // A campaign is seven fetches. Until they land, the page's own shape plus
  // the mark drawing itself — see CampaignLoading for why the overlay waits a
  // quarter of a second before it appears at all.
  if (loading || (task as any)?.parent_task_id) return <CampaignLoading />;

  if (!task || !view) {
    return (
      <div style={{ padding: 40, color: 'var(--aq-text-muted)' }}>
        That campaign is not here.
      </div>
    );
  }

  const name = view.task_name || view.title || 'Untitled campaign';
  // Keyed on the client so every campaign of theirs wears the same colour.
  const mark = brandMark(clientName ?? view.brand_name);

  return (
    <div style={{ background: 'var(--aq-bg)', minHeight: '100vh' }}>
      {/* ── Breadcrumb ─────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        padding: '11px 22px', borderBottom: '1px solid var(--aq-border-light)',
        background: 'var(--aq-bg-elevated)', fontSize: 12.5, color: 'var(--aq-text-muted)',
      }}>
        {/* A way out, drawn as one.
            The only exit used to be the word "All Tasks" set in muted grey at
            the same weight as the two crumbs after it — Siraj asked for
            something obvious, and he was right that a breadcrumb is a label
            people read rather than a control they see. */}
        <Link
          href={backHref}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 7,
            padding: '5px 12px 5px 9px', borderRadius: 8,
            border: '1px solid var(--aq-border)',
            background: 'var(--aq-bg-elevated)',
            color: 'var(--aq-text)', textDecoration: 'none',
            fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap',
          }}
        >
          <span aria-hidden style={{ fontSize: 14, lineHeight: 1, marginTop: -1 }}>←</span>
          All tasks
        </Link>
        <span>{view.brand_name || 'No brand'}</span>
        <span style={{ opacity: .5 }}>›</span>
        <span style={{ color: 'var(--aq-text)' }}>{name}</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <SavingDot n={opt.inFlight} />
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
      {/*
          Ink, not paper.

          Siraj: *"the whole task page is really bland especially that we are
          a marketing and creative agency"*. The band is the answer: one
          decisive move at the top, and everything below stays the quiet tool
          it already is. A page of stone-grey cards with a stone-grey header
          reads as a spreadsheet no matter how well the cards are made.

          The money is the headline here rather than four small labels in the
          corner, because it is the thing anybody opening a campaign is
          checking, and the swatch is the client's — the same colour on every
          campaign of theirs, so a list of them reads as belonging together.
      */}
      <header style={{ background: INK, color: '#fff' }}>
        <div style={{ maxWidth: 1280, margin: '0 auto', padding: '24px 22px 22px' }}>

          {/* Who it is for, and when it is due. Quiet, above the name. */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
            fontSize: 12.5, color: '#a8a29e', marginBottom: 12,
          }}>
            <span aria-hidden style={{
              width: 22, height: 22, borderRadius: 6, flex: '0 0 auto',
              background: `linear-gradient(135deg, ${mark.from}, ${mark.to})`,
            }} />
            <span>{[view.brand_name, clientName].filter(Boolean).join(' · ') || 'No client yet'}</span>
            <span style={{
              fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999,
              background: '#2c2825', color: '#d6d3d1', whiteSpace: 'nowrap',
            }}>{labelFor(String(view.stage ?? ''))}</span>
            <span style={{ opacity: .45 }}>·</span>
            <span>due <strong style={{ color: '#f5f5f4', fontWeight: 700 }}>
              {today ? shortDate(task.due_date, today) : longDate(task.due_date)}
            </strong></span>
          </div>

          <h1 style={{
            fontSize: 'clamp(28px, 4vw, 46px)', fontWeight: 800,
            letterSpacing: '-0.035em', lineHeight: 1.02, margin: 0,
            maxWidth: 22 + 'ch', textWrap: 'balance',
          } as React.CSSProperties}>{name}</h1>

          {/* Four numbers, each a different question: what the client agreed,
              what the bookings come to, what the vendors take, what is left.
              Breakdown sits beside Budget rather than replacing it, because
              the two disagreeing is itself worth seeing. */}
          <div style={{ display: 'flex', gap: 34, flexWrap: 'wrap', marginTop: 20 }}>
            <Fig
              k="Budget"
              v={moneyRound(bar.budget)}
              sub={bar.budgetFromBreakdown ? 'from the bookings' : undefined}
            />
            <Fig
              k="Breakdown"
              v={moneyRound(bar.breakdown)}
              sub={
                bar.breakdownVariance == null || bar.breakdownVariance === 0
                  ? undefined
                  : `${bar.breakdownVariance > 0 ? 'under' : 'over'} by ${moneyRound(Math.abs(bar.breakdownVariance))}`
              }
              bad={!!bar.breakdownVariance}
            />
            <Fig k="Vendors" v={moneyRound(bar.vendorCost)} />
            <Fig
              k={bar.marginRate == null ? 'AQ net' : `AQ net · ${bar.marginRate}%`}
              v={moneyRound(bar.net)}
              lead
              bad={bar.overspent}
            />
          </div>

          {/* The one flourish: what the agency lives on, as a shape. Thin
              here — on ink it does not need labels inside it to be read, and
              the sentence underneath says it in words anyway. */}
          <div
            role="img"
            aria-label={bar.sentence}
            title={bar.sentence}
            style={{
              display: 'flex', height: 8, borderRadius: 99, overflow: 'hidden',
              background: '#2c2825', marginTop: 20,
            }}
          >
            {bar.vendorCost != null && (
              <span style={{
                flex: `0 0 ${bar.costPct}%`,
                background: bar.overspent ? '#f87171' : '#57534e',
              }} />
            )}
            {!bar.overspent && bar.net != null && bar.net > 0 && (
              <span style={{ flex: 1, background: WIN }} />
            )}
          </div>
          <p style={{ fontSize: 11.5, color: '#a8a29e', margin: '9px 0 0' }}>
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
        <nav
          aria-label="Sections of this campaign"
          style={{ position: 'sticky', top: 16, display: 'flex', flexDirection: 'column', gap: 1 }}
        >
          <Progress done={progress.done} total={progress.total} line={progress.line} />
          {index.map((e) => (
            <IndexLink
              key={e.key}
              entry={e}
              active={here === e.anchor.replace('#', '')}
              onGo={goTo}
            />
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
            <Card
              title="Needs answering"
              hint={gapSummary(gaps)}
              bead={TONE[gaps.some((g) => g.weight === 'blocking') ? 'red' : 'amber'].edge}
            >
              {gaps.map((g) => <GapRow key={g.key} gap={g} />)}
            </Card>
          )}

          <section id="fields">
            <Card title="The campaign" hint={canEdit ? 'click any value to change it' : 'read only'}>
              <Group title="Who it's for" />
              <Fields>
                {/* The campaign's own name. The page could show it and not
                    change it, which meant a typo in a campaign title was a
                    reason to go back to the drawer. Both columns move
                    together — the app reads task_name and falls back to
                    title, and leaving the two disagreeing is how a campaign
                    is called one thing here and another on the Dashboard. */}
                <F k="Name">
                  <Text
                    canEdit={canEdit}
                    value={(view as any).task_name ?? view.title ?? ''}
                    placeholder="Campaign name"
                    onCommit={(v) => opt.setMany(taskId, {
                      task_name: v || null, title: v || null,
                    }, {
                      labels: { task_name: 'Campaign name', title: 'Campaign name' },
                      was: { task_name: (view as any).task_name, title: view.title },
                    })}
                  />
                </F>
                <F k="Client">
                  {canEdit ? (
                    <SearchablePicker
                      options={(clients as any[]).map((c) => ({
                        value: c.id, label: c.company_name,
                        hint: c.cr_number ? `CR ${c.cr_number}` : null,
                      }))}
                      value={view.client_id}
                      onChange={changeClient}
                      placeholder="Search clients…"
                      emptyLabel="— No client —"
                    />
                  ) : <Val>{clientName ?? '—'}</Val>}
                </F>
                <F k="Brand">
                  {canEdit ? (
                    <SearchablePicker
                      options={(brands as any[]).map((b) => ({ value: b.id, label: b.brand_name }))}
                      value={(view as any).brand_id}
                      onChange={changeBrand}
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
                {/* Who closed it. Three columns behind one picker, and
                    closerFields() always returns all three — writing only
                    the one that changed leaves a row with two closers and
                    the CHECK constraint rejects the save. */}
                <F k="Closed by">
                  <Pick
                    value={closerKey(view as any) || null}
                    options={closerOptions(profiles as any, vendors as any, view as any)
                      .map((o) => ({ v: o.key, l: o.label }))}
                    onChange={(v) => {
                      const f = closerFields(v ?? '');
                      opt.setMany(taskId, f as any, {
                        labels: {
                          sales_closer_id: 'Closed by',
                          sales_closer_vendor_id: 'Closed by',
                          sales_closer_influencer: 'Closed by',
                        },
                        was: {
                          sales_closer_id: (view as any).sales_closer_id,
                          sales_closer_vendor_id: (view as any).sales_closer_vendor_id,
                          sales_closer_influencer: (view as any).sales_closer_influencer,
                        },
                      });
                    }}
                    canEdit={canEdit}
                  />
                </F>
                <F k="Priority">
                  <Pick
                    value={task.priority}
                    stateful
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
                    // Moving off Multi Service takes its detail with it.
                    // Leaving a stale ad_type_custom behind means the
                    // generated contract reads "Reel" and lists three
                    // services underneath it.
                    onChange={(v) => (v === AD_TYPE_NEEDS_DETAIL
                      ? save('ad_type', v)
                      : opt.setMany(task.id, { ad_type: v, ad_type_custom: null }, {
                          labels: { ad_type: 'Ad type', ad_type_custom: 'Which services' },
                          was: { ad_type: task.ad_type, ad_type_custom: (view as any).ad_type_custom },
                        }))}
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
                    stateful
                    options={APPROVAL_STAGES.map((a) => ({ v: a, l: labelFor(a) }))}
                    onChange={(v) => save('approval_stage', v)}
                    canEdit={canEdit}
                  />
                </F>
                {/* The campaign's contract with the CLIENT. The page could
                    only read this — and the progress ring counts it — so the
                    one section the ring waits on could never be settled from
                    the page it is drawn on. */}
                <F k="Contract">
                  <Pick
                    stateful
                    value={(view as any).contract_status}
                    options={CONTRACT_STATUSES.map((c) => ({ v: c, l: labelFor(c) }))}
                    onChange={(v) => save('contract_status', v)}
                    canEdit={canEdit}
                  />
                </F>
                <F k="Status">
                  <Pick
                    stateful
                    value={task.status}
                    options={TASK_STATUSES.map((s) => ({ v: s, l: labelFor(s) }))}
                    onChange={(v) => save('status', v)}
                    canEdit={canEdit}
                    clearable={false}
                  />
                </F>
              </Fields>

              {/* The client's own words. It is the one field on a campaign
                  that is not a value but a paragraph, so it gets its own
                  full-width row rather than being squeezed into the grid. */}
              <Group title="The brief" />
              <Brief
                value={(view as any).description ?? ''}
                canEdit={canEdit}
                onCommit={(v) => save('description', v || null)}
              />

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
                    stateful
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
                {/* When AQ's own share landed. Not the same date as the
                    client's payment and not the same as the vendors' —
                    it is the one the drawer had and the page dropped. */}
                <F k="Net paid on">
                  {canEdit
                    ? <DateField aria-label="Net paid on" value={(view as any).net_payment_date}
                        onCommit={(v) => save('net_payment_date', v)} />
                    : <Val>{longDate((view as any).net_payment_date)}</Val>}
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
                  {/* `computed` is the sum of the bookings' NETS — what the
                      vendors take. Feeding it bar.vendorCost would feed the
                      override back into itself and the field could never be
                      cleared back to the sum. */}
                  <OverridableMoney
                    computed={rollup.cost ?? 0}
                    override={(view as any).vendor_cost_override}
                    onCommit={(v) => save('vendor_cost_override', v)}
                    canEdit={canEdit}
                    format={money}
                  />
                </F>
                <F k="AQ net">
                  <Val calc>
                    {money(bar.net)}{bar.marginRate == null ? '' : ` · ${bar.marginRate}%`}
                  </Val>
                </F>
              </Fields>
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
            taskPlatforms={taskPlatforms as any}
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
            attachments={attachments as any}
            refetchFiles={refetchFiles}
            subtaskNames={subtaskNames}
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
  title: 'Campaign name',
  description: 'The brief',
  net_payment_date: 'Net paid on',
  legacy_client_id: 'Client',
  sales_closer_id: 'Closed by',
  sales_closer_vendor_id: 'Closed by',
  sales_closer_influencer: 'Closed by',
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

/**
 * How far through, as a ring.
 *
 * The figure counts only the sections that have a finished state — Comments
 * and Work do not, and including them would leave a fully settled campaign
 * reading "6 of 8" forever. A progress figure that cannot reach its end is
 * one nobody looks at twice.
 */
/**
 * The client's brief, in their words.
 *
 * A textarea rather than a Text row: this is the field somebody pastes an
 * email into, and a one-line input that scrolls sideways is how a brief gets
 * skimmed instead of read. Commits on blur like every other field on the
 * page, so it joins the same write queue and the same undo.
 */
function Brief({ value, canEdit, onCommit }: {
  value: string;
  canEdit: boolean;
  onCommit: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);

  if (!canEdit) {
    return (
      <p style={{
        fontSize: 13, lineHeight: 1.6, margin: 0, whiteSpace: 'pre-wrap',
        color: value ? 'var(--aq-text)' : 'var(--aq-text-muted)',
      }}>{value || 'Nothing written yet.'}</p>
    );
  }

  return (
    <textarea
      className="aq-input"
      aria-label="The brief"
      value={draft}
      rows={4}
      placeholder="What the client asked for."
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { if (draft !== value) onCommit(draft.trim()); }}
      style={{
        width: '100%', fontSize: 13, lineHeight: 1.6, resize: 'vertical',
        minHeight: 84, padding: '9px 11px', fontFamily: 'inherit',
      }}
    />
  );
}

function Progress({ done, total, line }: { done: number; total: number; line: string }) {
  const r = 17;
  const circ = 2 * Math.PI * r;
  const pct = total === 0 ? 0 : done / total;
  const all = total > 0 && done === total;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '4px 10px 14px' }}>
      <svg width="42" height="42" viewBox="0 0 42 42" aria-hidden style={{ flex: '0 0 auto' }}>
        <circle cx="21" cy="21" r={r} fill="none" stroke="var(--aq-border-light)" strokeWidth="5" />
        <circle
          cx="21" cy="21" r={r} fill="none"
          stroke={all ? HILITE : 'var(--aq-text)'}
          strokeWidth="5" strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - pct)}
          transform="rotate(-90 21 21)"
          style={{ transition: 'stroke-dashoffset 320ms ease' }}
        />
      </svg>
      <span>
        <strong style={{
          display: 'block', fontSize: 17, fontWeight: 800,
          letterSpacing: '-0.02em', lineHeight: 1.1,
          color: all ? HILITE : 'var(--aq-text)',
        }}>{all ? 'Done' : line}</strong>
        <span style={{ fontSize: 11.5, color: 'var(--aq-text-muted)' }}>
          {all ? 'nothing outstanding' : 'settled'}
        </span>
      </span>
    </div>
  );
}

/**
 * The marker in front of a section: ticked, next, still to do, or nothing.
 *
 * `none` draws an empty space of the same width rather than an empty circle.
 * A circle says "not done yet", and Comments is not a job somebody has failed
 * to finish. The width is held either way so the labels do not shuffle
 * sideways as a campaign settles.
 */
function Step({ step, flag, tone }: {
  step: IndexEntry['step'];
  flag: boolean;
  tone: { bg: string; fg: string; edge: string };
}) {
  const box: React.CSSProperties = {
    width: 15, height: 15, borderRadius: '50%', flex: '0 0 auto',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 9, fontWeight: 800, lineHeight: 1,
  };

  if (step === 'none') return <i aria-hidden style={box} />;

  if (step === 'done') {
    return (
      <i aria-hidden title="settled" style={{
        ...box, background: 'var(--aq-accent-light)', color: '#14603a',
      }}>✓</i>
    );
  }

  if (step === 'next') {
    return (
      <i aria-hidden title="next" style={{
        ...box, background: tone.bg, color: tone.fg,
      }}>›</i>
    );
  }

  // Still to do. A flagged one wears its tone so an amber section is visible
  // from the ring downwards, not only from its own count.
  return (
    <i aria-hidden title="not settled" style={{
      ...box,
      background: 'transparent',
      border: `1.5px dashed ${flag ? tone.edge : 'var(--aq-border)'}`,
    }} />
  );
}

/**
 * One line of the index.
 *
 * Three states rather than one: resting, hovered, and the section you are
 * looking at. The active one gets a solid left rail and its label goes to
 * full ink — the rail rather than a filled background because the sidebar
 * sits on the page ground, and a filled pill there reads as a button you
 * have already pressed.
 *
 * It is a real <a href> underneath, so middle-click, ⌘-click and "copy link"
 * all still work; the click handler only takes over to scroll smoothly and
 * move focus with it.
 */
function IndexLink({ entry, active, onGo }: {
  entry: IndexEntry;
  active: boolean;
  onGo: (anchor: string) => void;
}) {
  const [hover, setHover] = useState(false);
  const tone = TONE[entry.tone];

  return (
    <a
      href={entry.anchor}
      aria-current={active ? 'true' : undefined}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={(ev) => {
        // Let a modified click do what the browser would.
        if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button !== 0) return;
        ev.preventDefault();
        onGo(entry.anchor);
      }}
      style={{
        display: 'flex', alignItems: 'center', gap: 9,
        padding: '8px 11px 8px 10px',
        borderRadius: 9, fontSize: 13, textDecoration: 'none',
        borderLeft: `3px solid ${active ? 'var(--aq-text)' : 'transparent'}`,
        background: active ? 'var(--aq-bg-elevated)'
          : hover ? 'var(--aq-bg-hover)' : 'transparent',
        color: active ? 'var(--aq-text)'
          : entry.step === 'done' ? 'var(--aq-text-muted)'
          : 'var(--aq-text-secondary)',
        fontWeight: active ? 700 : entry.step === 'next' ? 600 : 500,
        transition: 'background 120ms ease, color 120ms ease',
      }}
    >
      <Step step={entry.step} flag={entry.flag} tone={tone} />
      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {entry.label}
      </span>
      {entry.count && (
        <span style={{
          marginLeft: 'auto', fontSize: 11, fontWeight: 700,
          padding: '1px 7px', borderRadius: 999,
          fontVariantNumeric: 'tabular-nums',
          background: entry.tone === 'grey' ? 'transparent' : tone.bg,
          color: entry.tone === 'grey' ? 'var(--aq-text-muted)' : tone.fg,
        }}>{entry.count}</span>
      )}
    </a>
  );
}


/** Near-black, not pure: #000 against a warm stone page reads as a hole. */
const INK = '#141210';
/** The highlight, lit for ink. Was a bright green — Siraj: *"tacky"*. */
const WIN = '#60a5fa';

function Fig({ k, v, sub, lead, bad }: {
  k: string; v: string; sub?: string; lead?: boolean; bad?: boolean;
}) {
  return (
    <div>
      <div style={{
        fontSize: 26, fontWeight: 800, letterSpacing: '-0.03em',
        lineHeight: 1, fontVariantNumeric: 'tabular-nums',
        color: bad ? '#f87171' : lead ? WIN : '#fff',
      }}>{v}</div>
      <div style={{
        fontSize: 10.5, fontWeight: 700, letterSpacing: '.09em',
        textTransform: 'uppercase', color: '#a8a29e', marginTop: 5,
      }}>
        {k}
        {sub && <span style={{ letterSpacing: 0, textTransform: 'none', fontWeight: 600 }}> · {sub}</span>}
      </div>
    </div>
  );
}


/*
 * Card, Group, Fields, F, Val, Pick and Text used to be defined here as well
 * as in ./campaign/ui — copies made when the sections moved into their own
 * files. A local function shadows an import, so this page kept using the
 * stale seven while every other card used the shared ones: the coloured
 * dropdowns landed everywhere except the page they were written for, and
 * Text's `numeric` prop silently did nothing here. Deleted; the shared ones
 * are a superset.
 */

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
        <i style={{ display: 'block', height: '100%', width: `${row.progressPct}%`, background: HILITE }} />
      </span>
      <span style={{
        fontSize: 13.5, fontWeight: 600, textAlign: 'right', whiteSpace: 'nowrap',
        fontVariantNumeric: 'tabular-nums',
        color: row.price == null ? '#b91c1c' : undefined,
      }}>{row.price == null ? '—' : moneyRound(row.price)}</span>
    </a>
  );
}
