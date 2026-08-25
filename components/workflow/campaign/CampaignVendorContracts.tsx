'use client';

import React, { useMemo, useState } from 'react';
import {
  useLegacyVendors, updateTaskFields,
  vendorContractReadiness, sendVendorContractRequest, sendVendorContractRequests,
  type PMTask, type WorkspaceRole,
} from '@/hooks/use-workflow';
import { Card, Note, Missing, inkButton, TONE,
} from './ui';
import { LengthField, TrackRow, TermsField, termsLabel } from './track';
import { contractTrack, askAllLabel, lengthLabel, money, bulkResultLine } from '@/lib/campaign-page';
import type { OptimisticSave } from '@/hooks/use-optimistic-save';

/**
 * The vendors' contracts — every one of them, and one button that asks for
 * all the ones that can be asked for.
 *
 * Siraj: *"remove request button above and add a cell for contract length and
 * make it so you can ask all contracts at once."* So asking moved off the
 * individual booking, where it was one button among a dozen fields, and onto
 * a card that does nothing else. Ten influencers on a campaign means ten
 * contracts, and chasing them one row at a time was the job.
 *
 * The ask-all button is named for what it will actually do — *Ask for the 3
 * that are ready · 2 blocked* — because the drawer's version quietly sent what
 * it could and reported a number, and the two vendors it skipped looked
 * exactly like the ones it sent.
 */
export function CampaignVendorContracts({
  task, subtasks, bookings, client, role, currentUserId, today, opt, onChanged,
}: {
  task: PMTask;
  subtasks: PMTask[];
  bookings: { id: string; name: string; amount?: number | null; [k: string]: any }[];
  client: any | null;
  role: WorkspaceRole | null;
  currentUserId: string;
  today: string;
  opt: OptimisticSave;
  onChanged: () => Promise<void> | void;
}) {
  const { vendors, banks } = useLegacyVendors();
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

  const vendorSubtasks = useMemo(
    () => subtasks.filter((s) => (s as any).subtask_kind === 'vendor' || (s as any).vendor_id != null),
    [subtasks],
  );

  const rows = useMemo(() => vendorSubtasks.map((sub) => {
    const booking = bookings.find((b) => b.id === sub.id);
    const vendor = (vendors as any[]).find((v) => Number(v.id) === Number((sub as any).vendor_id)) ?? null;
    const bank = (banks as any[]).find((x) => Number(x.vendor_id) === Number((sub as any).vendor_id)) ?? null;
    const readiness = vendorContractReadiness(sub, vendor, bank, booking?.amount ?? null);
    const request = (sub as any).contract_request_id
      ? { status: (sub as any).contract_status ?? 'pending',
          created_at: (sub as any).contract_requested_at ?? (sub as any).updated_at,
          generated_at: (sub as any).contract_generated_at }
      : null;

    // The first missing thing, said on the row. The full list opens under it.
    const blocker = !request && !readiness.ready
      ? (readiness.missing[0] as any)?.label ?? 'Not ready'
      : null;

    return {
      sub, vendor, booking, readiness, blocker,
      name: booking?.name ?? vendor?.name ?? sub.title ?? 'Unnamed vendor',
      track: contractTrack(request, today, blocker),
    };
  }), [vendorSubtasks, bookings, vendors, banks, today]);

  const ready = rows.filter((r) => r.track.state === 'none' && !r.blocker);
  const blocked = rows.filter((r) => r.track.state === 'blocked');
  const signed = rows.filter((r) => r.track.state === 'done').length;
  const waiting = rows.filter((r) => r.track.state === 'waiting').length;

  const askOne = (row: typeof rows[number]) => run(async () => {
    await sendVendorContractRequest({
      subtask: row.sub, parent: task, vendor: row.vendor,
      bank: (banks as any[]).find((x) => Number(x.vendor_id) === Number((row.sub as any).vendor_id)) ?? null,
      client, requestedBy: currentUserId,
    });
    setNotice(`Contract requested for ${row.name}.`);
  });

  const askAll = () => run(async () => {
    const res = await sendVendorContractRequests({
      subtasks: ready.map((r) => r.sub),
      parent: task,
      vendors: vendors as any,
      banks: banks as any,
      client,
      requestedBy: currentUserId,
    });
    setNotice(bulkResultLine(res.sent, res.skipped));
  });

  if (!rows.length) return null;

  return (
    <Card
      // Red beats amber beats green: the worst thing on the card is what
      // the bead reports, because that is what you came to find out.
      bead={TONE[blocked.length ? 'red' : ready.length ? 'amber' : 'green'].edge}
      id="vendor-contracts"
      title="Vendor contracts"
      hint={[
        signed ? `${signed} signed` : null,
        waiting ? `${waiting} with Legal` : null,
        ready.length ? `${ready.length} ready` : null,
        blocked.length ? `${blocked.length} blocked` : null,
      ].filter(Boolean).join(' · ') || 'nothing asked for yet'}
      right={canRequest ? (
        <button
          type="button"
          style={inkButton(busy || !ready.length)}
          disabled={busy || !ready.length}
          onClick={askAll}
        >{askAllLabel(ready.length, blocked.length)}</button>
      ) : null}
    >
      {error && <Note tone="bad">{error}</Note>}
      {notice && !error && <Note tone="good">{notice}</Note>}

      {rows.map((r) => (
        <TrackRow
          key={r.sub.id}
          name={r.name}
          track={r.track}
          sub={[
            r.booking?.amount == null ? 'no price yet' : money(r.booking.amount),
            lengthLabel((r.sub as any).contract_length, (r.sub as any).contract_length_unit),
            (r.sub as any).payment_terms
              ? termsLabel((r.sub as any).payment_terms, (r.sub as any).payment_split_pct,
                           (r.sub as any).payment_net_days)
              : null,
          ].filter(Boolean).join(' · ')}
          detail={r.track.state === 'blocked'
            ? <Missing items={r.readiness.missing as any} />
            : null}
          actions={
            <>
              <LengthField
                canEdit={canEdit && r.track.state !== 'done'}
                n={(r.sub as any).contract_length}
                unit={(r.sub as any).contract_length_unit}
                onCommit={(n, u) => opt.setMany(r.sub.id, {
                  contract_length: n, contract_length_unit: u,
                }, {
                  labels: { contract_length: 'Contract length', contract_length_unit: 'Contract length' },
                  was: {
                    contract_length: (r.sub as any).contract_length,
                    contract_length_unit: (r.sub as any).contract_length_unit,
                  },
                  rowName: r.name,
                })}
              />
              <TermsField
                canEdit={canEdit && r.track.state !== 'done'}
                terms={(r.sub as any).payment_terms}
                splitPct={(r.sub as any).payment_split_pct}
                netDays={(r.sub as any).payment_net_days}
                onCommit={(fields) => opt.setMany(r.sub.id, fields as any, {
                  labels: {
                    payment_terms: 'Payment terms',
                    payment_split_pct: 'Payment terms',
                    payment_net_days: 'Payment terms',
                  },
                  was: {
                    payment_terms: (r.sub as any).payment_terms,
                    payment_split_pct: (r.sub as any).payment_split_pct,
                    payment_net_days: (r.sub as any).payment_net_days,
                  },
                  rowName: r.name,
                })}
              />
              {canRequest && r.track.state === 'none' && (
                <button type="button" style={inkButton(busy)} disabled={busy}
                  onClick={() => askOne(r)}>Ask</button>
              )}
              {canRequest && r.track.state === 'blocked' && (
                <button type="button" style={inkButton(true)} disabled>Ask</button>
              )}
            </>
          }
        />
      ))}
    </Card>
  );
}
