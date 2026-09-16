'use client';

import type { WorkspaceRole } from '@/hooks/use-workflow';

/**
 * The Legal section shell.
 *
 * Four sub-views hang off the sidebar's Legal group (Matters, Documents,
 * Register, Signatures), all gated to owner/admin/legal. This renders the body
 * under the screen band; the band supplies the title. Deliberately read-free
 * for now - it touches no `legal.*` table, so the section works before the
 * legal schema is exposed in Supabase. The real screens (starting with the
 * document editor) replace these empty states in Milestone 1.
 */

export type LegalSection = 'matters' | 'documents' | 'register' | 'signatures';

const COPY: Record<LegalSection, { blurb: string; soon: string }> = {
  matters: {
    blurb: 'The case log: matters with their parties, timeline and deadlines.',
    soon: 'Matters is on the roadmap after the document editor.',
  },
  documents: {
    blurb: 'Editable document templates and the shared clause library.',
    soon: 'The block editor is being built now - import a .docx once, then edit its wording, reorder clauses and publish immutable versions.',
  },
  register: {
    blurb: 'Every generated document, with the exact template version it was made from.',
    soon: 'The register fills in once documents can be generated from the new templates.',
  },
  signatures: {
    blurb: 'What is out for signature, what is signed, and what is expiring.',
    soon: 'Signature tracking comes after the register.',
  },
};

export function LegalView({ section }: {
  section: LegalSection;
  workspaceId?: string;
  role?: WorkspaceRole | null;
}) {
  const c = COPY[section];
  return (
    <div className="aq-view" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <section className="aq-card" style={{ padding: 28 }}>
        <p style={{ fontSize: 14.5, color: 'var(--aq-text-secondary)', lineHeight: 1.5 }}>{c.blurb}</p>
        <p style={{ fontSize: 13, color: 'var(--aq-text-muted)', marginTop: 10, lineHeight: 1.5 }}>{c.soon}</p>
      </section>
    </div>
  );
}