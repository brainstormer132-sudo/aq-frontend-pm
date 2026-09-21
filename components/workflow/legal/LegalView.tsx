'use client';

import type { WorkspaceRole } from '@/hooks/use-workflow';
import { LegalCases } from '@/components/workflow/legal/LegalCases';
import { LegalDocuments } from '@/components/workflow/legal/LegalDocuments';
import { LegalRegister } from '@/components/workflow/legal/LegalRegister';
import { LegalTasks } from '@/components/workflow/legal/LegalTasks';

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

export type LegalSection = 'matters' | 'cases' | 'documents' | 'register' | 'signatures';

const COPY: Record<LegalSection, { blurb: string; soon: string }> = {
  cases: {
    blurb: 'Disputes, unpaid money and lawsuits, with a status and a log.',
    soon: 'Cases are live - this copy is only reached if the section is rendered without the screen.',
  },
  matters: {
    blurb: 'One set of terms, one contract per vendor, for work with no campaign behind it.',
    soon: 'Tasks are live - this copy is only reached if the section is rendered without the screen.',
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

export function LegalView({ section, workspaceId }: {
  section: LegalSection;
  workspaceId?: string;
  role?: WorkspaceRole | null;
}) {
  if (section === 'matters') return <LegalTasks workspaceId={workspaceId} />;
  if (section === 'cases') return <LegalCases workspaceId={workspaceId} />;
  if (section === 'documents') return <LegalDocuments workspaceId={workspaceId} />;
  if (section === 'register') return <LegalRegister workspaceId={workspaceId} />;
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