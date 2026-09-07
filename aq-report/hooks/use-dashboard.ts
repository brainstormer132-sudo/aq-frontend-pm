'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase-browser';
import { selectAllRows } from '@/hooks/use-workflow';
import type { DashTask } from '@/lib/dashboard-data';

const supabase = createClient();

/**
 * Every row the Data view needs, in two queries.
 *
 * Two things this deliberately does NOT do:
 *
 * 1. `select('*')`. The view reads twenty columns; pulling every column of
 *    every campaign AND every subtask is a lot of payload for numbers nobody
 *    looks at. The list below is the whole contract with the database —
 *    add a column here when the view starts reading it.
 *
 * 2. Trust a single page. Both queries go through `selectAllRows`, which
 *    pages past PostgREST's 1000-row cap. That cap is silent: it does not
 *    error, it just stops, which is how the Clients screen came to say
 *    exactly "1,000" for weeks. On a dashboard the failure would be worse —
 *    every total would be quietly wrong rather than obviously wrong.
 *
 * Subtasks are fetched WITHOUT a workspace filter and matched to their
 * parents in memory. Some legacy subtasks were written with a null
 * workspace_id, and filtering on it would drop their money from the totals
 * without saying so. Row-level security still scopes what comes back.
 */
const COLUMNS = [
  'id', 'parent_task_id', 'title', 'task_name', 'brand_name',
  'client_id', 'vendor_id', 'assignee_id', 'created_at',
  'stage', 'status', 'subtask_kind',
  'price', 'net_amount',
  'client_payment_status', 'client_payment_amount',
  'contract_status',
  'vendor_payment_amount', 'vendor_payment_date',
  // The vendor report's seventeen columns need these as well: the campaign's
  // lookups and dates, and the per-ad platform and ad type.
  'due_date', 'approval_stage', 'platform', 'platforms', 'ad_type',
  'service_type_id', 'source_id', 'client_category_id',
].join(', ');

interface Cached { at: number; rows: DashTask[] }
const CACHE = new Map<string, Cached>();
const TTL_MS = 60_000;

export interface DashboardData {
  rows: DashTask[];
  loading: boolean;
  error: string | null;
  /** Rows loaded, so the page can say what it is counting. */
  counts: { campaigns: number; subtasks: number };
  refetch: (force?: boolean) => void;
}

export function useDashboardRows(workspaceId: string | null): DashboardData {
  const [rows, setRows] = useState<DashTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (force = false) => {
    if (!workspaceId) { setRows([]); setLoading(false); return; }

    const hit = CACHE.get(workspaceId);
    if (!force && hit && Date.now() - hit.at < TTL_MS) {
      setRows(hit.rows);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const [parents, subs] = await Promise.all([
      selectAllRows<DashTask>(
        'useDashboardRows parents',
        () => supabase.from('pm_tasks').select(COLUMNS)
          .eq('workspace_id', workspaceId)
          .is('parent_task_id', null)
          .order('created_at', { ascending: false }),
        (msg) => setError(msg),
      ),
      selectAllRows<DashTask>(
        'useDashboardRows subtasks',
        () => supabase.from('pm_tasks').select(COLUMNS)
          .not('parent_task_id', 'is', null)
          .order('created_at', { ascending: false }),
        (msg) => setError(msg),
      ),
    ]);

    const known = new Set(parents.map((p) => p.id));
    const mine = subs.filter((s) => s.parent_task_id && known.has(s.parent_task_id));
    const all = [...parents, ...mine];

    CACHE.set(workspaceId, { at: Date.now(), rows: all });
    setRows(all);
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => { load(); }, [load]);

  return {
    rows,
    loading,
    error,
    counts: {
      campaigns: rows.filter((r) => !r.parent_task_id).length,
      subtasks: rows.filter((r) => !!r.parent_task_id).length,
    },
    refetch: load,
  };
}
