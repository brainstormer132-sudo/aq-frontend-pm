'use client';

import { useCallback, useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase-browser';
import { selectAllRows } from '@/hooks/use-workflow';
import { chunk } from '@/lib/legal-bulk';
import type { OverrideRow } from '@/lib/overrides';
import { normaliseReason, reasonError, codeShapeError } from '@/lib/overrides';

/**
 * The shared override code, and the log of every time somebody used it.
 *
 * Migration 125 holds the rules. Three things about this file follow from it
 * and are worth reading before changing anything here:
 *
 *   1. THE CODE IS NEVER COMPARED IN THE BROWSER. It is sent to
 *      public.use_override(), which hashes and compares it server-side,
 *      rate-limits the caller and writes the log row. There is no endpoint
 *      that returns the code or its hash, and there should never be one.
 *   2. A WRONG CODE IS NOT AN ERROR. use_override RETURNS FALSE, because
 *      raising would roll back the transaction that holds the record of the
 *      attempt. So `pass()` returns a boolean and only throws for the cases
 *      the database itself refuses.
 *   3. THE LOG IS READ-ONLY, TO EVERYBODY. There is no update or delete
 *      policy on rule_override for any role, so nothing here offers one.
 */

const sb = () => createClient() as unknown as SupabaseClient;

export interface PassRuleInput {
  workspaceId: string;
  code: string;
  ruleKey: string;
  /** What was being acted on - 'pm_task', 'contract', and so on. */
  entityKind?: string | null;
  entityId?: string | null;
  /** What it was CALLED at the time. The log keeps the name rather than
   *  resolving it later, because names change. */
  entityName?: string | null;
  reason: string;
}

/**
 * Whether a code has been set, and the two things anybody does with it.
 *
 * `hasCode` matters: without it the gate says "no override code has been set
 * - an owner has to set one in Settings", which is a different problem from
 * "wrong code" and sends the person somewhere useful.
 */
export function useOverrideCode(workspaceId: string | null) {
  const [hasCode, setHasCode] = useState<boolean | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!workspaceId) { setHasCode(null); return; }
    const { data, error: e } = await sb().rpc('has_override_code', { p_workspace_id: workspaceId });
    if (e) { setError(e.message ?? String(e)); setHasCode(null); return; }
    setError('');
    setHasCode(!!data);
  }, [workspaceId]);

  useEffect(() => { void load(); }, [load]);

  /** Owner and admin only - the database says so and will refuse anybody
   *  else. Nothing reads the code back afterwards; there is nowhere to. */
  const setCode = useCallback(async (code: string) => {
    if (!workspaceId) throw new Error('No workspace selected.');
    const bad = codeShapeError(code);
    if (bad) throw new Error(bad);
    const { error: e } = await sb().rpc('set_override_code', {
      p_workspace_id: workspaceId, p_code: code,
    });
    if (e) throw new Error(e.message ?? String(e));
    await load();
  }, [workspaceId, load]);

  /**
   * Pass a rule. TRUE means it went through; FALSE means the code was wrong
   * and the attempt is now in the log.
   *
   * It throws only where the database refuses outright: not a member, a
   * reason under the floor, no code set, or too many wrong codes. Those are
   * conditions with nothing worth recording, and their messages come
   * straight from the database so the screen cannot drift from the rule.
   */
  const pass = useCallback(async (input: PassRuleInput): Promise<boolean> => {
    const reason = normaliseReason(input.reason);
    const badReason = reasonError(reason);
    if (badReason) throw new Error(badReason);
    const badCode = codeShapeError(input.code);
    if (badCode) throw new Error(badCode);

    const { data, error: e } = await sb().rpc('use_override', {
      p_workspace_id: input.workspaceId,
      p_code: input.code,
      p_rule_key: input.ruleKey,
      p_entity_kind: input.entityKind ?? null,
      p_entity_id: input.entityId ?? null,
      p_entity_name: input.entityName ?? null,
      p_reason: reason,
    });
    if (e) throw new Error(e.message ?? String(e));
    return !!data;
  }, []);

  return { hasCode, error, reload: load, setCode, pass };
}

/**
 * The log.
 *
 * PAGED, like every other read in this app that can only grow: one row per
 * attempt, successful and refused, forever. Truncated at a thousand it would
 * quietly stop counting, and a count that quietly stops is worse than no
 * count - somebody would read "12 this month" and believe it.
 *
 * The names are a second read against profiles, chunked, and BEST EFFORT: a
 * row whose actor has no profile keeps its id and renders as "somebody
 * without a name on file". A log that will not open because the profiles
 * table is unreadable is worse than one with a blank column.
 *
 * Who sees what is the database's business (125): owner and admin see
 * everything, everybody else sees their own rows. This does no filtering of
 * its own, so the screen cannot disagree with the policy.
 */
export function useOverrideLog(workspaceId: string | null) {
  const [rows, setRows] = useState<OverrideRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!workspaceId) { setRows([]); setLoading(false); return; }
    setLoading(true); setError('');
    const raw = await selectAllRows<any>('useOverrideLog', () => sb().from('rule_override')
      .select('id, rule_key, entity_kind, entity_id, entity_name, actor, reason, passed, created_at')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .order('id'), (m) => setError(m));

    const ids = Array.from(new Set(raw.map((r) => String(r.actor ?? '')).filter(Boolean)));
    const nameBy = new Map<string, string>();
    for (const part of chunk(ids, 60)) {
      const { data } = await sb().from('profiles').select('id, full_name').in('id', part);
      for (const p of (data ?? []) as any[]) {
        if (p?.id) nameBy.set(String(p.id), String(p.full_name ?? '').trim());
      }
    }

    setRows(raw.map((r) => ({ ...r, actor_name: nameBy.get(String(r.actor ?? '')) || null })));
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => { void load(); }, [load]);

  return { rows, loading, error, reload: load };
}
