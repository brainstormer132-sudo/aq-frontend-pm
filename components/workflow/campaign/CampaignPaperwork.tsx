'use client';

import React, { useMemo, useState } from 'react';
import {
  clientContractReadiness, sendClientContractRequest,
  requestCampaignDocument, cancelDocumentRequest, updateTaskFields,
  type PMTask, type WorkspaceRole, type DocumentRequestKind,
} from '@/hooks/use-workflow';
import { Card, Note, Missing, inkButton, quietButton } from './ui';
import {
  docTrack, contractTrack, docLabel, lengthLabel,
  type Track, type DocLike,
} from '@/lib/campaign-page';
import { LengthField, TrackRow } from './track';

/**
 * The client's paperwork: the contract, the quotation, the invoice.
 *
 * Design B — *asked, then answered*. Every document here is a two-step
 * journey: somebody asks, somebody answers. The card draws that journey with
 * a date at each end, because the gap between them is the thing worth seeing.
 * The card this replaces said "requested" whether the invoice went out this
 * morning or eleven days ago, which is how a campaign gets fully delivered and
 * never invoiced.
 *
 * The client contract carries a **length** now (migration 066). It was only
 * ever in the generated .docx, so the app could tell you a contract was signed
 * without being able to say what it committed to.
 */
export function CampaignPaperwork({
  task, client, requests, docRequests, role, currentUserId, today, onChanged,
}: {
  task: PMTask;
  client: any | null;
  requests: any[];
  docRequests: DocLike[];
  role: WorkspaceRole | null;
  currentUserId: string;
  today: string;
  onChanged: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const canRequest = !!role
    && ['owner', 'admin', 'marketing', 'sales', 'key_account'].includes(role);
  const canEdit = role !== 'member';

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError(''); setNotice('');
    try { await fn(); await onChanged(); }
    catch (e: any) { setError(e?.message ?? String(e)); }
    finally { setBusy(false); }
  };

  // The client's own contract requests. Vendor ones live on their own card, or
  // the two would be counted together and neither total would be true.
  const clientRequests = useMemo(
    () => requests.filter((r) => String(r.kind ?? r.request_kind ?? 'client') === 'client'),
    [requests],
  );
  const latest = clientRequests[0] ?? null;
  const readiness = clientContractReadiness(task, client);

  const contract: Track = contractTrack(
    latest,
    today,
    !latest && !readiness.ready ? 'Fill in the client details first' : null,
  );

  const term = lengthLabel((task as any).contract_length, (task as any).contract_length_unit);

  const sendClient = () => run(async () => {
    await sendClientContractRequest({ task, client, requestedBy: currentUserId });
    setNotice('The client contract has gone to Legal.');
  });

  const requestDoc = (kind: DocumentRequestKind) => run(async () => {
    await requestCampaignDocument({ parent: task, kind, requestedBy: currentUserId });
    setNotice(`${docLabel(kind)} requested.`);
  });

  const cancelDoc = (id: string, kind: string) => run(async () => {
    await cancelDocumentRequest(id);
    setNotice(`${docLabel(kind)} request cancelled.`);
  });

  const quotation = docTrack(docRequests, 'quotation', today);
  const invoice = docTrack(docRequests, 'invoice', today);

  return (
    <Card id="contracts" title="Contracts &amp; paperwork" hint={summary(contract, quotation, invoice)}>
      {error && <Note tone="bad">{error}</Note>}
      {notice && !error && <Note tone="good">{notice}</Note>}

      {/* ── The client's contract ──────────────────────────────── */}
      <TrackRow
        name={docLabel('client')}
        track={contract}
        sub={[client?.company_name ?? task.brand_name, term].filter(Boolean).join(' · ')}
        detail={contract.state === 'blocked' ? <Missing items={readiness.missing as any} /> : null}
        actions={
          <>
            <LengthField
              canEdit={canEdit}
              n={(task as any).contract_length}
              unit={(task as any).contract_length_unit}
              onCommit={(n, u) => run(async () => {
                await updateTaskFields(task.id, {
                  contract_length: n, contract_length_unit: u,
                } as any);
              })}
            />
            {canRequest && contract.state !== 'waiting' && contract.state !== 'done' && (
              <button
                type="button"
                style={inkButton(busy || !readiness.ready)}
                disabled={busy || !readiness.ready}
                onClick={sendClient}
              >{latest ? 'Ask again' : 'Ask'}</button>
            )}
          </>
        }
      />

      {/* ── Quotation and invoice ──────────────────────────────── */}
      {(['quotation', 'invoice'] as DocumentRequestKind[]).map((kind) => {
        const t = kind === 'quotation' ? quotation : invoice;
        const row = (docRequests ?? []).find(
          (r: any) => String(r.doc_kind) === kind && String(r.status) === 'pending',
        ) as any;
        return (
          <TrackRow
            key={kind}
            name={docLabel(kind)}
            track={t}
            actions={canEdit ? (
              t.state === 'waiting' && row?.id ? (
                <button type="button" style={quietButton(busy)} disabled={busy}
                  onClick={() => cancelDoc(String(row.id), kind)}
                >Cancel the request</button>
              ) : t.state === 'none' ? (
                <button type="button" style={inkButton(busy)} disabled={busy}
                  onClick={() => requestDoc(kind)}
                >Ask</button>
              ) : null
            ) : null}
          />
        );
      })}
    </Card>
  );
}

/** The card's one line: where all three stand, worst first. */
function summary(contract: Track, quotation: Track, invoice: Track): string {
  const parts = [
    `client contract ${contract.badge.toLowerCase()}`,
    `quotation ${quotation.state === 'done' ? 'issued' : quotation.badge.toLowerCase()}`,
    `invoice ${invoice.state === 'done' ? 'issued' : invoice.badge.toLowerCase()}`,
  ];
  return parts.join(' · ');
}
