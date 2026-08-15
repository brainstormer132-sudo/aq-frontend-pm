'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  useTask, useTaskSubtasks, useTaskComments, useTaskAttachments, useTaskServiceTypes,
  useLegacyVendors,
  useTaskSources, useClientCategories,
  useClients, useClientBrands,
  useContractRequests, type ContractKind,
  useTaskPlatforms, rollupCampaignMoney,
  publishTrackingSheet, unpublishTrackingSheet,
  ensureTrackingRowForVendor, isTrackableVendorCategory,
  TASK_STATUSES, APPROVAL_STAGES, AD_TYPES, AD_TYPE_NEEDS_DETAIL, CONTRACT_STATUSES, labelFor,
  addComment, deleteComment, addAttachmentLink, uploadTaskAttachment,
  getAttachmentDownloadUrl, deleteAttachment,
  deleteTask as deleteTaskFn, markTaskCompleted, updateTaskFields,
  autoCreateContractRequestForSubtask,
  createSubtask, removeSubtask,
  vendorSubtaskTitle, isAutoVendorTitle, isVendorSubtaskKind,
  isSingletonSubtaskKind, isSimpleDeliverableKind,
  displayName, parseCommentSegments, offeredSubtaskKinds, catalogExpectsKind,
  runDurationLabel, vendorPickerOption,
  clientContractReadiness, sendClientContractRequest, vendorContractReadiness,
  type MissingRequirement,
  type ServiceTypeStep,
  COMPLEXITIES, MEDIA_TYPES,
  analysisReportInherited, effectiveAnalysisPlatforms,
  campaignCompletenessWarnings,
  useDocumentRequests, requestCampaignDocument, cancelDocumentRequest,
  SUBTASK_KIND_LABELS, isRequestSubtaskKind,
  type Profile, type WorkspaceRole, type SubtaskKind,
} from '@/hooks/use-workflow';
import { TaskAssignees } from './TaskAssignees';
import { RequestContractModal } from './RequestContractModal';
import { AddVendorsModal } from './AddVendorsModal';
import { MentionBox, CommentText } from './MentionBox';
import { TrackingSheetPanel } from './TrackingSheetPanel';
import { SearchablePicker } from './SearchablePicker';

// Same 140px/1fr grid FieldRow uses, so editable sales rows line up with the
// read-only rows above and below them.
const SALES_ROW: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: '140px 1fr', gap: 12,
  padding: '6px 0', fontSize: 13, alignItems: 'center',
};
const SALES_LABEL: React.CSSProperties = { color: 'var(--aq-text-muted)', fontWeight: 600 };

/**
 * Slide-over panel that shows a single task — header, fields, subtasks list,
 * file uploads, and a comments thread. Behavior is role-gated:
 *
 *   - owner / admin / marketing -> full edit + delete
 *   - sales (creator) → can edit own draft tasks
 *   - key_account on the task → can mark complete + see everything
 *   - member → READ-ONLY everywhere except the comment box and uploads
 *
 * Internal navigation: clicking a subtask row opens the subtask in the
 * SAME panel. A "← Back to parent task" button at the top brings you
 * back. Each subtask has its own comments, attachments, budget, and
 * assignee — they are first-class `pm_tasks` rows with `parent_task_id`
 * set, so all the existing hooks just work on them.
 */
export function TaskDetailPanel({
  taskId, currentUserId, role, profiles, serviceTypeSteps = [], onClose, onChanged,
}: {
  taskId: string | null;
  currentUserId: string;
  role: WorkspaceRole | null;
  profiles: (Profile & { role: WorkspaceRole })[];
  /** The whole workspace catalogue; the picker filters it to this campaign. */
  serviceTypeSteps?: ServiceTypeStep[];
  onClose: () => void;
  onChanged?: () => void;
}) {
  // The task we're CURRENTLY viewing in the panel — may be the original
  // taskId or a subtask the user clicked into.
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(taskId);
  useEffect(() => { setCurrentTaskId(taskId); }, [taskId]);

  const { task, refetch: refetchTask, loading } = useTask(currentTaskId);
  const { subtasks, refetch: refetchSubs } = useTaskSubtasks(currentTaskId);
  const { comments, refetch: refetchComments } = useTaskComments(currentTaskId);
  const { attachments, refetch: refetchAtt } = useTaskAttachments(currentTaskId);
  const { items: taskServiceTypes } = useTaskServiceTypes(currentTaskId);

  // For subtasks we also need the PARENT task (for brand_name / legacy_client_id
  // when auto-creating a contract request). For top-level tasks parentTask is null.
  const { task: parentTask } = useTask(task?.parent_task_id ?? null);

  // Vendors list — used by the per-subtask vendor picker and the auto-fire flow.
  const { vendors, banks } = useLegacyVendors();

  // Operations lookups (migration 028) — Source + Client Category dropdowns
  // on the parent campaign. Empty list = workspace hasn't seeded any yet,
  // in which case the inputs gracefully degrade to "—".
  const { items: taskSources } = useTaskSources(task?.workspace_id ?? null);
  const { items: clientCategories } = useClientCategories(task?.workspace_id ?? null);
  const { items: taskPlatforms } = useTaskPlatforms(task?.workspace_id ?? null);

  // Client + brand pickers for the sales half of a parent campaign (Phase 4).
  const { clients } = useClients();
  const { brands } = useClientBrands(task?.client_id ?? null);

  // Contract requests raised against THIS task (Phase 6). The parent card
  // reads the client ones; vendor requests are auto-fired from subtasks.
  const { items: contractRequests, refetch: refetchContractRequests } =
    useContractRequests(task?.workspace_id ?? null, task?.id ?? null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [commentText, setCommentText] = useState('');
  const [requestOpen, setRequestOpen] = useState(false);
  // Which side the contract modal opens on — the client card sets 'client'.
  const [requestKind, setRequestKind] = useState<ContractKind>('vendor');
  const [trackingOpen, setTrackingOpen] = useState(false);
  // "+ Add subtask" on the parent (Phase 2).
  const [addKind, setAddKind] = useState<SubtaskKind | ''>('');
  const [addVendorsOpen, setAddVendorsOpen] = useState(false);
  const [addingSubtask, setAddingSubtask] = useState(false);
  const [removingSubtaskId, setRemovingSubtaskId] = useState<string | null>(null);

  // Inline-editable fields. Initialized from `task` and synced when it changes.
  const [budgetDraft, setBudgetDraft] = useState<string>('');
  const [budgetSaving, setBudgetSaving] = useState(false);
  const [assigneeSaving, setAssigneeSaving] = useState(false);
  const [vendorSaving, setVendorSaving] = useState(false);
  // Banner shown after the auto-fire creates a contract request.
  const [autoSentBanner, setAutoSentBanner] = useState<string | null>(null);
  useEffect(() => {
    setBudgetDraft(task?.budget != null ? String(task.budget) : '');
    setAutoSentBanner(null);
  }, [task?.id, task?.budget]);

  // File picker (kept hidden; clicking the "Upload file" button triggers it).
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const isOpen = Boolean(taskId);

  // Esc key closes.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  const isCreator    = task?.creator_id === currentUserId;
  const isKeyAcct    = task?.key_account_id === currentUserId;
  const isAssignee   = task?.assignee_id === currentUserId;
  const isPrivileged = role && ['owner','admin','marketing'].includes(role);
  const isAdminish   = Boolean(role && ['owner','admin'].includes(role));

  // ── Who can edit what (migration 051) ───────────────────────────────
  //
  // The sales-vs-marketing field split is gone. It refused sales the right
  // to touch a budget and marketing the right to fix a client name, which
  // meant a one-word correction needed the other half of the company.
  //
  // The rule now: MEMBERS cannot edit a parent campaign. Everyone else —
  // owner, admin, marketing, sales, key account, operations — can edit
  // anything on it. Subtasks were never restricted and still aren't.
  //
  // Mirrored in Postgres by trg_enforce_task_field_ownership (051).
  // Change one and you must change the other.
  const canEditParent = Boolean(role && role !== 'member');
  const canEditSales     = canEditParent;
  const canEditMarketing = canEditParent;
  const canEditBudget    = task?.parent_task_id ? true : canEditParent;
  const canEditAssignee  = canEditParent;

  const canEdit      = Boolean(task?.parent_task_id ? true : canEditParent);
  const canDelete    = Boolean(isPrivileged || (role === 'sales' && isCreator));
  const canMarkDone  = Boolean(isKeyAcct || isPrivileged);
  const canRequestContract = Boolean(
    role && ['owner','admin','marketing','sales','key_account'].includes(role)
  );
  // Everyone with workspace access can comment/attach (RLS will reject
  // if they're not actually allowed).
  const canComment = true;
  const canAttach  = true;
  // Request-kind subtasks (quotation / invoice / contract): who can send a
  // request vs. who can mark it fulfilled (Ops/admin/marketing).
  const canRequest = Boolean(isPrivileged || isAssignee);
  const canFulfill = Boolean(role && ['owner','admin','operations','marketing'].includes(role));

  const profileById = useMemo(() => {
    const m = new Map(profiles.map((p) => [p.id, p]));
    return m;
  }, [profiles]);

  /** id → current display name, for resolving @mentions at render time. */
  const mentionNames = useMemo(
    () => new Map(profiles.map((p) => [p.id, displayName(p)])),
    [profiles],
  );

  const closer        = task?.sales_closer_id ? profileById.get(task.sales_closer_id) : null;
  const ka            = task?.key_account_id  ? profileById.get(task.key_account_id)  : null;
  const subAssignee   = task?.assignee_id     ? profileById.get(task.assignee_id)     : null;

  // Variance: parent budget vs sum of subtask budgets. Only meaningful on a
  // parent that actually has subtasks.
  const subtaskBudgetSum = useMemo(
    () => subtasks.reduce((acc, s) => acc + (Number(s.budget) || 0), 0),
    [subtasks],
  );
  const parentBudget = Number(task?.budget) || 0;
  const variance = parentBudget - subtaskBudgetSum;

  const handleAddComment = async () => {
    if (!task || !commentText.trim()) return;
    setBusy(true); setError('');
    try {
      await addComment(task.id, currentUserId, commentText.trim());
      setCommentText('');
      await refetchComments();
    } catch (e: any) { setError(e?.message ?? String(e)); }
    finally { setBusy(false); }
  };

  const handleFilePicked = async (file: File | null) => {
    if (!file || !task) return;
    if (!task.workspace_id) {
      setError('Cannot upload — task has no workspace.');
      return;
    }
    setBusy(true); setError('');
    try {
      await uploadTaskAttachment({
        file,
        task_id: task.id,
        uploader_id: currentUserId,
        workspace_id: task.workspace_id,
      });
      await refetchAtt();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
      // Reset the input so the same filename can be re-picked later.
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleOpenAttachment = async (a: { file_url: string; filename: string }) => {
    try {
      const url = await getAttachmentDownloadUrl(a.file_url);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e: any) {
      setError(`Could not open ${a.filename}: ${e?.message ?? String(e)}`);
    }
  };

  const handleDeleteAttachment = async (id: string) => {
    setBusy(true); setError('');
    try { await deleteAttachment(id); await refetchAtt(); }
    catch (e: any) { setError(e?.message ?? String(e)); }
    finally { setBusy(false); }
  };

  const handleDeleteComment = async (id: string) => {
    setBusy(true); setError('');
    try { await deleteComment(id); await refetchComments(); }
    catch (e: any) { setError(e?.message ?? String(e)); }
    finally { setBusy(false); }
  };

  // ── Phase 4: the sales half of a parent campaign ────────────────────
  const [salesSaving, setSalesSaving] = useState(false);
  const [descDraft, setDescDraft] = useState('');
  useEffect(() => { setDescDraft(task?.description ?? ''); }, [task?.id, task?.description]);

  const patchSalesFields = async (fields: Partial<PMTask>) => {
    if (!task) return;
    setSalesSaving(true); setError('');
    try {
      await updateTaskFields(task.id, fields);
      await refetchTask();
      onChanged?.();
    } catch (e: any) { setError(e?.message ?? String(e)); }
    finally { setSalesSaving(false); }
  };

  // Changing the client invalidates the brand — clear both brand columns so
  // the row can't end up pointing at a brand belonging to another client.
  const handleChangeClient = async (clientId: string) => {
    const c = clients.find((x) => x.id === clientId);
    await patchSalesFields({
      client_id: clientId || null,
      legacy_client_id: c ? (c.cr_number || c.id) : null,
      brand_id: null,
      brand_name: null,
      // The category belongs to the client, so it follows the client rather
      // than being picked again on every campaign. Only overwritten when the
      // client actually carries one — never blanks a manual choice.
      ...(c?.client_category_id ? { client_category_id: c.client_category_id } : {}),
    });
  };

  const handleChangeBrand = async (brandId: string) => {
    const b = brands.find((x) => x.id === brandId);
    await patchSalesFields({
      brand_id: brandId || null,
      brand_name: b?.brand_name ?? null,
    });
  };

  // ── Phase 6: the campaign's contract with the CLIENT ────────────────
  // Ordered newest-first by the hook, so [0] is the live one.
  const clientContractRequests = useMemo(
    () => contractRequests.filter((r) => r.request_kind === 'client'),
    [contractRequests],
  );
  const latestClientContract = clientContractRequests[0] ?? null;
  // Only offer a fresh request when there isn't one in flight. A rejected or
  // cancelled request is a dead end, so raising another is the right move.
  const canRaiseClientContract = !latestClientContract
    || ['rejected', 'cancelled'].includes(String(latestClientContract.status));

  // ── Contract requests: check, then send. No form. ───────────────────
  //
  // The old flow opened RequestContractModal and re-asked for details the
  // app already held on the campaign and the client record. Now the data is
  // read at send time, so the request can't disagree with its own source,
  // and an incomplete one is refused rather than handed to Legal to chase.
  const clientForContract = useMemo(
    () => clients.find((c) => c.id === task?.client_id) ?? null,
    [clients, task?.client_id],
  );
  const clientReadiness = useMemo(
    () => clientContractReadiness(task && !task.parent_task_id ? task : null, clientForContract),
    [task, clientForContract],
  );
  const [sendingClientContract, setSendingClientContract] = useState(false);

  /** Same check for the vendor side, which fires automatically when ready. */
  const vendorReadiness = useMemo(() => {
    if (!task?.parent_task_id) return { ready: true, missing: [] as MissingRequirement[] };
    const v = task.vendor_id != null ? vendors.find((x) => x.id === task.vendor_id) ?? null : null;
    const b = v ? banks.find((x) => x.vendor_id === v.id) ?? null : null;
    return vendorContractReadiness(task, v, b);
  }, [task, vendors, banks]);

  const handleSendClientContract = async () => {
    if (!task) return;
    setSendingClientContract(true); setError('');
    try {
      await sendClientContractRequest({
        task,
        client: clientForContract,
        requestedBy: currentUserId,
      });
      await refetchContractRequests();
      onChanged?.();
      setPublishNote('Client contract requested.');
    } catch (e: any) { setError(e?.message ?? String(e)); }
    finally { setSendingClientContract(false); }
  };

  // ── Quotation / invoice requests (migration 048) ────────────────────
  // These sit on the PARENT, next to the client contract, because that is
  // where the quotation and invoice numbers already live. Vendor contracts
  // stay on the vendor subtask — that's where the vendor is.
  const { items: docRequests, refetch: refetchDocRequests } =
    useDocumentRequests(task && !task.parent_task_id ? task.id : null);
  const [docBusy, setDocBusy] = useState<'quotation' | 'invoice' | null>(null);

  const openDocRequest = (kind: 'quotation' | 'invoice') =>
    docRequests.find((r) => r.doc_kind === kind && r.status === 'pending') ?? null;

  const handleRequestDocument = async (kind: 'quotation' | 'invoice') => {
    if (!task) return;
    setDocBusy(kind); setError('');
    try {
      await requestCampaignDocument({ parent: task, kind, requestedBy: currentUserId });
      await refetchDocRequests();
      onChanged?.();
    } catch (e: any) { setError(e?.message ?? String(e)); }
    finally { setDocBusy(null); }
  };

  const handleCancelDocRequest = async (id: string, kind: 'quotation' | 'invoice') => {
    setDocBusy(kind); setError('');
    try {
      await cancelDocumentRequest(id);
      await refetchDocRequests();
    } catch (e: any) { setError(e?.message ?? String(e)); }
    finally { setDocBusy(null); }
  };

  // ── Warn, don't block (Siraj's call) ────────────────────────────────
  // Proof of posting, the analysis report and the insight are "always
  // required" — surfaced here so nobody forgets, but nothing refuses a save.
  const completeness = useMemo(
    () => (task && !task.parent_task_id
      ? campaignCompletenessWarnings(task, subtasks, {
          // Only nag for an analysis report where the service type asks for
          // one. A Package Ad isn't a Campaign and shouldn't be told off for
          // missing a report nobody expected of it.
          expectsAnalysisReport: catalogExpectsKind(
            taskServiceTypes.map((s) => s.id), serviceTypeSteps, 'analysis_report',
          ),
        })
      : []),
    [task, subtasks, taskServiceTypes, serviceTypeSteps],
  );

  // ── Publish the tracking sheet to the client (migration 045) ────────
  const [publishing, setPublishing] = useState(false);
  const [publishNote, setPublishNote] = useState<string | null>(null);

  const handlePublishTracking = async () => {
    if (!task) return;
    setPublishing(true); setError(''); setPublishNote(null);
    try {
      const n = await publishTrackingSheet(task.id);
      setPublishNote(n === 0
        ? 'Published — but the sheet is empty, so the client sees nothing yet.'
        : `Published ${n} row${n === 1 ? '' : 's'} to the client.`);
      await refetchTask();
      onChanged?.();
    } catch (e: any) { setError(e?.message ?? String(e)); }
    finally { setPublishing(false); }
  };

  const handleUnpublishTracking = async () => {
    if (!task) return;
    if (!window.confirm('Withdraw the client-facing sheet? They will see nothing until you publish again.')) return;
    setPublishing(true); setError(''); setPublishNote(null);
    try {
      await unpublishTrackingSheet(task.id);
      setPublishNote('Withdrawn — the client no longer sees this sheet.');
      await refetchTask();
      onChanged?.();
    } catch (e: any) { setError(e?.message ?? String(e)); }
    finally { setPublishing(false); }
  };

  // ── Phase 5: Package Ad — run window + how many ads ─────────────────
  const vendorSubtasks = useMemo(
    () => subtasks.filter((s) => isVendorSubtaskKind(s.subtask_kind)),
    [subtasks],
  );

  /** The vendor register, shaped for the type-ahead. */
  const vendorOptions = useMemo(() => vendors.map(vendorPickerOption), [vendors]);

  /** Kinds already on this parent, so singletons can be greyed out. */
  const existingSubtaskKinds = useMemo(
    () => new Set(subtasks.map((s) => s.subtask_kind).filter(Boolean) as string[]),
    [subtasks],
  );

  /**
   * What this campaign may add. Vendor and Analysis Report always, plus
   * whatever its own service types define — so an Ad Hook is no longer
   * offered a Blueprint Mapping / 3D subtask it will never use.
   */
  const offeredKinds = useMemo(
    () => offeredSubtaskKinds(taskServiceTypes.map((s) => s.id), serviceTypeSteps),
    [taskServiceTypes, serviceTypeSteps],
  );
  const isPackageAd = useMemo(
    () => taskServiceTypes.some((s) => (s.name ?? '').trim().toLowerCase() === 'package ad'),
    [taskServiceTypes],
  );
  const [packageSaving, setPackageSaving] = useState(false);

  const patchPackageFields = async (fields: Partial<PMTask>) => {
    if (!task) return;
    setPackageSaving(true); setError('');
    try {
      await updateTaskFields(task.id, fields);
      await refetchTask();
      onChanged?.();
    } catch (e: any) { setError(e?.message ?? String(e)); }
    finally { setPackageSaving(false); }
  };

  // handleSaveQuantity lived here — it wrote ad_quantity and topped the
  // campaign up to that many vendor subtasks. Gone with the field: the Add
  // vendors popup creates them with an ad type, a platform and a price,
  // which a bare count never could.

  // ── Phase 2: add / remove a single subtask on the parent ────────────
  const handleAddSubtask = async (kindOverride?: SubtaskKind) => {
    const kind = kindOverride ?? addKind;
    if (!task || !kind) return;
    if (!task.workspace_id) { setError('Cannot add a subtask — task has no workspace.'); return; }
    setAddingSubtask(true); setError('');
    try {
      if (kind === 'vendor') {
        // Vendors go through the popup — a batch of 50 shares an ad type,
        // a platform and a price, and setting those once is the whole point.
        setAddVendorsOpen(true);
        setAddingSubtask(false);
        return;
      } else {
        await createSubtask({
          parent_task_id: task.id,
          workspace_id: task.workspace_id,
          creator_id: currentUserId,
          kind,
          title: SUBTASK_KIND_LABELS[kind],
          priority: task.priority,
        });
      }
      setAddKind('');
      await refetchSubs();
      await refetchTask();   // has_tracking may have flipped
      onChanged?.();
    } catch (e: any) { setError(e?.message ?? String(e)); }
    finally { setAddingSubtask(false); }
  };

  // ── Delete with a 10-second window to change your mind ──────────────
  //
  // No confirmation dialog. The row disappears at once and the delete is
  // DEFERRED for ten seconds — cancelling is just not running it. The
  // alternative (delete now, restore on undo) can't work: the row's files,
  // comments and contract request go with it and can't be resurrected.
  //
  // Pending deletes are flushed if the panel closes, so a delete can never
  // be silently forgotten by walking away from it.
  const UNDO_MS = 10_000;
  const pendingRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const [pendingSubtaskDeletes, setPendingSubtaskDeletes] =
    useState<{ id: string; title: string }[]>([]);
  const [pendingSelfDelete, setPendingSelfDelete] = useState(false);
  const [undoSeconds, setUndoSeconds] = useState(0);

  const commitSubtaskDelete = useCallback(async (id: string) => {
    pendingRef.current.delete(id);
    setPendingSubtaskDeletes((p) => p.filter((x) => x.id !== id));
    try {
      await removeSubtask(id);
      await refetchSubs();
      await refetchTask();
      onChanged?.();
    } catch (e: any) { setError(e?.message ?? String(e)); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refetchSubs, refetchTask]);

  const handleRemoveSubtask = (sub: { id: string; title: string }) => {
    if (pendingRef.current.has(sub.id)) return;
    setError('');
    setPendingSubtaskDeletes((p) => [...p, { id: sub.id, title: sub.title }]);
    pendingRef.current.set(sub.id, setTimeout(() => { commitSubtaskDelete(sub.id); }, UNDO_MS));
  };

  /** Subtasks minus the ones counting down to deletion. */
  const visibleSubtasks = useMemo(
    () => subtasks.filter((s) => !pendingSubtaskDeletes.some((p) => p.id === s.id)),
    [subtasks, pendingSubtaskDeletes],
  );

  const undoRemoveSubtask = (id: string) => {
    const t = pendingRef.current.get(id);
    if (t) clearTimeout(t);
    pendingRef.current.delete(id);
    setPendingSubtaskDeletes((p) => p.filter((x) => x.id !== id));
  };

  // Closing the panel commits anything still counting down. Leaving a
  // delete un-run because the panel closed would be the same silent
  // no-op that made deletes look glitchy in the first place.
  useEffect(() => {
    const map = pendingRef.current;
    return () => {
      map.forEach((t, id) => { clearTimeout(t); void removeSubtask(id).catch(() => {}); });
      map.clear();
    };
  }, []);

  const handleDeleteTask = () => {
    if (!task || pendingSelfDelete) return;
    setError('');
    setPendingSelfDelete(true);
    setUndoSeconds(UNDO_MS / 1000);
  };

  const undoDeleteTask = () => {
    setPendingSelfDelete(false);
    setUndoSeconds(0);
  };

  // Counts the parent delete down, then runs it and closes.
  useEffect(() => {
    if (!pendingSelfDelete || !task) return;
    if (undoSeconds <= 0) {
      (async () => {
        try {
          await deleteTaskFn(task.id);
          onChanged?.();
          onClose();
        } catch (e: any) {
          setError(e?.message ?? String(e));
          setPendingSelfDelete(false);
        }
      })();
      return;
    }
    const t = setTimeout(() => setUndoSeconds((s) => s - 1), 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingSelfDelete, undoSeconds, task?.id]);

  const handleMarkDone = async () => {
    if (!task) return;
    setBusy(true); setError('');
    try {
      await markTaskCompleted(task.id);
      await refetchTask();
      onChanged?.();
    } catch (e: any) { setError(e?.message ?? String(e)); }
    finally { setBusy(false); }
  };

  const handleToggleTracking = async (next: boolean) => {
    if (!task) return;
    setBusy(true); setError('');
    try {
      await updateTaskFields(task.id, { has_tracking: next } as any);
      await refetchTask();
      onChanged?.();
    } catch (e: any) { setError(e?.message ?? String(e)); }
    finally { setBusy(false); }
  };

  const handleSaveBudget = async () => {
    if (!task) return;
    const raw = budgetDraft.trim().replace(/,/g, '');
    const parsed = raw === '' ? null : Number(raw);
    if (parsed != null && (!Number.isFinite(parsed) || parsed < 0)) {
      setError('Budget must be a positive number or empty.');
      return;
    }
    setBudgetSaving(true); setError('');
    try {
      await updateTaskFields(task.id, { budget: parsed } as any);
      await refetchTask();
      // Refetching subs too refreshes the parent's variance display when a
      // subtask budget was just changed.
      await refetchSubs();
      onChanged?.();
    } catch (e: any) { setError(e?.message ?? String(e)); }
    finally { setBudgetSaving(false); }
  };

  const handleChangeAssignee = async (newId: string) => {
    if (!task) return;
    setAssigneeSaving(true); setError('');
    try {
      await updateTaskFields(task.id, { assignee_id: newId || null } as any);
      await refetchTask();
      await refetchSubs();
      onChanged?.();
    } catch (e: any) { setError(e?.message ?? String(e)); }
    finally { setAssigneeSaving(false); }
  };

  /**
   * Auto-fire a contract request when a subtask now has BOTH vendor + budget.
   * Idempotent (no-op if `contract_request_id` is already set).
   */
  const tryAutoSendContractRequest = async () => {
    if (!task || !task.parent_task_id) return; // subtasks only
    if (task.contract_request_id) return;       // already sent
    const vendor = task.vendor_id != null
      ? vendors.find((v) => v.id === task.vendor_id) ?? null
      : null;
    if (!vendor) return;
    if (!parentTask) return;                    // parent not loaded yet

    const bank = banks.find((b) => b.vendor_id === vendor.id) ?? null;

    // Don't send a half-filled request. It used to fire on vendor + budget
    // alone, so Legal received requests with no licence, no signatory and
    // no IBAN and had to chase them. The panel below says what's missing.
    if (!vendorContractReadiness(task, vendor, bank).ready) return;
    try {
      const newId = await autoCreateContractRequestForSubtask({
        subtask: task,
        parent: parentTask,
        vendor,
        bank,
        requestedBy: currentUserId,
        notes: null,
      });
      if (newId) {
        setAutoSentBanner('Contract request sent to the contract maker. Add notes below — they go through as comments.');
        await refetchTask();
        onChanged?.();
      }
    } catch (e: any) {
      setError(`Could not send contract request: ${e?.message ?? String(e)}`);
    }
  };

  const handleChangeVendor = async (newId: string) => {
    if (!task) return;
    setVendorSaving(true); setError('');
    try {
      const numericId = newId ? Number(newId) : null;
      const patch: Record<string, unknown> = { vendor_id: numericId };

      // Phase 5: a vendor subtask is named "{brand} — {vendor}". Do it in the
      // SAME update as vendor_id so the rename lands before the auto-fire
      // effect below creates the contract request — that request copies the
      // title into its `details`, so renaming afterwards would be too late.
      // A title somebody typed by hand is never overwritten.
      if (isVendorSubtaskKind(task.subtask_kind) && numericId != null) {
        const vendorName = vendors.find((v) => v.id === numericId)?.name ?? null;
        const brand = parentTask?.brand_name ?? task.brand_name ?? null;
        if (isAutoVendorTitle(task.title, brand)) {
          patch.title = vendorSubtaskTitle(brand, vendorName);
        }
      }

      await updateTaskFields(task.id, patch as any);

      // An influencer or UGC vendor gets a row on the campaign's tracking
      // sheet automatically — that sheet exists to track exactly this work.
      // Other vendor types (printing, production, billboard) don't belong
      // there. Best-effort: ensureTrackingRowForVendor swallows its own
      // errors, because a tracking row must never block the vendor
      // assignment or the contract request that follows it.
      if (numericId != null && parentTask?.has_tracking) {
        const v = vendors.find((x) => x.id === numericId);
        if (v && isTrackableVendorCategory((v as any).vendor_category)) {
          await ensureTrackingRowForVendor({
            parent_task_id: parentTask.id,
            vendor_name: v.name,
            platform: task.platform,
            price_excl: task.price,
          });
        }
      }

      await refetchTask();
      // Auto-fire happens after the next refetch when state has the new vendor_id.
    } catch (e: any) { setError(e?.message ?? String(e)); }
    finally { setVendorSaving(false); }
  };

  // Watch for the moment a subtask has vendor + budget + no request yet → fire.
  useEffect(() => {
    if (!task || !task.parent_task_id) return;
    if (task.contract_request_id) return;
    if (!task.vendor_id) return;
    const amount = Number(task.budget);
    if (!Number.isFinite(amount) || amount <= 0) return;
    if (!parentTask) return;
    if (vendors.length === 0) return;
    tryAutoSendContractRequest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.id, task?.vendor_id, task?.budget, task?.contract_request_id, parentTask?.id, vendors.length]);

  if (!isOpen) return null;

  const isSubtaskView = Boolean(task?.parent_task_id);
  const kind = task?.subtask_kind ?? null;
  // Purpose-built subtasks that replace the generic fields with a lean layout.
  const isRequestKind = isSubtaskView && isRequestSubtaskKind(kind);

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        display: 'flex', justifyContent: 'flex-end',
      }}
    >
      <div
        onClick={onClose}
        style={{ flex: 1, background: 'rgba(15, 29, 34, 0.4)' }}
        aria-hidden="true"
      />
      <aside
        className="animate-slide-in"
        style={{
          width: '100%', maxWidth: 760,
          background: 'var(--aq-bg-elevated)',
          overflow: 'auto',
          boxShadow: 'var(--aq-shadow-lg)',
          display: 'flex', flexDirection: 'column',
        }}
        role="dialog"
        aria-modal="true"
      >
        {loading || !task ? (
          <div style={{ padding: 28, color: 'var(--aq-text-muted)' }}>Loading task…</div>
        ) : (
          <>
            {/* Back-to-parent link, only when viewing a subtask */}
            {isSubtaskView && task.parent_task_id && (
              <div style={{
                padding: '10px 24px',
                borderBottom: '1px solid var(--aq-border-light)',
                background: 'var(--aq-bg-sunken)',
                fontSize: 13,
              }}>
                <button
                  type="button"
                  className="aq-btn aq-btn-ghost"
                  onClick={() => setCurrentTaskId(task.parent_task_id!)}
                  style={{ padding: '4px 10px' }}
                >← Back to parent task</button>
              </div>
            )}

            {/* Header */}
            <header style={{
              padding: '20px 24px',
              borderBottom: '1px solid var(--aq-border-light)',
              display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
              gap: 16,
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span className={`aq-badge ${
                    task.stage === 'completed' ? 'aq-badge-success'
                    : task.stage === 'pending_marketing' ? 'aq-badge-warning'
                    : 'aq-badge-info'
                  }`}>{task.stage.replace('_', ' ')}</span>
                  {task.priority !== 'none' && (
                    <span className="aq-badge aq-badge-muted">{task.priority}</span>
                  )}
                  {isSubtaskView && <span className="aq-badge aq-badge-muted">subtask</span>}
                </div>
                <h2 style={{ fontSize: 22, fontWeight: 800, lineHeight: 1.25 }}>
                  {task.task_name || task.title}
                </h2>
                {task.brand_name && (
                  <p style={{ marginTop: 4, fontSize: 13, color: 'var(--aq-text-muted)' }}>
                    {task.brand_name}
                    {task.legacy_client_id && ` · client ${task.legacy_client_id}`}
                  </p>
                )}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {!isSubtaskView && task.has_tracking && (
                  <button className="aq-btn aq-btn-secondary" onClick={() => setTrackingOpen(true)}>
                    Tracking sheet
                  </button>
                )}
                {!isSubtaskView && canRequestContract && (
                  <button className="aq-btn aq-btn-secondary" onClick={() => { setRequestKind('vendor'); setRequestOpen(true); }}>
                    Request contract
                  </button>
                )}
                {canMarkDone && task.status !== 'done' && (
                  <button className="aq-btn aq-btn-primary" disabled={busy} onClick={handleMarkDone}>
                    Mark complete
                  </button>
                )}
                {canDelete && !pendingSelfDelete && (
                  <button className="aq-btn aq-btn-danger" disabled={busy} onClick={handleDeleteTask}>
                    Delete
                  </button>
                )}
                {pendingSelfDelete && (
                  <button
                    type="button"
                    className="aq-btn aq-btn-secondary"
                    onClick={undoDeleteTask}
                  >
                    Undo delete ({undoSeconds})
                  </button>
                )}
                <button className="aq-btn aq-btn-ghost" onClick={onClose} aria-label="Close">✕</button>
              </div>
            </header>

            <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 24 }}>
              {pendingSelfDelete && (
                <section
                  className="aq-card"
                  style={{ padding: '12px 16px', borderLeft: '3px solid var(--aq-error)' }}
                >
                  <strong style={{ fontSize: 13, color: 'var(--aq-error)' }}>
                    Deleting this campaign in {undoSeconds}s
                  </strong>
                  <p style={{ fontSize: 12, color: 'var(--aq-text-muted)', marginTop: 4 }}>
                    Its subtasks, files and comments go with it. Press
                    &ldquo;Undo delete&rdquo; above to stop.
                  </p>
                </section>
              )}

              {error && (
                <div style={{
                  background: 'var(--aq-error)', color: '#fff',
                  padding: '10px 14px', borderRadius: 'var(--aq-radius)', fontSize: 13,
                }}>{error}</div>
              )}

              {!canEdit && (
                <div className="aq-badge aq-badge-info" style={{ alignSelf: 'flex-start' }}>
                  Read-only — you can comment and upload files
                </div>
              )}

              {/* Vendor contract: what's still stopping it going out.
                  The request fires by itself once everything is there, so
                  this list IS the call to action. */}
              {isSubtaskView && isVendorSubtaskKind(kind)
                && !task.contract_request_id && !vendorReadiness.ready && (
                <section
                  className="aq-card"
                  style={{ padding: '12px 16px', borderLeft: '3px solid var(--aq-warning, #b45309)' }}
                >
                  <strong style={{ fontSize: 13, color: 'var(--aq-warning, #b45309)' }}>
                    Contract request not sent yet
                  </strong>
                  <p style={{ fontSize: 12, color: 'var(--aq-text-muted)', margin: '4px 0 6px' }}>
                    It goes to the contract app on its own once these are filled in.
                  </p>
                  <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {vendorReadiness.missing.map((m: MissingRequirement) => (
                      <li key={`${m.label}${m.where}`} style={{ fontSize: 12, color: 'var(--aq-text-secondary)' }}>
                        · <strong>{m.label}</strong>{m.where ? ` — ${m.where}` : ''}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {autoSentBanner && (
                <div style={{
                  background: 'var(--aq-accent-light)',
                  color: 'var(--aq-accent)',
                  padding: '10px 14px',
                  borderRadius: 'var(--aq-radius)',
                  fontSize: 13,
                  fontWeight: 600,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 8,
                }}>
                  <span>{autoSentBanner}</span>
                  <button
                    type="button"
                    className="aq-btn aq-btn-ghost"
                    onClick={() => setAutoSentBanner(null)}
                    style={{ padding: '2px 8px', fontSize: 11 }}
                  >dismiss</button>
                </div>
              )}

              {/* Tracking sheet toggle — parent campaigns only */}
              {!isSubtaskView && canEditMarketing && (
                <section className="aq-card" style={{
                  padding: 18, display: 'flex', alignItems: 'center',
                  justifyContent: 'space-between', gap: 12,
                }}>
                  <div>
                    <h3 style={{ fontSize: 14, fontWeight: 700 }}>Tracking sheet</h3>
                    <p style={{ fontSize: 12, color: 'var(--aq-text-muted)', marginTop: 2 }}>
                      {!task.has_tracking
                        ? 'Turn on to add a tracking sheet for this campaign.'
                        : task.tracking_published_at
                          ? `The client can see this sheet as it was on ${new Date(task.tracking_published_at).toLocaleString()}. Your edits since then are private until you press Update.`
                          : 'Working sheet only — the client cannot see it yet. Publishing sends a copy to their portal.'}
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    {task.has_tracking && (
                      <>
                        <button
                          type="button"
                          className="aq-btn aq-btn-primary"
                          disabled={publishing || busy}
                          onClick={handlePublishTracking}
                          title="Copy the working sheet to the client-facing one"
                        >{publishing ? 'Publishing…' : task.tracking_published_at ? 'Update client sheet' : 'Publish to client'}</button>
                        {task.tracking_published_at && (
                          <button
                            type="button"
                            className="aq-btn aq-btn-ghost"
                            disabled={publishing || busy}
                            onClick={handleUnpublishTracking}
                            style={{ padding: '6px 10px', fontSize: 12 }}
                          >Withdraw</button>
                        )}
                      </>
                    )}
                    <button
                      type="button"
                      className={`aq-btn ${task.has_tracking ? 'aq-btn-secondary' : 'aq-btn-primary'}`}
                      disabled={busy || publishing}
                      onClick={() => handleToggleTracking(!task.has_tracking)}
                    >
                      {task.has_tracking ? 'Disable' : 'Enable tracking sheet'}
                    </button>
                  </div>
                </section>
              )}

              {publishNote && (
                <div className="aq-badge aq-badge-info" style={{ alignSelf: 'flex-start' }}>
                  {publishNote}
                </div>
              )}

              {/* Still-missing checklist. Warns, never blocks — the campaign
                  can be marked done regardless. Siraj's call: a hard block
                  strands work when a client is slow to send an asset. */}
              {completeness.length > 0 && (
                <section
                  className="aq-card"
                  style={{
                    padding: '12px 16px',
                    borderLeft: '3px solid var(--aq-warning, #b45309)',
                  }}
                >
                  <div style={{
                    fontSize: 13, fontWeight: 700,
                    color: 'var(--aq-warning, #b45309)', marginBottom: 6,
                  }}>
                    Still outstanding
                  </div>
                  <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {completeness.map((w) => (
                      <li key={w.key} style={{ fontSize: 12, color: 'var(--aq-text-secondary)' }}>
                        · {w.message}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {/* Purpose-built request subtask (quotation / invoice / contract).
                  Shows only what that subtask needs — no duplicated parent fields. */}
              {isRequestKind && (
                <RequestCard
                  task={task}
                  kind={kind!}
                  canRequest={canRequest}
                  canFulfill={canFulfill}
                  currentUserId={currentUserId}
                  onChanged={async () => { await refetchTask(); onChanged?.(); }}
                />
              )}

              {/* Fields — hidden on request subtasks (their fields live in the card above) */}
              {!isRequestKind && (
              <section className="aq-card" style={{ padding: 18 }}>
                <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Details</h3>
                {/* The sales half of a parent campaign. Sales (and admin) fill
                    these in directly here — the same fields are not repeated on
                    any subtask, so there's no double entry. */}
                {!isSubtaskView && canEditSales ? (
                  <>
                    <div style={SALES_ROW}>
                      <span style={SALES_LABEL}>Task name</span>
                      <TextInput
                        defaultValue={task.task_name ?? task.title ?? ''}
                        placeholder="Campaign name"
                        style={{ maxWidth: 360 }}
                        onCommit={(v) => {
                          const name = v.trim();
                          if (!name || name === (task.task_name ?? task.title)) return;
                          patchSalesFields({ task_name: name, title: name });
                        }}
                      />
                    </div>
                    <div style={SALES_ROW}>
                      <span style={SALES_LABEL}>Client</span>
                      <SearchablePicker
                        options={clients.map((c) => ({
                          value: c.id,
                          label: c.company_name,
                          hint: c.cr_number ? `CR ${c.cr_number}` : null,
                          keywords: c.vat_number,
                        }))}
                        value={task.client_id}
                        onChange={(v) => handleChangeClient(v ?? '')}
                        disabled={salesSaving}
                        placeholder="Search clients…"
                        emptyLabel="— No client —"
                      />
                    </div>
                    <div style={SALES_ROW}>
                      <span style={SALES_LABEL}>Brand</span>
                      <SearchablePicker
                        options={brands.map((b) => ({ value: b.id, label: b.brand_name }))}
                        value={task.brand_id}
                        onChange={(v) => handleChangeBrand(v ?? '')}
                        disabled={salesSaving || !task.client_id}
                        placeholder={task.client_id ? 'Search brands…' : 'Pick a client first'}
                        emptyLabel="— No brand —"
                      />
                    </div>
                    <div style={SALES_ROW}>
                      <span style={SALES_LABEL}>Sales closer</span>
                      <select
                        className="aq-input"
                        style={{ maxWidth: 360 }}
                        value={task.sales_closer_id ?? ''}
                        disabled={salesSaving}
                        onChange={(e) => patchSalesFields({ sales_closer_id: e.target.value || null })}
                      >
                        <option value="">— Unassigned —</option>
                        {profiles.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.full_name}{p.role ? ` (${p.role})` : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  </>
                ) : (
                  <>
                    <FieldRow label="Brand"        value={task.brand_name ?? '—'} />
                    <FieldRow label="Client"       value={task.legacy_client_id ?? '—'} />
                    <FieldRow label="Sales closer" value={closer?.full_name ?? '—'} />
                  </>
                )}
                <FieldRow label="Key account (owner)" value={ka?.full_name ?? '—'} />
                <FieldRow label="Priority"     value={task.priority} />
                <FieldRow label="Service types" value={
                  taskServiceTypes.length
                    ? taskServiceTypes.map((s) => `${s.icon ?? ''} ${s.name}`).join(', ')
                    : '—'
                } />
                <FieldRow label="Created"      value={new Date(task.created_at).toLocaleString()} />
                {task.completed_at && <FieldRow label="Completed" value={new Date(task.completed_at).toLocaleString()} />}

                {/* Editable budget */}
                <div style={{
                  display: 'grid', gridTemplateColumns: '140px 1fr', gap: 12,
                  padding: '6px 0', fontSize: 13, alignItems: 'center',
                }}>
                  <span style={{ color: 'var(--aq-text-muted)', fontWeight: 600 }}>Budget (SAR)</span>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    {canEditBudget ? (
                      <>
                        <input
                          className="aq-input"
                          style={{ maxWidth: 180 }}
                          value={budgetDraft}
                          onChange={(e) => setBudgetDraft(e.target.value)}
                          inputMode="decimal"
                          placeholder="0.00"
                        />
                        <button
                          type="button"
                          className="aq-btn aq-btn-secondary"
                          onClick={handleSaveBudget}
                          disabled={budgetSaving || (budgetDraft.trim() === (task.budget != null ? String(task.budget) : ''))}
                        >{budgetSaving ? 'Saving…' : 'Save'}</button>
                      </>
                    ) : (
                      <span style={{ color: 'var(--aq-text)' }}>
                        {task.budget != null ? `SAR ${Number(task.budget).toLocaleString()}` : '—'}
                      </span>
                    )}
                  </div>
                </div>

                {/* Per-subtask assignee (the "doer"). Hidden on parents — parents
                    use the multi-collaborator panel below. */}
                {isSubtaskView && (
                  <div style={{
                    display: 'grid', gridTemplateColumns: '140px 1fr', gap: 12,
                    padding: '6px 0', fontSize: 13, alignItems: 'center',
                  }}>
                    <span style={{ color: 'var(--aq-text-muted)', fontWeight: 600 }}>Assigned to</span>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      {canEditAssignee ? (
                        <select
                          className="aq-input"
                          style={{ maxWidth: 280 }}
                          value={task.assignee_id ?? ''}
                          onChange={(e) => handleChangeAssignee(e.target.value)}
                          disabled={assigneeSaving}
                        >
                          <option value="">— Unassigned —</option>
                          {profiles.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.full_name}{p.role ? ` (${p.role})` : ''}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span style={{ color: 'var(--aq-text)' }}>{subAssignee?.full_name ?? '—'}</span>
                      )}
                      {assigneeSaving && (
                        <span style={{ fontSize: 11, color: 'var(--aq-text-muted)' }}>Saving…</span>
                      )}
                    </div>
                  </div>
                )}

                {/* Per-subtask vendor (picked from the vendors table — not typeable).
                    When this is set AND budget > 0, the contract request auto-fires. */}
                {isSubtaskView && (
                  <div style={{
                    display: 'grid', gridTemplateColumns: '140px 1fr', gap: 12,
                    padding: '6px 0', fontSize: 13, alignItems: 'center',
                  }}>
                    <span style={{ color: 'var(--aq-text-muted)', fontWeight: 600 }}>Vendor</span>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      {canEditAssignee ? (
                        // Type-ahead, not a <select>: the vendor register runs
                        // to hundreds of rows and a dropdown can only jump by
                        // first letter. Matches on name, licence and ID at
                        // once — see vendorPickerOption.
                        <SearchablePicker
                          options={vendorOptions}
                          value={task.vendor_id != null ? String(task.vendor_id) : null}
                          onChange={(v) => handleChangeVendor(v ?? '')}
                          placeholder="Search by name, licence or ID…"
                          emptyLabel="— No vendor —"
                          disabled={vendorSaving || Boolean(task.contract_request_id)}
                        />
                      ) : (
                        <span style={{ color: 'var(--aq-text)' }}>
                          {vendors.find((v) => v.id === task.vendor_id)?.name ?? '—'}
                        </span>
                      )}
                      {vendorSaving && (
                        <span style={{ fontSize: 11, color: 'var(--aq-text-muted)' }}>Saving…</span>
                      )}
                      {task.contract_request_id && (
                        <span className="aq-badge aq-badge-success" style={{ fontSize: 11 }}>
                          Contract request sent
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {/* Description is sales's on a parent; read-only everywhere else. */}
                {!isSubtaskView && canEditSales ? (
                  <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--aq-border-light)' }}>
                    <div className="aq-label">Description / brief</div>
                    <textarea
                      className="aq-textarea"
                      rows={4}
                      style={{ marginTop: 4, width: '100%' }}
                      value={descDraft}
                      placeholder="What did the client actually ask for?"
                      onChange={(e) => setDescDraft(e.target.value)}
                    />
                    <div style={{ marginTop: 6 }}>
                      <button
                        type="button"
                        className="aq-btn aq-btn-secondary"
                        disabled={salesSaving || descDraft === (task.description ?? '')}
                        onClick={() => patchSalesFields({ description: descDraft.trim() || null })}
                        style={{ padding: '4px 12px', fontSize: 12 }}
                      >{salesSaving ? 'Saving…' : 'Save description'}</button>
                    </div>
                  </div>
                ) : task.description ? (
                  <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--aq-border-light)' }}>
                    <div className="aq-label">Description</div>
                    <p style={{ marginTop: 4, fontSize: 14, color: 'var(--aq-text-secondary)', whiteSpace: 'pre-wrap' }}>
                      {task.description}
                    </p>
                  </div>
                ) : null}
              </section>
              )}

              {/* ── Operations panel (migration 028) ───────────────────────
                  Per-vendor financial fields on subtasks; per-campaign
                  quotation / invoice / payment / contract on parents. Same
                  edit permissions as the Budget field above. Hidden on
                  request subtasks (quotation/invoice/contract). */}
              {!isRequestKind && (
              <OperationsPanel
                task={task}
                isSubtaskView={isSubtaskView}
                canEdit={canEditMarketing}
                taskSources={taskSources}
                clientCategories={clientCategories}
                taskPlatforms={taskPlatforms}
                subtasks={subtasks}
                parentTask={parentTask}
                onChanged={async () => { await refetchTask(); onChanged?.(); }}
              />
              )}

              {/* Multi-assignee panel — parent only.
                  Subtasks have a single "doer" picker above. */}
              {!isSubtaskView && (
                <TaskAssignees
                  taskId={task.id}
                  currentUserId={currentUserId}
                  role={role}
                  profiles={profiles}
                  canEdit={canEditMarketing}
                />
              )}

              {/* ── Client contract (Phase 6) ───────────────────────────
                  The campaign's contract with the CLIENT. Vendor contracts
                  are a per-subtask thing and auto-fire when a vendor + budget
                  are set, so they deliberately don't appear here. */}
              {!isSubtaskView && (
                <section className="aq-card" style={{ padding: 18 }}>
                  <div style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                    marginBottom: 12, gap: 12, flexWrap: 'wrap',
                  }}>
                    <h3 style={{ fontSize: 14, fontWeight: 700 }}>Client contract</h3>
                    <span className={`aq-badge ${
                      !latestClientContract ? 'aq-badge-muted'
                      : latestClientContract.status === 'generated' ? 'aq-badge-success'
                      : latestClientContract.status === 'approved' ? 'aq-badge-info'
                      : latestClientContract.status === 'pending' ? 'aq-badge-warning'
                      : 'aq-badge-muted'
                    }`}>
                      {latestClientContract ? latestClientContract.status : 'not requested'}
                    </span>
                  </div>

                  {latestClientContract ? (
                    <>
                      <FieldRow
                        label="Requested"
                        value={new Date(latestClientContract.created_at).toLocaleString()}
                      />
                      <FieldRow label="Client" value={latestClientContract.client_name ?? '—'} />
                      <FieldRow
                        label="Amount"
                        value={latestClientContract.amount != null
                          ? `SAR ${Number(latestClientContract.amount).toLocaleString()}`
                          : '—'}
                      />
                      {latestClientContract.generated_contract_id && (
                        <FieldRow label="Contract" value={latestClientContract.generated_contract_id} />
                      )}
                      {latestClientContract.notes && (
                        <FieldRow label="Notes" value={latestClientContract.notes} />
                      )}
                      {clientContractRequests.length > 1 && (
                        <p style={{ marginTop: 8, fontSize: 12, color: 'var(--aq-text-muted)' }}>
                          {clientContractRequests.length} client contract requests on this campaign —
                          the newest is shown. The rest are in the Contracts view.
                        </p>
                      )}
                    </>
                  ) : (
                    <p style={{ fontSize: 13, color: 'var(--aq-text-muted)' }}>
                      No client contract has been requested for this campaign yet.
                    </p>
                  )}

                  {/* What's stopping it going out. Shown before the button so
                      the answer is there when the button looks unavailable. */}
                  {canRequestContract && canRaiseClientContract && !clientReadiness.ready && (
                    <div style={{
                      marginTop: 12, padding: '10px 12px',
                      borderRadius: 'var(--aq-radius)',
                      background: 'var(--aq-bg-sunken)',
                      borderLeft: '3px solid var(--aq-warning, #b45309)',
                    }}>
                      <strong style={{ fontSize: 12, color: 'var(--aq-warning, #b45309)' }}>
                        Fill these in first
                      </strong>
                      <ul style={{ listStyle: 'none', marginTop: 5, display: 'flex', flexDirection: 'column', gap: 2 }}>
                        {clientReadiness.missing.map((m: MissingRequirement) => (
                          <li key={`${m.label}${m.where}`} style={{ fontSize: 12, color: 'var(--aq-text-secondary)' }}>
                            · <strong>{m.label}</strong>{m.where ? ` — ${m.where}` : ''}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    {canRequestContract && canRaiseClientContract && (
                      <button
                        type="button"
                        className="aq-btn aq-btn-primary"
                        disabled={!clientReadiness.ready || sendingClientContract}
                        title={clientReadiness.ready ? undefined : 'Some details are still missing'}
                        onClick={handleSendClientContract}
                        style={{ padding: '6px 12px', fontSize: 13 }}
                      >
                        {sendingClientContract ? 'Sending…'
                          : latestClientContract ? 'Request again'
                          : 'Request client contract'}
                      </button>
                    )}
                    {latestClientContract && !canRaiseClientContract && (
                      <span style={{ fontSize: 12, color: 'var(--aq-text-muted)' }}>
                        Legal has it. Approval and generation happen in the Contracts view.
                      </span>
                    )}
                  </div>

                  {/* ── Quotation / invoice ────────────────────────────
                      Raised against the campaign, not a subtask. Ops reads
                      the client, brand and amount live off this task when
                      they open the link, so nothing here goes stale. */}
                  <div style={{
                    marginTop: 14, paddingTop: 14,
                    borderTop: '1px solid var(--aq-border-light)',
                  }}>
                    <div className="aq-label" style={{ marginBottom: 8 }}>Quotation &amp; invoice</div>

                    {(['quotation', 'invoice'] as const).map((kind) => {
                      const open = openDocRequest(kind);
                      const issued = docRequests.filter(
                        (r) => r.doc_kind === kind && r.status === 'issued',
                      );
                      return (
                        <div
                          key={kind}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 8,
                            flexWrap: 'wrap', padding: '4px 0', fontSize: 13,
                          }}
                        >
                          <span style={{ width: 90, color: 'var(--aq-text-muted)', fontWeight: 600 }}>
                            {kind === 'quotation' ? 'Quotation' : 'Invoice'}
                          </span>

                          {open ? (
                            <>
                              <span className="aq-badge aq-badge-warning">requested</span>
                              <span style={{ fontSize: 12, color: 'var(--aq-text-muted)' }}>
                                {new Date(open.requested_at).toLocaleDateString()}
                              </span>
                              {canEditMarketing && (
                                <button
                                  type="button"
                                  className="aq-btn aq-btn-ghost"
                                  disabled={docBusy === kind}
                                  onClick={() => handleCancelDocRequest(open.id, kind)}
                                  style={{ padding: '2px 8px', fontSize: 12 }}
                                >Cancel</button>
                              )}
                            </>
                          ) : canEditMarketing ? (
                            <button
                              type="button"
                              className="aq-btn aq-btn-secondary"
                              disabled={docBusy === kind}
                              onClick={() => handleRequestDocument(kind)}
                              style={{ padding: '4px 10px', fontSize: 12 }}
                            >
                              {docBusy === kind ? 'Sending…' : `Request ${kind}`}
                            </button>
                          ) : (
                            <span style={{ fontSize: 12, color: 'var(--aq-text-muted)' }}>
                              not requested
                            </span>
                          )}

                          {issued.length > 0 && (
                            <span style={{ fontSize: 12, color: 'var(--aq-text-muted)' }}>
                              · issued {issued.map((r) => r.document_number).filter(Boolean).join(', ') || `${issued.length}×`}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}

              {/* ── Proof of posting (migration 048) ────────────────────
                  Lives on the campaign, not a subtask — one campaign, one
                  proof. Required in the sense that it's chased, not in the
                  sense that anything refuses to save without it. */}
              {!isSubtaskView && (
                <section className="aq-card" style={{ padding: 18 }}>
                  <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Proof of posting</h3>

                  <div style={SALES_ROW}>
                    <span style={SALES_LABEL}>Attached</span>
                    <label style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      cursor: canEditMarketing ? 'pointer' : 'default', fontSize: 13,
                    }}>
                      <input
                        type="checkbox"
                        checked={!!task.proof_of_posting_attached}
                        disabled={!canEditMarketing}
                        onChange={async (e) => {
                          try {
                            await updateTaskFields(task.id, {
                              proof_of_posting_attached: e.target.checked,
                            } as any);
                            await refetchTask();
                            onChanged?.();
                          } catch (err: any) { setError(err?.message ?? String(err)); }
                        }}
                        style={{ width: 15, height: 15 }}
                      />
                      <span style={{
                        fontWeight: 600,
                        color: task.proof_of_posting_attached
                          ? 'var(--aq-success, #15803d)' : 'var(--aq-text-muted)',
                      }}>
                        {task.proof_of_posting_attached ? 'Attached' : 'Not attached'}
                      </span>
                    </label>
                  </div>

                  <div style={SALES_ROW}>
                    <span style={SALES_LABEL}>File link</span>
                    {canEditMarketing ? (
                      <input
                        className="aq-input"
                        defaultValue={task.proof_of_posting_link ?? ''}
                        placeholder="https://drive.google.com/…"
                        onBlur={async (e) => {
                          const v = e.target.value.trim() || null;
                          if (v === (task.proof_of_posting_link ?? null)) return;
                          try {
                            await updateTaskFields(task.id, { proof_of_posting_link: v } as any);
                            await refetchTask();
                            onChanged?.();
                          } catch (err: any) { setError(err?.message ?? String(err)); }
                        }}
                      />
                    ) : task.proof_of_posting_link ? (
                      <a href={task.proof_of_posting_link} target="_blank" rel="noopener noreferrer">Open</a>
                    ) : <span style={{ fontSize: 13 }}>—</span>}
                  </div>
                </section>
              )}

              {/* ── Package (Phase 5) ───────────────────────────────────
                  The run window for the whole package, and nothing else.
                  Per-ad dates stay in the tracking sheet; per-ad vendor and
                  price stay on each vendor subtask. Marketing's half. */}
              {/* Dates apply to every campaign, not just Package Ads — the
                  old gate hid the run window on an Ad Hook until it had a
                  vendor. Always shown on a parent now. */}
              {!isSubtaskView && (
                <section className="aq-card" style={{ padding: 18 }}>
                  <div style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                    marginBottom: 12, gap: 12, flexWrap: 'wrap',
                  }}>
                    <h3 style={{ fontSize: 14, fontWeight: 700 }}>📅 Date</h3>
                    {/* How long it runs, worked out from the two dates rather
                        than stored — a duration that disagrees with its own
                        start and end is worse than no duration. */}
                    <span style={{ fontSize: 12, color: 'var(--aq-text-muted)' }}>
                      {runDurationLabel(task.package_start_date, task.package_end_date)}
                    </span>
                  </div>

                  <div style={SALES_ROW}>
                    <span style={SALES_LABEL}>Runs from</span>
                    {canEditMarketing ? (
                      <input
                        className="aq-input"
                        type="date"
                        style={{ maxWidth: 200 }}
                        value={task.package_start_date ?? ''}
                        disabled={packageSaving}
                        onChange={(e) => patchPackageFields({ package_start_date: e.target.value || null })}
                      />
                    ) : (
                      <span>{task.package_start_date ?? '—'}</span>
                    )}
                  </div>

                  <div style={SALES_ROW}>
                    <span style={SALES_LABEL}>Runs to</span>
                    {canEditMarketing ? (
                      <input
                        className="aq-input"
                        type="date"
                        style={{ maxWidth: 200 }}
                        value={task.package_end_date ?? ''}
                        min={task.package_start_date ?? undefined}
                        disabled={packageSaving}
                        onChange={(e) => patchPackageFields({ package_end_date: e.target.value || null })}
                      />
                    ) : (
                      <span>{task.package_end_date ?? '—'}</span>
                    )}
                  </div>

                  {/* "Number of ads" + "Save & create ads" used to live here.
                      Removed: the Add vendors popup does that job properly —
                      it sets ad type, platform and price for the batch, which
                      a bare number never could. Two ways to create the same
                      rows is one too many. */}
                </section>
              )}

              {/* Subtasks list — clickable rows, no checklist.
                  Only shown on the parent (subtasks don't currently have grandchildren). */}
              {!isSubtaskView && (
                <section className="aq-card" style={{ padding: 18 }}>
                  <div style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12,
                    gap: 12, flexWrap: 'wrap',
                  }}>
                    <h3 style={{ fontSize: 14, fontWeight: 700 }}>
                      {subtasks.length === 0
                        ? 'Subtasks'
                        : `Subtasks (${subtasks.filter((s) => s.status === 'done').length} of ${subtasks.length} done)`}
                    </h3>
                    {subtasks.length > 0 && (
                      <span style={{ fontSize: 12, color: 'var(--aq-text-muted)' }}>
                        Distributed: <strong style={{ color: 'var(--aq-text)' }}>SAR {subtaskBudgetSum.toLocaleString()}</strong>
                        {parentBudget > 0 && (
                          <> of SAR {parentBudget.toLocaleString()} ·{' '}
                            <span style={{
                              color: variance < 0 ? 'var(--aq-error)' : variance > 0 ? 'var(--aq-warning, #b45309)' : 'var(--aq-text-muted)',
                            }}>
                              {variance === 0 ? 'fully allocated'
                                : variance > 0 ? `SAR ${variance.toLocaleString()} unallocated`
                                : `SAR ${Math.abs(variance).toLocaleString()} over budget`}
                            </span>
                          </>
                        )}
                      </span>
                    )}
                  </div>

                  {/* Add a single subtask without re-triaging the campaign. */}
                  {canEditMarketing && (
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
                      marginBottom: 12, paddingBottom: 12,
                      borderBottom: '1px solid var(--aq-border-light)',
                    }}>
                      <select
                        className="aq-input"
                        value={addKind}
                        disabled={addingSubtask}
                        onChange={(e) => setAddKind(e.target.value as SubtaskKind | '')}
                        style={{ width: 'auto', minWidth: 200, padding: '6px 10px', fontSize: 13 }}
                        aria-label="Subtask type to add"
                      >
                        <option value="">Add a subtask…</option>
                        {offeredKinds.map((k) => {
                          // Vendor is the only kind you can have several of.
                          const taken = isSingletonSubtaskKind(k) && existingSubtaskKinds.has(k);
                          return (
                            <option key={k} value={k} disabled={taken}>
                              {SUBTASK_KIND_LABELS[k]}{taken ? ' — already added' : ''}
                            </option>
                          );
                        })}
                      </select>

                      <button
                        type="button"
                        className="aq-btn aq-btn-primary"
                        disabled={!addKind || addingSubtask}
                        onClick={() => handleAddSubtask()}
                        style={{ padding: '6px 12px', fontSize: 13 }}
                      >
                        {addingSubtask ? 'Adding…'
                          : addKind === 'vendor' ? '+ Add vendors…'
                          : '+ Add subtask'}
                      </button>
                    </div>
                  )}

                  {subtasks.length === 0 && (
                    <p style={{ fontSize: 13, color: 'var(--aq-text-muted)' }}>
                      {canEditMarketing
                        ? 'No vendors yet. Add one above, or set the ad quantity on the package to spawn them.'
                        : 'No subtasks yet.'}
                    </p>
                  )}

                  {/* Rows counting down to deletion, with a way back. */}
                  {pendingSubtaskDeletes.map((p) => (
                    <div
                      key={p.id}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        gap: 8, marginBottom: 6, padding: '8px 12px',
                        borderRadius: 'var(--aq-radius)',
                        background: 'var(--aq-bg-sunken)',
                        border: '1px dashed var(--aq-border)',
                      }}
                    >
                      <span style={{ fontSize: 13, color: 'var(--aq-text-muted)' }}>
                        Removed <strong>{p.title}</strong>
                      </span>
                      <button
                        type="button"
                        className="aq-btn aq-btn-secondary"
                        onClick={() => undoRemoveSubtask(p.id)}
                        style={{ padding: '3px 12px', fontSize: 12 }}
                      >Undo</button>
                    </div>
                  ))}

                  {visibleSubtasks.length > 0 && (
                    <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {visibleSubtasks.map((s) => {
                        const done = s.status === 'done';
                        const sa = s.assignee_id ? profileById.get(s.assignee_id) : null;
                        const removing = removingSubtaskId === s.id;
                        return (
                          <li key={s.id} style={{
                            display: 'flex', alignItems: 'center', gap: 6,
                            borderRadius: 'var(--aq-radius)',
                            background: done ? 'var(--aq-accent-light)' : 'var(--aq-bg-sunken)',
                            border: '1px solid var(--aq-border-light)',
                            opacity: removing ? 0.5 : 1,
                          }}>
                            <button
                              type="button"
                              onClick={() => setCurrentTaskId(s.id)}
                              style={{
                                flex: 1, minWidth: 0, textAlign: 'left',
                                display: 'flex', alignItems: 'center', gap: 10,
                                padding: '10px 12px',
                                background: 'transparent', border: 'none',
                                font: 'inherit', color: 'inherit',
                                cursor: 'pointer',
                              }}
                            >
                              <span style={{
                                flex: 1, minWidth: 0, fontSize: 14,
                                textDecoration: done ? 'line-through' : 'none',
                                color: done ? 'var(--aq-text-muted)' : 'var(--aq-text)',
                                fontWeight: 600,
                                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                              }}>{s.title}</span>
                              {s.budget != null && (
                                <span style={{ fontSize: 11, color: 'var(--aq-text-muted)' }}>
                                  SAR {Number(s.budget).toLocaleString()}
                                </span>
                              )}
                              <span style={{ fontSize: 11, color: 'var(--aq-text-muted)' }}>
                                {sa?.full_name ?? 'Unassigned'}
                              </span>
                              <span className={`aq-badge ${done ? 'aq-badge-success' : 'aq-badge-muted'}`}>
                                {done ? 'done' : s.status}
                              </span>
                              <span aria-hidden style={{ fontSize: 13, color: 'var(--aq-text-muted)' }}>›</span>
                            </button>
                            {canEditMarketing && (
                              <button
                                type="button"
                                className="aq-btn aq-btn-ghost"
                                disabled={removing || addingSubtask}
                                onClick={() => handleRemoveSubtask({ id: s.id, title: s.title })}
                                style={{ padding: '4px 8px', fontSize: 12, marginRight: 6 }}
                                aria-label={`Remove subtask ${s.title}`}
                                title="Remove subtask"
                              >{removing ? '…' : '✕'}</button>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}

                  {subtasks.length > 0 && (
                    <p style={{ marginTop: 10, fontSize: 12, color: 'var(--aq-text-muted)' }}>
                      Click a subtask to open it — each has its own files, comments, budget, and assignee.
                    </p>
                  )}
                </section>
              )}

              {/* Files */}
              <section className="aq-card" style={{ padding: 18 }}>
                <div style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                  marginBottom: 12, gap: 12,
                }}>
                  <h3 style={{ fontSize: 14, fontWeight: 700 }}>
                    Files ({attachments.length})
                  </h3>
                  {canAttach && (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <input
                        ref={fileInputRef}
                        type="file"
                        style={{ display: 'none' }}
                        onChange={(e) => handleFilePicked(e.target.files?.[0] ?? null)}
                      />
                      <button
                        type="button"
                        className="aq-btn aq-btn-primary"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={busy}
                      >{busy ? 'Uploading…' : 'Upload file'}</button>
                    </div>
                  )}
                </div>
                {attachments.length === 0 && (
                  <p style={{ fontSize: 13, color: 'var(--aq-text-muted)' }}>
                    No files yet. Click <strong>Upload file</strong> above to attach one.
                  </p>
                )}
                <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {attachments.map((a) => {
                    const canRemove = a.uploader_id === currentUserId || isPrivileged;
                    return (
                      <li key={a.id} style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '8px 12px', borderRadius: 'var(--aq-radius)',
                        background: 'var(--aq-bg-sunken)',
                      }}>
                        <span aria-hidden style={{ fontSize: 18 }}>📎</span>
                        <button
                          type="button"
                          onClick={() => handleOpenAttachment(a)}
                          style={{
                            flex: 1, fontSize: 14, color: 'var(--aq-accent)',
                            background: 'none', border: 'none', padding: 0,
                            cursor: 'pointer', textAlign: 'left',
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          }}
                        >{a.filename}</button>
                        <span style={{ fontSize: 11, color: 'var(--aq-text-muted)' }}>
                          {new Date(a.created_at).toLocaleDateString()}
                        </span>
                        {canRemove && (
                          <button
                            type="button"
                            className="aq-btn aq-btn-ghost"
                            disabled={busy}
                            onClick={() => handleDeleteAttachment(a.id)}
                            style={{ padding: '4px 8px', fontSize: 12 }}
                            aria-label="Remove attachment"
                          >✕</button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>

              {/* Comments */}
              <section className="aq-card" style={{ padding: 18 }}>
                <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>
                  Comments ({comments.length})
                </h3>
                {comments.length === 0 && (
                  <p style={{ fontSize: 13, color: 'var(--aq-text-muted)' }}>
                    Be the first to comment.
                  </p>
                )}
                <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
                  {comments.map((c) => {
                    const author = displayName(c.author ?? profileById.get(c.author_id));
                    const canRemove = c.author_id === currentUserId || isPrivileged;
                    return (
                      <li key={c.id} style={{
                        padding: '10px 12px', borderRadius: 'var(--aq-radius)',
                        background: 'var(--aq-bg-sunken)',
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                          <strong style={{ fontSize: 13 }}>{author}</strong>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 11, color: 'var(--aq-text-muted)' }}>
                              {new Date(c.created_at).toLocaleString()}
                            </span>
                            {canRemove && (
                              <button
                                type="button"
                                className="aq-btn aq-btn-ghost"
                                onClick={() => handleDeleteComment(c.id)}
                                disabled={busy}
                                style={{ padding: '2px 6px', fontSize: 11 }}
                                aria-label="Delete comment"
                              >✕</button>
                            )}
                          </div>
                        </div>
                        <p style={{ marginTop: 4, fontSize: 14, whiteSpace: 'pre-wrap' }}>
                          {/* Mentions resolve to the name that person has NOW,
                              not whatever they were called when it was typed. */}
                          <CommentText segments={parseCommentSegments(c.content, mentionNames)} />
                        </p>
                      </li>
                    );
                  })}
                </ul>
                {canComment && (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    <MentionBox
                      value={commentText}
                      onChange={setCommentText}
                      onSubmit={handleAddComment}
                      people={profiles}
                      disabled={busy}
                    />
                    <button
                      type="button"
                      className="aq-btn aq-btn-primary"
                      onClick={handleAddComment}
                      disabled={busy || !commentText.trim()}
                    >Send</button>
                  </div>
                )}
              </section>
            </div>

            {requestOpen && (
              <RequestContractModal
                task={task}
                currentUserId={currentUserId}
                onClose={() => setRequestOpen(false)}
                defaultKind={requestKind}
                onCreated={async () => {
                  setRequestOpen(false);
                  await refetchContractRequests();
                  onChanged?.();
                }}
              />
            )}

            {trackingOpen && (
              <TrackingSheetPanel
                taskId={task.id}
                taskTitle={task.task_name || task.title}
                brandName={task.brand_name}
                role={role}
                onClose={() => setTrackingOpen(false)}
              />
            )}

            {addVendorsOpen && task.workspace_id && (
              <AddVendorsModal
                open={addVendorsOpen}
                onClose={() => setAddVendorsOpen(false)}
                parentTaskId={task.id}
                workspaceId={task.workspace_id}
                currentUserId={currentUserId}
                brandName={task.brand_name}
                priority={task.priority}
                existingVendorCount={vendorSubtasks.length}
                taskPlatforms={taskPlatforms}
                onCreated={async (count, trackable) => {
                  // Influencer / UGC batches need the sheet on, otherwise
                  // ensureTrackingRowForVendor no-ops when the vendors are
                  // assigned and the rows never appear.
                  if (trackable && !task.has_tracking) {
                    try {
                      await updateTaskFields(task.id, { has_tracking: true } as any);
                    } catch { /* the vendors matter more than the sheet flag */ }
                  }
                  setAddKind('');
                  await refetchSubs();
                  await refetchTask();
                  onChanged?.();
                  setPublishNote(`${count} vendor${count === 1 ? '' : 's'} added.`);
                }}
              />
            )}
          </>
        )}
      </aside>
    </div>
  );
}

function FieldRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '140px 1fr', gap: 12,
      padding: '6px 0', fontSize: 13,
    }}>
      <span style={{ color: 'var(--aq-text-muted)', fontWeight: 600 }}>{label}</span>
      <span style={{ color: 'var(--aq-text)' }}>{value}</span>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   RequestCard
   Lean layout for "request-only" subtasks: quotation, invoice, contract.
   - Quotation / Invoice: a number field + a Request button + file upload
     (uploads go through the shared Files section below the card).
   - Contract: request only (no number).
   The Request button flips request_status not_requested → requested →
   fulfilled. A DB trigger notifies Ops/admin when it becomes "requested".
   ───────────────────────────────────────────────────────────────────── */
function RequestCard({
  task, kind, canRequest, canFulfill, currentUserId, onChanged,
}: {
  task: PMTask;
  kind: string;
  canRequest: boolean;
  canFulfill: boolean;
  currentUserId: string;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(task.request_note ?? '');
  useEffect(() => { setNote(task.request_note ?? ''); }, [task.id]);

  const status = task.request_status ?? 'not_requested';
  const label = kind === 'quotation' ? 'Quotation' : kind === 'invoice' ? 'Invoice' : 'Contract';
  const numberField: 'quotation_no' | 'invoice_no' | null =
    kind === 'quotation' ? 'quotation_no' : kind === 'invoice' ? 'invoice_no' : null;
  const numberValue = numberField ? ((task as any)[numberField] ?? '') : '';

  const setStatus = async (next: string) => {
    setBusy(true);
    try {
      const patch: any = { request_status: next };
      if (next === 'requested') {
        patch.requested_at = new Date().toISOString();
        patch.requested_by = currentUserId;
      }
      if (note.trim() !== (task.request_note ?? '')) patch.request_note = note.trim() || null;
      await updateTaskFields(task.id, patch);
      await onChanged();
    } catch (e: any) { window.alert(`Failed: ${e?.message ?? e}`); }
    finally { setBusy(false); }
  };

  const saveNumber = async (v: string) => {
    if (!numberField) return;
    try {
      await updateTaskFields(task.id, { [numberField]: v.trim() || null } as any);
      await onChanged();
    } catch (e: any) { window.alert(`Save failed: ${e?.message ?? e}`); }
  };

  const canEditFields = canRequest || canFulfill;

  return (
    <section className="aq-card" style={{ padding: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700 }}>{label} request</h3>
        <span className={`aq-badge ${
          status === 'fulfilled' ? 'aq-badge-success'
          : status === 'requested' ? 'aq-badge-warning'
          : 'aq-badge-muted'
        }`}>
          {status === 'fulfilled' ? 'Fulfilled' : status === 'requested' ? 'Requested' : 'Not requested'}
        </span>
      </div>

      {numberField && (
        <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: 12, padding: '6px 0', fontSize: 13, alignItems: 'center' }}>
          <span style={{ color: 'var(--aq-text-muted)', fontWeight: 600 }}>{label} #</span>
          {canEditFields
            ? <TextInput
                defaultValue={String(numberValue)}
                placeholder={kind === 'quotation' ? 'QT-2026-…' : 'INV-…'}
                onCommit={saveNumber}
                style={{ maxWidth: 240 }}
              />
            : <span>{numberValue || '—'}</span>}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: 12, padding: '6px 0', fontSize: 13, alignItems: 'start' }}>
        <span style={{ color: 'var(--aq-text-muted)', fontWeight: 600 }}>Note</span>
        {canEditFields
          ? <textarea
              className="aq-textarea"
              style={{ minHeight: 52 }}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional note for the team handling this request"
            />
          : <span style={{ whiteSpace: 'pre-wrap' }}>{task.request_note || '—'}</span>}
      </div>

      {task.requested_at && (
        <p style={{ fontSize: 12, color: 'var(--aq-text-muted)', marginTop: 4 }}>
          Requested {new Date(task.requested_at).toLocaleString()}
        </p>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        {status === 'not_requested' && canRequest && (
          <button type="button" className="aq-btn aq-btn-primary" disabled={busy} onClick={() => setStatus('requested')}>
            Send {label.toLowerCase()} request
          </button>
        )}
        {status === 'requested' && canFulfill && (
          <button type="button" className="aq-btn aq-btn-primary" disabled={busy} onClick={() => setStatus('fulfilled')}>
            Mark fulfilled
          </button>
        )}
        {status === 'requested' && canRequest && (
          <button type="button" className="aq-btn aq-btn-ghost" disabled={busy} onClick={() => setStatus('not_requested')}>
            Cancel request
          </button>
        )}
        {status === 'fulfilled' && canEditFields && (
          <button type="button" className="aq-btn aq-btn-ghost" disabled={busy} onClick={() => setStatus('requested')}>
            Reopen
          </button>
        )}
      </div>

      <p style={{ fontSize: 12, color: 'var(--aq-text-muted)', marginTop: 12 }}>
        {kind === 'contract'
          ? 'Request only — the signed contract is handled by the operations team.'
          : `Upload the ${label.toLowerCase()} file in the Files section below.`}
      </p>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   OperationsPanel
   Edits the migration-028 operations columns. One section that swaps its
   fields based on whether we're looking at a parent campaign or a vendor
   subtask. Each field saves on blur (text/number) or change (select/date).
   ───────────────────────────────────────────────────────────────────── */

import type { PMTask, TaskSource, ClientCategory } from '@/hooks/use-workflow';

function OperationsPanel({
  task, isSubtaskView, canEdit, taskSources, clientCategories, taskPlatforms, subtasks,
  parentTask, onChanged,
}: {
  task: PMTask;
  isSubtaskView: boolean;
  canEdit: boolean;
  taskSources: TaskSource[];
  clientCategories: ClientCategory[];
  taskPlatforms: TaskSource[];
  /** Vendor lines — the campaign money block is rolled up from these. */
  subtasks: PMTask[];
  /** Null on a parent row. The analysis report reads brand/name/platforms off it. */
  parentTask: PMTask | null;
  onChanged: () => Promise<void>;
}) {
  // Generic field saver — writes `{ [field]: value }` to pm_tasks and
  // refetches the row. Null-coerced empties so a cleared field actually
  // becomes NULL in the DB, not the string "".
  const save = async (field: keyof PMTask, raw: any) => {
    const value =
      raw === '' || raw === undefined ? null :
      raw;
    try {
      await updateTaskFields(task.id, { [field]: value } as any);
      await onChanged();
    } catch (e: any) {
      window.alert(`Save failed: ${e?.message ?? e}`);
    }
  };

  const money = rollupCampaignMoney(subtasks);
  const budgetNum = Number(task.budget) || 0;

  const numberOrNull = (raw: string): number | null => {
    const trimmed = raw.trim().replace(/,/g, '');
    if (!trimmed) return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  };

  // Render a single labeled row with a generic editor. `kind` switches
  // between inline-editable text/number/date/select. Read-only fall-back
  // when canEdit=false.
  const Row = ({
    label, children,
  }: { label: string; children: React.ReactNode }) => (
    <div style={{
      display: 'grid', gridTemplateColumns: '160px 1fr', gap: 12,
      padding: '6px 0', fontSize: 13, alignItems: 'center',
    }}>
      <span style={{ color: 'var(--aq-text-muted)', fontWeight: 600 }}>{label}</span>
      <div>{children}</div>
    </div>
  );

  const fmtMoney = (n: number | null | undefined) =>
    n == null ? '—' : `SAR ${Number(n).toLocaleString()}`;

  /** "Attached or not" — the same control on four different cards. */
  const Attached = ({
    value, onToggle, yes = 'Attached', no = 'Not attached',
  }: { value: boolean; onToggle: (v: boolean) => void; yes?: string; no?: string }) => (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: canEdit ? 'pointer' : 'default' }}>
      <input
        type="checkbox"
        checked={!!value}
        disabled={!canEdit}
        onChange={(e) => onToggle(e.target.checked)}
        style={{ width: 15, height: 15 }}
      />
      <span style={{
        fontWeight: 600,
        color: value ? 'var(--aq-success, #15803d)' : 'var(--aq-text-muted)',
      }}>{value ? yes : no}</span>
    </label>
  );

  const subKind = task.subtask_kind;

  // ── ANALYSIS REPORT (subtask) ─────────────────────────────────────
  // Brand, campaign name and platforms are read through to the parent
  // rather than copied, so renaming the campaign renames it here too.
  if (isSubtaskView && subKind === 'analysis_report') {
    const inherited = analysisReportInherited(parentTask);
    const platforms = effectiveAnalysisPlatforms(task, parentTask);
    return (
      <section className="aq-card" style={{ padding: 18 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Analysis Report</h3>

        <Row label="Priority">
          {/* Deliberately NOT inherited from the parent — Siraj's call. A
              report on an urgent campaign is not automatically urgent. */}
          {canEdit
            ? <select
                className="aq-select"
                style={{ maxWidth: 200 }}
                value={task.priority}
                onChange={(e) => save('priority', e.target.value)}
              >
                {(['urgent','high','medium','low','none'] as const).map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            : <span>{task.priority}</span>}
        </Row>

        <Row label="Complexity">
          {canEdit
            ? <select
                className="aq-select"
                style={{ maxWidth: 200 }}
                value={task.complexity ?? ''}
                onChange={(e) => save('complexity', e.target.value || null)}
              >
                <option value="">—</option>
                {COMPLEXITIES.map((c) => (
                  <option key={c} value={c}>{c[0].toUpperCase() + c.slice(1)}</option>
                ))}
              </select>
            : <span>{task.complexity ?? '—'}</span>}
        </Row>

        <Row label="Approval status">
          {canEdit
            ? <select
                className="aq-select"
                style={{ maxWidth: 220 }}
                value={task.approval_stage ?? ''}
                onChange={(e) => save('approval_stage', e.target.value || null)}
              >
                <option value="">—</option>
                {APPROVAL_STAGES.map((a) => <option key={a} value={a}>{labelFor(a)}</option>)}
              </select>
            : <span>{labelFor(task.approval_stage)}</span>}
        </Row>

        <Row label="Brand">
          <span style={{ color: 'var(--aq-text-muted)' }}>
            {inherited.brandName || '—'}
            <span style={{ marginLeft: 8, fontSize: 11 }}>from the campaign</span>
          </span>
        </Row>

        <Row label="Campaign name">
          <span style={{ color: 'var(--aq-text-muted)' }}>
            {inherited.campaignName || '—'}
            <span style={{ marginLeft: 8, fontSize: 11 }}>from the campaign</span>
          </span>
        </Row>

        <Row label="Brand logo">
          <Attached
            value={task.brand_logo_attached}
            onToggle={(v) => save('brand_logo_attached', v)}
          />
        </Row>

        <Row label="Campaign platform">
          {/* Starts as the campaign's list; narrow or extend it here. */}
          {canEdit
            ? <MultiSelect
                options={taskPlatforms.map((p) => p.name)}
                selected={platforms}
                onChange={(next) => save('platforms', next)}
              />
            : <span>{platforms.length ? platforms.join(', ') : '—'}</span>}
        </Row>
        {canEdit && (task.platforms ?? []).length === 0 && platforms.length > 0 && (
          <div style={{ fontSize: 11, color: 'var(--aq-text-muted)', paddingLeft: 172, marginTop: -4 }}>
            Inherited from the campaign. Changing it here overrides it for this report only.
          </div>
        )}

        <Row label="Media type">
          {canEdit
            ? <select
                className="aq-select"
                style={{ maxWidth: 220 }}
                value={task.media_type ?? ''}
                onChange={(e) => save('media_type', e.target.value || null)}
              >
                <option value="">—</option>
                {MEDIA_TYPES.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            : <span>{task.media_type ?? '—'}</span>}
        </Row>

        <Row label="Keyword data (Excel)">
          <Attached
            value={task.keyword_excel_attached}
            onToggle={(v) => save('keyword_excel_attached', v)}
          />
        </Row>

        <Row label="Data issues">
          {canEdit
            ? <TextInput
                defaultValue={task.data_issue_note ?? ''}
                placeholder="Missing data or adjustment needed"
                onCommit={(v) => save('data_issue_note', v.trim() || null)}
              />
            : <span>{task.data_issue_note || '—'}</span>}
        </Row>
      </section>
    );
  }

  // ── SIMPLE DELIVERABLES (subtask) ─────────────────────────────────
  // Campaign design, marketing strategy, visuals, blueprint / 3D.
  // Status, due date, attached-or-not. Nothing else, on purpose —
  // adding a field here is a decision, not a tidy-up.
  if (isSubtaskView && isSimpleDeliverableKind(subKind)) {
    return (
      <section className="aq-card" style={{ padding: 18 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>
          {SUBTASK_KIND_LABELS[subKind as SubtaskKind] ?? 'Deliverable'}
        </h3>

        <Row label="Status">
          {canEdit
            ? <select
                className="aq-select"
                style={{ maxWidth: 200 }}
                value={task.status}
                onChange={(e) => save('status', e.target.value)}
              >
                {TASK_STATUSES.map((s) => <option key={s} value={s}>{labelFor(s)}</option>)}
              </select>
            : <span>{labelFor(task.status)}</span>}
        </Row>

        <Row label="Due date">
          {canEdit
            ? <input
                type="date"
                className="aq-input"
                style={{ maxWidth: 200 }}
                defaultValue={task.due_date ?? ''}
                onChange={(e) => save('due_date', e.target.value || null)}
              />
            : <span>{task.due_date || '—'}</span>}
        </Row>

        <Row label="File">
          <Attached
            value={task.deliverable_attached}
            onToggle={(v) => save('deliverable_attached', v)}
          />
        </Row>
      </section>
    );
  }

  // PER-VENDOR (subtask) fields ───────────────────────────────────────
  if (isSubtaskView) {
    return (
      <section className="aq-card" style={{ padding: 18 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Operations · Vendor</h3>

        <Row label="Price (SAR)">
          {canEdit
            ? <TextInput
                defaultValue={task.price != null ? String(task.price) : ''}
                placeholder="0.00"
                inputMode="decimal"
                onCommit={(v) => save('price', numberOrNull(v))}
                style={{ maxWidth: 200 }}
              />
            : <span>{fmtMoney(task.price)}</span>}
        </Row>

        <Row label="Net amount (SAR)">
          {canEdit
            ? <TextInput
                defaultValue={task.net_amount != null ? String(task.net_amount) : ''}
                placeholder="0.00"
                inputMode="decimal"
                onCommit={(v) => save('net_amount', numberOrNull(v))}
                style={{ maxWidth: 200 }}
              />
            : <span>{fmtMoney(task.net_amount)}</span>}
        </Row>

        <Row label="AQ Gross">
          {/* Generated column: read-only. Falls back to "—" until both
              price and net_amount are entered. */}
          <span style={{
            fontWeight: 600,
            color: task.aq_gross != null && Number(task.aq_gross) < 0
              ? 'var(--aq-error)' : 'var(--aq-text)',
          }}>
            {fmtMoney(task.aq_gross)}
            {task.aq_gross != null && task.price != null && Number(task.price) > 0 && (
              <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--aq-text-muted)' }}>
                ({Math.round((Number(task.aq_gross) / Number(task.price)) * 100)}% margin)
              </span>
            )}
          </span>
        </Row>

        <Row label="Platform">
          {canEdit
            ? <TextInput
                defaultValue={task.platform ?? ''}
                placeholder="Instagram, TikTok"
                onCommit={(v) => save('platform', v.trim() || null)}
              />
            : <span>{task.platform || '—'}</span>}
        </Row>

        <Row label="AD type">
          {canEdit
            ? <TextInput
                defaultValue={task.ad_type ?? ''}
                placeholder="VideoShot"
                onCommit={(v) => save('ad_type', v.trim() || null)}
              />
            : <span>{task.ad_type || '—'}</span>}
        </Row>

        <Row label="Vendor paid (SAR)">
          {canEdit
            ? <TextInput
                defaultValue={task.vendor_payment_amount != null ? String(task.vendor_payment_amount) : ''}
                placeholder="0.00"
                inputMode="decimal"
                onCommit={(v) => save('vendor_payment_amount', numberOrNull(v))}
                style={{ maxWidth: 200 }}
              />
            : <span>{fmtMoney(task.vendor_payment_amount)}</span>}
        </Row>

        <Row label="Vendor paid on">
          {canEdit
            ? <input
                type="date"
                className="aq-input"
                style={{ maxWidth: 200 }}
                defaultValue={task.vendor_payment_date ?? ''}
                onChange={(e) => save('vendor_payment_date', e.target.value || null)}
              />
            : <span>{task.vendor_payment_date || '—'}</span>}
        </Row>

        {/* ── Insight ────────────────────────────────────────────────
            Not a subtask of its own — it belongs to the vendor whose
            work it analyses, so it rides here as a link plus a flag. */}
        <div style={{
          marginTop: 12, paddingTop: 12,
          borderTop: '1px solid var(--aq-border-light)',
        }}>
          <div className="aq-label" style={{ marginBottom: 4 }}>Insight</div>

          <Row label="File link">
            {canEdit
              ? <TextInput
                  defaultValue={task.insight_link ?? ''}
                  placeholder="https://drive.google.com/…"
                  onCommit={(v) => save('insight_link', v.trim() || null)}
                />
              : task.insight_link
                ? <a href={task.insight_link} target="_blank" rel="noopener noreferrer">Open</a>
                : <span>—</span>}
          </Row>

          <Row label="Insight file">
            <Attached
              value={task.insight_attached}
              onToggle={(v) => save('insight_attached', v)}
            />
          </Row>
        </div>
      </section>
    );
  }

  // PER-CAMPAIGN (parent) fields ──────────────────────────────────────
  return (
    <section className="aq-card" style={{ padding: 18 }}>
      <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Operations · Campaign</h3>

      <Row label="Source">
        {canEdit
          ? <select
              className="aq-input"
              style={{ maxWidth: 240 }}
              value={task.source_id ?? ''}
              onChange={(e) => save('source_id', e.target.value || null)}
            >
              <option value="">— None —</option>
              {taskSources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          : <span>{taskSources.find((s) => s.id === task.source_id)?.name || '—'}</span>}
      </Row>

      <Row label="Client category">
        {canEdit
          ? <select
              className="aq-input"
              style={{ maxWidth: 240 }}
              value={task.client_category_id ?? ''}
              onChange={(e) => save('client_category_id', e.target.value || null)}
            >
              <option value="">— None —</option>
              {clientCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          : <span>{clientCategories.find((c) => c.id === task.client_category_id)?.name || '—'}</span>}
      </Row>

      <Row label="Platform">
        {canEdit ? (
          <MultiSelect
            options={taskPlatforms.map((p) => p.name)}
            selected={task.platforms ?? []}
            onChange={(next) => save('platforms', next)}
          />
        ) : (
          <span>{(task.platforms ?? []).join(', ') || '—'}</span>
        )}
      </Row>

      <Row label="Ad type">
        {canEdit ? (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <select
              className="aq-input"
              style={{ maxWidth: 200 }}
              value={task.ad_type ?? ''}
              onChange={(e) => {
                const v = e.target.value || null;
                // Switching away from Multi Service clears the detail, so a
                // stale description can't linger on a Home Ad.
                if (v !== AD_TYPE_NEEDS_DETAIL && task.ad_type_custom) {
                  updateTaskFields(task.id, { ad_type: v, ad_type_custom: null } as any)
                    .then(onChanged)
                    .catch((err: any) => window.alert(`Save failed: ${err?.message ?? err}`));
                } else {
                  save('ad_type', v);
                }
              }}
            >
              <option value="">— None —</option>
              {AD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            {task.ad_type === AD_TYPE_NEEDS_DETAIL && (
              <TextInput
                defaultValue={task.ad_type_custom ?? ''}
                placeholder="Which services? (required)"
                onCommit={(v) => save('ad_type_custom', v.trim() || null)}
                style={{ maxWidth: 280 }}
              />
            )}
          </div>
        ) : (
          <span>
            {task.ad_type
              ? task.ad_type + (task.ad_type_custom ? ` — ${task.ad_type_custom}` : '')
              : '—'}
          </span>
        )}
      </Row>
      {canEdit && task.ad_type === AD_TYPE_NEEDS_DETAIL && !task.ad_type_custom && (
        <Row label="">
          <span style={{ fontSize: 12, color: 'var(--aq-warning, #b45309)' }}>
            Multi Service needs the services written out.
          </span>
        </Row>
      )}

      <Row label="Approval stage">
        {canEdit
          ? <select
              className="aq-input"
              style={{ maxWidth: 240 }}
              value={task.approval_stage ?? ''}
              onChange={(e) => save('approval_stage', e.target.value || null)}
            >
              <option value="">— None —</option>
              {APPROVAL_STAGES.map((a) => <option key={a} value={a}>{labelFor(a)}</option>)}
            </select>
          : <span>{labelFor(task.approval_stage)}</span>}
      </Row>

      <Row label="Task status">
        {canEdit
          ? <select
              className="aq-input"
              style={{ maxWidth: 240 }}
              value={task.status ?? ''}
              onChange={(e) => save('status', e.target.value || null)}
            >
              {TASK_STATUSES.map((st) => <option key={st} value={st}>{labelFor(st)}</option>)}
            </select>
          : <span>{labelFor(task.status)}</span>}
      </Row>

      <Row label="Quotation #">
        <StringList
          values={task.quotation_numbers ?? []}
          canEdit={canEdit}
          placeholder="QT-2026-…"
          onChange={(next) => save('quotation_numbers', next)}
        />
      </Row>

      <Row label="Quo. breakdown">
        {canEdit
          ? <select
              className="aq-input"
              style={{ maxWidth: 240 }}
              value={task.quotation_breakdown ?? ''}
              onChange={(e) => save('quotation_breakdown', e.target.value || null)}
            >
              <option value="">— None —</option>
              <option value="With Breakdown">With Breakdown</option>
              <option value="Without Breakdown">Without Breakdown</option>
            </select>
          : <span>{task.quotation_breakdown || '—'}</span>}
      </Row>

      <Row label="Invoice #">
        <StringList
          values={task.invoice_numbers ?? []}
          canEdit={canEdit}
          placeholder="INV-…"
          onChange={(next) => save('invoice_numbers', next)}
        />
      </Row>

      <Row label="Client payment">
        {canEdit ? (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <select
              className="aq-input"
              style={{ maxWidth: 160 }}
              value={task.client_payment_status ?? ''}
              onChange={(e) => save('client_payment_status', e.target.value || null)}
            >
              <option value="">— status —</option>
              <option value="pending">Pending</option>
              <option value="partial">Partial</option>
              <option value="paid">Paid</option>
            </select>
            <input
              type="date"
              className="aq-input"
              style={{ maxWidth: 160 }}
              defaultValue={task.client_payment_date ?? ''}
              onChange={(e) => save('client_payment_date', e.target.value || null)}
            />
            <TextInput
              defaultValue={task.client_payment_amount != null ? String(task.client_payment_amount) : ''}
              placeholder="amount"
              inputMode="decimal"
              onCommit={(v) => save('client_payment_amount', numberOrNull(v))}
              style={{ maxWidth: 160 }}
            />
          </div>
        ) : (
          <span>
            {[task.client_payment_status, task.client_payment_date, fmtMoney(task.client_payment_amount)]
              .filter(Boolean).join(' · ') || '—'}
          </span>
        )}
      </Row>

      {/* Rolled up from the vendor subtasks — never stored, so it can't drift
          from the lines it came from. See rollupCampaignMoney(). */}
      <Row label="Breakdown">
        <span>
          {money.vendorCount === 0
            ? <span style={{ color: 'var(--aq-text-muted)' }}>No vendor lines yet</span>
            : <>
                {fmtMoney(money.breakdown)}
                <span style={{ color: 'var(--aq-text-muted)' }}>
                  {' '}from {money.vendorCount} vendor{money.vendorCount === 1 ? '' : ' lines'}
                </span>
              </>}
        </span>
      </Row>

      <Row label="Net">
        <span>{money.vendorCount === 0 ? '—' : fmtMoney(money.net)}</span>
      </Row>

      <Row label="AQ Gross">
        <span style={{
          fontWeight: 700,
          color: money.aqGross < 0 ? 'var(--aq-error)' : 'var(--aq-text)',
        }}>
          {money.vendorCount === 0 ? '—' : fmtMoney(money.aqGross)}
          {money.aqGross < 0 && (
            <span style={{ fontWeight: 400, fontSize: 12, marginLeft: 6 }}>
              vendors cost more than the lines bill
            </span>
          )}
        </span>
      </Row>

      {budgetNum > 0 && money.vendorCount > 0 && Math.abs(budgetNum - money.breakdown) > 0.005 && (
        <Row label="">
          <span style={{ fontSize: 12, color: 'var(--aq-warning, #b45309)' }}>
            Breakdown doesn&apos;t match the {fmtMoney(budgetNum)} budget
            ({money.breakdown > budgetNum ? 'over' : 'under'} by {fmtMoney(Math.abs(budgetNum - money.breakdown))}).
          </span>
        </Row>
      )}

      <Row label="Net payment date">
        {canEdit
          ? <input
              type="date"
              className="aq-input"
              style={{ maxWidth: 200 }}
              defaultValue={task.net_payment_date ?? ''}
              onChange={(e) => save('net_payment_date', e.target.value || null)}
            />
          : <span>{task.net_payment_date || '—'}</span>}
      </Row>

      <Row label="Contract status">
        {canEdit
          ? <select
              className="aq-input"
              style={{ maxWidth: 240 }}
              value={task.contract_status ?? ''}
              onChange={(e) => save('contract_status', e.target.value || null)}
            >
              <option value="">— None —</option>
              {CONTRACT_STATUSES.map((c) => <option key={c} value={c}>{labelFor(c)}</option>)}
            </select>
          : <span>{labelFor(task.contract_status)}</span>}
      </Row>
    </section>
  );
}

/**
 * A repeatable list of plain text values, stored as a Postgres text[].
 *
 * Quotation and invoice numbers are "always at least one, sometimes more".
 * Each row commits on blur, so there's no Save button and no draft state to
 * get out of sync with the row. Empty strings are stripped before saving, so
 * an abandoned blank row never reaches the database.
 */
function StringList({
  values, canEdit, placeholder, onChange,
}: {
  values: string[];
  canEdit: boolean;
  placeholder?: string;
  onChange: (next: string[]) => void;
}) {
  // Local draft so "+ Add another" can show an empty box without writing an
  // empty string to the database. Only non-empty values are ever saved.
  const [draft, setDraft] = useState<string[]>(values.length ? values : ['']);
  useEffect(() => {
    setDraft(values.length ? values : ['']);
  }, [values.join('\u0000')]);

  if (!canEdit) {
    return <span>{values.filter(Boolean).join(', ') || '—'}</span>;
  }

  const push = (next: string[]) => {
    setDraft(next.length ? next : ['']);
    onChange(next.map((v) => v.trim()).filter(Boolean));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {draft.map((v, i) => (
        <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <TextInput
            defaultValue={v}
            placeholder={placeholder}
            onCommit={(raw) => { const n = [...draft]; n[i] = raw; push(n); }}
            style={{ maxWidth: 240 }}
          />
          {draft.length > 1 && (
            <button
              type="button"
              className="aq-btn aq-btn-ghost"
              style={{ padding: '4px 8px', fontSize: 12 }}
              aria-label="Remove"
              onClick={() => push(draft.filter((_, j) => j !== i))}
            >✕</button>
          )}
        </div>
      ))}
      <button
        type="button"
        className="aq-btn aq-btn-ghost"
        style={{ alignSelf: 'flex-start', padding: '2px 6px', fontSize: 12 }}
        // Only offer another box once the last one has something in it —
        // otherwise you can stack up blank rows that save to nothing.
        disabled={draft[draft.length - 1].trim() === ''}
        onClick={() => setDraft([...draft, ''])}
      >+ Add another</button>
    </div>
  );
}

/** Checkbox group for a text[] column — a campaign can run on several platforms. */
function MultiSelect({
  options, selected, onChange,
}: {
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  if (options.length === 0) {
    return <span style={{ fontSize: 12, color: 'var(--aq-text-muted)' }}>
      No platforms configured — add them in Settings.
    </span>;
  }
  const toggle = (name: string) => {
    onChange(selected.includes(name)
      ? selected.filter((x) => x !== name)
      : [...selected, name]);
  };
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {options.map((name) => {
        const on = selected.includes(name);
        return (
          <button
            key={name}
            type="button"
            onClick={() => toggle(name)}
            aria-pressed={on}
            style={{
              padding: '4px 10px', fontSize: 12, cursor: 'pointer',
              borderRadius: 9999,
              border: `1px solid ${on ? 'var(--aq-accent)' : 'var(--aq-border-light)'}`,
              background: on ? 'var(--aq-accent-light)' : 'transparent',
              color: 'var(--aq-text)',
              fontWeight: on ? 700 : 400,
              fontFamily: 'inherit',
            }}
          >{name}</button>
        );
      })}
    </div>
  );
}

/**
 * Uncontrolled text input that fires `onCommit(value)` on blur or Enter.
 * Lets the OperationsPanel use simple field-by-field saves without
 * juggling a draft state for every column.
 */
function TextInput({
  defaultValue, onCommit, placeholder, inputMode, style,
}: {
  defaultValue: string;
  onCommit: (value: string) => void;
  placeholder?: string;
  inputMode?: 'text' | 'decimal' | 'numeric';
  style?: React.CSSProperties;
}) {
  const ref = useRef<HTMLInputElement | null>(null);
  // Reset the input when the parent's defaultValue changes (e.g. after the
  // task refetches with the saved value).
  useEffect(() => {
    if (ref.current && ref.current.value !== defaultValue) {
      ref.current.value = defaultValue;
    }
  }, [defaultValue]);
  return (
    <input
      ref={ref}
      className="aq-input"
      style={style}
      defaultValue={defaultValue}
      placeholder={placeholder}
      inputMode={inputMode}
      onBlur={(e) => {
        if (e.target.value !== defaultValue) onCommit(e.target.value);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}
