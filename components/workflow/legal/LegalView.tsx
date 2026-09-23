'use client';

import type { WorkspaceRole } from '@/hooks/use-workflow';
import { LegalCases } from '@/components/workflow/legal/LegalCases';
import { LegalDocuments } from '@/components/workflow/legal/LegalDocuments';
import { LegalRegister } from '@/components/workflow/legal/LegalRegister';
import { LegalSignatures } from '@/components/workflow/legal/LegalSignatures';
import { LegalTasks } from '@/components/workflow/legal/LegalTasks';

/**
 * The Legal section shell.
 *
 * Five sub-views hang off the sidebar's Legal group, all gated to
 * owner/admin/legal. This renders the body under the screen band; the band
 * supplies the title.
 *
 * -- WHY THERE IS NO FALLBACK ANY MORE --------------------------------
 *
 * There used to be a COPY table of blurbs and a "coming soon" card for the
 * sections that had no screen yet. Signatures was the last of them, and with
 * it built the fallback became unreachable - TypeScript said so, narrowing
 * `section` to `never` after the five returns.
 *
 * It is deleted rather than kept, and the exhaustive switch below is what
 * replaces it. A section added to LegalSection from now on FAILS TO COMPILE
 * until it has a screen, which is a stronger promise than a placeholder card
 * that quietly says "soon" for a year.
 */

export type LegalSection = 'matters' | 'cases' | 'documents' | 'register' | 'signatures';

export function LegalView({ section, workspaceId, role, onSection, registerFilter }: {
  section: LegalSection;
  workspaceId?: string;
  /** Who is looking. The Register needs it: only owner, admin and legal may
   *  accept or reject a signed copy (migration 127), and a button that is
   *  about to be refused should not be offered. */
  role?: WorkspaceRole | null;
  /** Move to another legal screen. Signatures uses it so each number is a
   *  way into the Register filtered to itself. */
  onSection?: (s: LegalSection, filter?: string) => void;
  /** The filter the Register opens on, when arriving from a number. */
  registerFilter?: string;
}) {
  switch (section) {
    case 'matters': return <LegalTasks workspaceId={workspaceId} role={role} />;
    case 'cases': return <LegalCases workspaceId={workspaceId} />;
    case 'documents': return <LegalDocuments workspaceId={workspaceId} />;
    case 'register': return (
      <LegalRegister workspaceId={workspaceId} role={role}
        initialSource={(registerFilter ?? '') as any} />
    );
    case 'signatures': return (
      <LegalSignatures workspaceId={workspaceId}
        onOpenRegister={onSection ? (f) => onSection('register', f) : undefined} />
    );
    default: {
      // Unreachable while LegalSection is exhausted above. The assignment is
      // the guard: add a section without a screen and this line stops
      // compiling, naming the section it is missing.
      const missing: never = section;
      return <>{String(missing)}</>;
    }
  }
}
