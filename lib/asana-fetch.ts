/**
 * Pull the campaigns (and their vendor subtasks) from one Asana project.
 * SERVER-ONLY: it carries the Asana token; never import it into a client
 * component.
 *
 * One-way, read-only. Returns the tasks in the shape lib/asana-import.ts's
 * `asanaApiToRows` expects: a campaign per project task, its bookings under
 * `subtasks`. The token and project gid come from the caller (route env),
 * never from the browser.
 *
 * Fields requested match what the import reads (HEADERS): the custom fields by
 * name + display_value, plus the native name / notes / dates / assignee email
 * / tags. Subtasks are not in a project's task list, so each campaign's
 * subtasks are fetched by id.
 */
import type { AsanaApiTask } from './asana-import';

const ASANA_BASE = 'https://app.asana.com/api/1.0';

// Native + custom fields the importer reads. custom_fields.display_value is
// how Asana renders numbers, enums, multi-enums (comma-joined) and dates as
// text -- exactly what the CSV column held.
const OPT_FIELDS = [
  'name', 'notes', 'created_at', 'completed', 'completed_at', 'due_on', 'due_at',
  'assignee.email', 'tags.name',
  'custom_fields.name', 'custom_fields.display_value',
].join(',');

interface AsanaListResponse {
  data: AsanaApiTask[];
  next_page: { offset: string } | null;
}

/** A guard so a misconfigured project can't spin forever. */
const MAX_PAGES = 200;

async function getPaged(path: string, pat: string): Promise<AsanaApiTask[]> {
  const out: AsanaApiTask[] = [];
  let offset: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL(ASANA_BASE + path);
    url.searchParams.set('opt_fields', OPT_FIELDS);
    url.searchParams.set('limit', '100');
    if (offset) url.searchParams.set('offset', offset);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${pat}`, Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Asana GET ${path} failed: ${res.status} ${res.statusText}${body ? ` - ${body.slice(0, 300)}` : ''}`);
    }
    const json = (await res.json()) as AsanaListResponse;
    out.push(...(json.data ?? []));
    offset = json.next_page?.offset ?? null;
    if (!offset) break;
  }
  return out;
}

/**
 * All campaigns in the project, each with its vendor bookings under
 * `subtasks`. Subtasks are fetched per campaign because Asana does not return
 * them in a project's task list.
 */
export async function fetchAsanaProjectTasks(pat: string, projectGid: string): Promise<AsanaApiTask[]> {
  if (!pat) throw new Error('ASANA_PAT is not set.');
  if (!projectGid) throw new Error('ASANA_PROJECT_GID is not set.');

  const campaigns = await getPaged(`/projects/${encodeURIComponent(projectGid)}/tasks`, pat);
  for (const campaign of campaigns) {
    if (!campaign.gid) continue;
    campaign.subtasks = await getPaged(`/tasks/${encodeURIComponent(campaign.gid)}/subtasks`, pat);
  }
  return campaigns;
}