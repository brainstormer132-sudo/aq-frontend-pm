'use client';

import React, { useMemo, useState } from 'react';
import {
  clientContractReadiness, sendClientContractRequest,
  requestCampaignDocument, cancelDocumentRequest,
  labelFor,
  type PMTask, type WorkspaceRole, type DocumentRequestKind,
} from '@/hooks/use-workflow';
import { RequestContractModal } from '../RequestContractModal';
import { Card, Note, Missing, inkButton, quietButton } from './ui';
import { docState, contractStateLine, type DocLike } from '@/lib/campaign-page';

/**
 * The paperwork: the client's contract, the quotation, and the invoice.
 *
 * All three were buried in the drawer under the fields, which is why the app
 * kept producing campaigns that were fully delivered and had never been
 * invoiced. They are one card here, and each row says the same three things:
 * where it stands, what is stopping it, and the single next move.
 *
 * There is no form. The old `RequestContractModal` re-asked for the client's
 * CR, VAT and signatory — details the app already holds — so a request could
 * disagree with its own source. The details are read at send time instead, and
 * an incomplete request is refused with the missing fields named rather than
 * handed to Legal to chase. The modal is still reachable for the awkward cases
 * where somebody needs to type a one-off registration by hand.
 */
export function CampaignContracts({
  task, client, requests, docRequests, role, currentUserId, onChanged,
}: {
  task: PMTask;
  client: any | null;
  requests: any[];
  docRequests: DocLike[];
  role: WorkspaceRole | null;
  currentUserId: string;
  onChanged: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [manual, setManual] = useState(false);

  const canRequest = !!role
    && ['owner', 'admin', 'marketing', 'sales', 'key_account'].includes(role);
  const canEdit = role !== 'member';

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError(''); setNotice('');
    try { await fn(); await onChanged(); }
    catch (e: any) { setError(e?.message ?? String(e)); }
    finally { setBusy(false); }
  };

  /* ── The client's contract ─────────────────────────────────────── */

  // Vendor requests are shown against their booking; this card is the client
  // side only, or the two would be counted together and neither would add up.
  const clientRequests = useMemo(
    () => requests.filter((r) => String(r.kind ?? r.request_kind ?? 'client') === 'client'),
    [requests],
  );
  const latest = clientRequests[0] ?? null;
  const readiness = clientContractReadiness(task, client);

  // A rejected or cancelled request is not a request in flight — it is a
  // reason to raise another one. The drawer got this right and it is easy to
  // get wrong, so it is stated rather than inferred at the call site.
  const inFlight = latest
    && !['rejected', 'cancelled'].includes(String(latest.status ?? ''));

  const sendClient = () => run(async () => {
    await sendClientContractRequest({ task, client, requestedBy: currentUserId });
    setNotice('The client contract has been sent to Legal.');
  });

  /* ── Quotation and invoice ─────────────────────────────────────── */

  const requestDoc = (kind: DocumentRequestKind) => run(async () => {
    await requestCampaignDocument({ parent: task, kind, requestedBy: currentUserId });
    setNotice(`${labelFor(kind)} requested.`);
  });

  const cancelDoc = (id: string, kind: string) => run(async () => {
    await cancelDocumentRequest(id);
    setNotice(`${labelFor(kind)} request cancelled.`);
  });

  return (
    <Card
      id="contracts"
      title="Contracts &amp; paperwork"
      hint={contractStateLine(clientRequests, docRequests)}
      right={canRequest ? (
        <button type="button" style={quietButton(busy)} disabled={busy} onClick={() => setManual(true)}>
          Type one by hand…
        </button>
      ) : null}
    >
      {error && <Note tone="bad">{error}</Note>}
      {notice && !error && <Note tone="good">{notice}</Note>}

      {/* ── The client contract ────────────────────────────────── */}
      <Row
        label="Client contract"
        state={inFlight
          ? labelFor(String(latest.status ?? 'pending'))
          : latest ? `last one ${labelFor(String(latest.status))}` : 'not requested'}
        tone={inFlight ? 'good' : 'idle'}
        detail={!inFlight && canRequest && !readiness.ready
          ? <>
              <span>These have to be filled in first:</span>
              <Missing items={readiness.missing as any} />
            </>
          : null}
        action={canRequest && !inFlight ? (
          <button
            type="button"
            style={inkButton(busy || !readiness.ready)}
            disabled={busy || !readiness.ready}
            onClick={sendClient}
          >{latest ? 'Request again' : 'Request it'}</button>
        ) : null}
      />

      {/* ── Quotation and invoice ──────────────────────────────── */}
      {(['quotation', 'invoice'] as DocumentRequestKind[]).map((kind) => {
        const st = docState(docRequests, kind);
        return (
          <Row
            key={kind}
            label={labelFor(kind)}
            state={st.line}
            tone={st.issued ? 'good' : st.pending ? 'warn' : 'idle'}
            action={canEdit ? (
              st.pending && st.id ? (
                <button
                  type="button" style={quietButton(busy)} disabled={busy}
                  onClick={() => cancelDoc(st.id!, kind)}
                >Cancel</button>
              ) : !st.issued ? (
                <button
                  type="button" style={inkButton(busy)} disabled={busy}
                  onClick={() => requestDoc(kind)}
                >Request it</button>
              ) : null
            ) : null}
          />
        );
      })}

      {manual && (
        <RequestContractModal
          task={task}
          currentUserId={currentUserId}
          defaultKind="client"
          onClose={() => setManual(false)}
          onCreated={() => { setManual(false); setNotice('Request sent.'); void onChanged(); }}
        />
      )}
    </Card>
  );
}

/* ── One line of paperwork ──────────────────────────────────────── */

function Row({ label, state, tone, detail, action }: {
  label: string;
  state: string;
  tone: 'good' | 'warn' | 'idle';
  detail?: React.ReactNode;
  action?: React.ReactNode;
}) {
  const colour = tone === 'good' ? '#14603a' : tone === 'warn' ? '#92400e' : 'var(--aq-text-muted)';
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap',
      padding: '12px 0', borderTop: '1px solid var(--aq-border-light)',
    }}>
      <div style={{ flex: 1, minWidth: 200 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600 }}>{label}</div>
        {/* The state is a word, never only a colour. */}
        <div style={{ fontSize: 12.5, color: colour, marginTop: 1 }}>{state}</div>
        {detail && <div style={{ fontSize: 12.5, marginTop: 6 }}>{detail}</div>}
      </div>
      {action}
    </div>
  );
}
