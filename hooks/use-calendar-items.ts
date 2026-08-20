'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase-browser';
import { selectAllRows } from '@/hooks/use-workflow';

const supabase = createClient();

export type CalendarKind = 'campaign' | 'subtask' | 'ad';

export interface CalendarItem {
  id: string;
  /** The pm_task to open when it is clicked — an ad opens its subtask. */
  taskId: string;
  kind: CalendarKind;
  title: string;
  due_date: string | null;
  done: boolean;
  /** Campaign name, for the ones that hang off one. */
  context: string | null;
  assignee_id: string | null;
}

/**
 * Everything that can sit on a calendar: campaigns, their subtasks, and the
 * individual ads inside a vendor booking.
 *
 * All Tasks reads `useWorkflowTasks`, which loads campaigns only — it filters
 * `parent_task_id is null`. That is right for a list of campaigns and wrong
 * for a calendar: the due dates people actually work to are on the subtasks
 * and, since migration 057, on the individual ads. A calendar showing only
 * campaign deadlines would look complete and be missing most of the work.
 *
 * Paged through `selectAllRows`, because the 1000-row cap is silent and a
 * calendar quietly missing December would be very hard to notice.
 */
export function useCalendarItems(workspaceId: string | null) {
  const [items, setItems] = useState<CalendarItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!workspaceId) { setItems([]); setLoading(false); return; }
    setLoading(true);

    const tasks = await selectAllRows<any>(
      'useCalendarItems tasks',
      () => supabase
        .from('pm_tasks')
        .select('id, parent_task_id, task_name, title, brand_name, due_date, status, stage, assignee_id, subtask_kind')
        .eq('workspace_id', workspaceId),
    );

    const byId = new Map<string, any>(tasks.map((t) => [t.id, t]));
    const nameOf = (t: any) => (t?.task_name || t?.title || 'Untitled').trim();
    const isDone = (t: any) => t?.status === 'done' || t?.stage === 'completed';

    const out: CalendarItem[] = tasks.map((t) => ({
      id: t.id,
      taskId: t.id,
      kind: t.parent_task_id ? 'subtask' : 'campaign',
      title: nameOf(t),
      due_date: t.due_date ?? null,
      done: isDone(t),
      context: t.parent_task_id ? nameOf(byId.get(t.parent_task_id)) : (t.brand_name ?? null),
      assignee_id: t.assignee_id ?? null,
    }));

    // The ads inside vendor bookings. Selected without a workspace filter —
    // the table has no workspace column — then matched to subtasks we already
    // loaded, which is what scopes them.
    const lines = await selectAllRows<any>(
      'useCalendarItems ad lines',
      () => supabase
        .from('vendor_ad_lines')
        .select('id, subtask_id, ad_type, description, due_date, status, quantity'),
    );

    for (const l of lines) {
      const parent = byId.get(l.subtask_id);
      if (!parent) continue;                       // another workspace, or deleted
      const qty = Number(l.quantity) > 1 ? ` ×${l.quantity}` : '';
      out.push({
        id: `ad:${l.id}`,
        taskId: l.subtask_id,
        kind: 'ad',
        title: `${(l.ad_type || 'Ad').trim()}${qty}${l.description ? ` — ${l.description}` : ''}`,
        due_date: l.due_date ?? null,
        done: l.status === 'Posted' || l.status === 'Cancelled',
        context: nameOf(parent),
        assignee_id: parent.assignee_id ?? null,
      });
    }

    setItems(out);
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => { load(); }, [load]);

  return { items, loading, refetch: load };
}
