/**
 * Apply the import SQL that lib/asana-import.ts generates, over a direct
 * Postgres connection. SERVER-ONLY: it holds the database URL.
 *
 * Why run the generated SQL rather than re-do the writes in JS: the SQL is the
 * same set of files a person pastes into the Supabase SQL editor today
 * (registries, campaigns, bookings, ad lines), already tested and already the
 * production path. Executing it here just automates that paste. Each file is
 * its own `begin; ... commit;` transaction and is idempotent (keyed on
 * asana_gid / import_key), so a re-run updates in place.
 *
 * The connection runs as the database owner (the SUPABASE_DB_URL user), which
 * is what the SQL editor does -- so RLS and the 1000-row PostgREST cap are out
 * of the way, exactly as the manual import assumes.
 *
 * The 99_wipe.sql file is DELIBERATELY skipped: a sync must never delete.
 */
import postgres from 'postgres';
import type { SqlFile } from './asana-import';

export interface ApplyResult {
  filesRun: string[];
  filesSkipped: string[];
}

export async function applyImportSql(dbUrl: string, files: SqlFile[]): Promise<ApplyResult> {
  if (!dbUrl) throw new Error('SUPABASE_DB_URL is not set.');

  const sql = postgres(dbUrl, {
    max: 1,                       // one short-lived connection per sync
    prepare: false,               // required for the Supabase transaction pooler
    idle_timeout: 20,
    connect_timeout: 30,
    connection: { application_name: 'aq-asana-sync' },
  });

  const filesRun: string[] = [];
  const filesSkipped: string[] = [];
  try {
    for (const f of files) {
      // Never run the wipe from a sync.
      if (/(^|\/)99_/.test(f.name) || /wipe/i.test(f.name)) { filesSkipped.push(f.name); continue; }
      // Each file self-wraps begin/commit; run it verbatim.
      await sql.unsafe(f.sql);
      filesRun.push(f.name);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
  return { filesRun, filesSkipped };
}