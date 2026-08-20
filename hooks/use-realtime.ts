'use client';

import { useEffect, useRef } from 'react';
import { createClient } from '@/lib/supabase-browser';
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';

const supabase = createClient();

type TableName = 'pm_tasks' | 'tasks' | 'comments' | 'notifications' | 'projects'
               | 'activity_log' | 'vendors' | 'subtasks';

interface UseRealtimeOptions {
  table: TableName;
  filter?: string;
  /** Off until there is something to scope to — see the note below. */
  enabled?: boolean;
  onInsert?: (row: any) => void;
  onUpdate?: (row: any) => void;
  onDelete?: (row: any) => void;
  onChange?: () => void;
}

/**
 * Subscribe to a table's changes.
 *
 * This hook existed from early on and was wired to nothing, which is why a
 * task created on one machine sat invisible on every other one until
 * somebody refreshed. Two things fixed while connecting it:
 *
 * 1. **The callbacks live in a ref.** The channel is created once per
 *    table/filter, so a handler captured at that moment would be the one
 *    used forever — a refetch closing over stale state would quietly stop
 *    fetching the right thing. The ref is rewritten on every render and read
 *    at fire time, so the newest handler always runs.
 *
 * 2. **It can be switched off.** Subscribing before the workspace id is
 *    known would open a channel on the wrong filter and need tearing down;
 *    `enabled` waits instead.
 *
 * Row-level security applies to realtime too: a subscriber is only sent rows
 * they could already have read. Requires the table to be in the
 * `supabase_realtime` publication — migration 055 does that for pm_tasks.
 */
export function useRealtime({
  table, filter, enabled = true, onInsert, onUpdate, onDelete, onChange,
}: UseRealtimeOptions) {
  const handlers = useRef({ onInsert, onUpdate, onDelete, onChange });
  handlers.current = { onInsert, onUpdate, onDelete, onChange };

  useEffect(() => {
    if (!enabled) return;

    const channel = supabase
      .channel(`${table}-changes-${filter || 'all'}`)
      .on(
        'postgres_changes' as any,
        { event: '*', schema: 'public', table, ...(filter ? { filter } : {}) },
        (payload: RealtimePostgresChangesPayload<any>) => {
          const h = handlers.current;
          switch (payload.eventType) {
            case 'INSERT': h.onInsert?.(payload.new); break;
            case 'UPDATE': h.onUpdate?.(payload.new); break;
            case 'DELETE': h.onDelete?.(payload.old); break;
          }
          h.onChange?.();
        },
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [table, filter, enabled]);
}
