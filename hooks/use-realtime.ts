'use client';

import { useEffect } from 'react';
import { createClient } from '@/lib/supabase-browser';
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';

const supabase = createClient();

// Updated to include pm_tasks alongside other tables
type TableName = 'pm_tasks' | 'tasks' | 'comments' | 'notifications' | 'projects' | 'activity_log' | 'vendors' | 'subtasks';

interface UseRealtimeOptions {
  table: TableName;
  filter?: string;
  onInsert?: (payload: any) => void;
  onUpdate?: (payload: any) => void;
  onDelete?: (payload: any) => void;
  onChange?: () => void;
}

export function useRealtime({
  table,
  filter,
  onInsert,
  onUpdate,
  onDelete,
  onChange,
}: UseRealtimeOptions) {
  useEffect(() => {
    const channel = supabase
      .channel(`${table}-changes-${filter || 'all'}`)
      .on(
        'postgres_changes' as any,
        {
          event: '*',
          schema: 'public',
          table,
          ...(filter ? { filter } : {}),
        },
        (payload: RealtimePostgresChangesPayload<any>) => {
          switch (payload.eventType) {
            case 'INSERT':
              onInsert?.(payload.new);
              break;
            case 'UPDATE':
              onUpdate?.(payload.new);
              break;
            case 'DELETE':
              onDelete?.(payload.old);
              break;
          }
          onChange?.();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [table, filter]);
}
