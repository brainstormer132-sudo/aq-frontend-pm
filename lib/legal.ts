// Pure helpers for the legal document system. No React, no Supabase, no
// argless Date - compiled and exercised by tests/legal.test.mjs.

export type DocKind = 'vendor_contract' | 'nda' | 'client_contract' | 'other';
export type VersionStatus = 'draft' | 'published' | 'archived';

export const DOC_KINDS: { key: DocKind; label: string }[] = [
  { key: 'vendor_contract', label: 'Vendor contract' },
  { key: 'nda', label: 'NDA' },
  { key: 'client_contract', label: 'Client contract' },
  { key: 'other', label: 'Other' },
];

export function kindLabel(k: string): string {
  return DOC_KINDS.find((d) => d.key === k)?.label ?? 'Other';
}

/** The words shown on a version's status pill. */
export function statusLabel(s: string | null | undefined): string {
  return s === 'published' ? 'Published' : s === 'archived' ? 'Archived' : s === 'draft' ? 'Draft' : 'No version';
}

/** The badge colour class for a status. Draft is a waiting colour, published a
 *  success one, archived muted. */
export function statusBadge(s: string | null | undefined): string {
  return s === 'published' ? 'aq-badge-success'
    : s === 'archived' ? 'aq-badge-muted'
    : s === 'draft' ? 'aq-badge-warning'
    : 'aq-badge-muted';
}

export interface LegalTemplateLite {
  id: string;
  doc_kind: DocKind;
  name: string;
  description?: string | null;
  updated_at?: string | null;
  /** Newest version's number and status, folded from doc_template_version. */
  latest_version?: number | null;
  latest_status?: VersionStatus | null;
}

/**
 * Group templates under their kind, in DOC_KINDS order, name-sorted within a
 * kind. Empty kinds are dropped so the screen shows only sections that exist.
 */
export function groupTemplatesByKind(
  rows: LegalTemplateLite[],
): { key: DocKind; label: string; items: LegalTemplateLite[] }[] {
  return DOC_KINDS
    .map((d) => ({
      key: d.key,
      label: d.label,
      items: rows.filter((r) => r.doc_kind === d.key).slice().sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .filter((g) => g.items.length > 0);
}

/** Validate the New-template form. Returns an error sentence, or null if ok. */
export function validateNewTemplate(name: string, kind: string): string | null {
  if (!name.trim()) return 'A template needs a name.';
  if (!DOC_KINDS.some((d) => d.key === kind)) return 'Pick a document type.';
  return null;
}
