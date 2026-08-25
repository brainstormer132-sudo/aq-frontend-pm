'use client';

import React, { useState } from 'react';
import {
  updateTaskFields, publishTrackingSheet, unpublishTrackingSheet,
  type PMTask, type WorkspaceRole,
} from '@/hooks/use-workflow';
import { TrackingSheetPanel } from '../TrackingSheetPanel';
import { Card, Note, inkButton, quietButton } from './ui';
import { publishLine } from '@/lib/campaign-page';

/**
 * The client-facing sheet: switch it on, open it, publish it, withdraw it.
 *
 * The publish state matters more than it looks. A published sheet is a
 * promise the client is reading right now — so this card never says only
 * "published", it says whether what they are reading still matches what is
 * here. The drawer showed a timestamp, and a timestamp cannot see a row that
 * was deleted after it.
 */
export function CampaignTracking({
  task, rowCount, publishedCount, role, brandName, onChanged,
}: {
  task: PMTask;
  rowCount: number;
  publishedCount: number;
  role: WorkspaceRole | null;
  brandName?: string | null;
  onChanged: () => Promise<void> | void;
}) {
  const [openSheet, setOpenSheet] = useState(false);
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const canEdit = role !== 'member';
  const on = Boolean((task as any).has_tracking);
  const publishedAt = (task as any).tracking_published_at ?? null;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError(''); setNotice('');
    try { await fn(); await onChanged(); }
    catch (e: any) { setError(e?.message ?? String(e)); }
    finally { setBusy(false); }
  };

  const state = publishLine({ publishedAt, rowCount, publishedCount });

  return (
    <>
      <Card
        id="tracking"
        title="Tracking sheet"
        hint={on ? state.line : 'not switched on for this campaign'}
        right={canEdit ? (
          <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {on && (
              <button type="button" style={quietButton(busy)} disabled={busy}
                onClick={() => setOpenSheet(true)}>Open the sheet</button>
            )}
            {on && (
              <button
                type="button" style={inkButton(busy)} disabled={busy}
                onClick={() => run(async () => {
                  const n = await publishTrackingSheet(task.id);
                  setNotice(`${n} row${n === 1 ? '' : 's'} are now what the client sees.`);
                })}
              >{publishedAt ? 'Update what the client sees' : 'Publish to the client'}</button>
            )}
            <button
              type="button" style={quietButton(busy)} disabled={busy}
              onClick={() => run(async () => {
                await updateTaskFields(task.id, { has_tracking: !on } as any);
              })}
            >{on ? 'Switch it off' : 'Switch it on'}</button>
          </span>
        ) : null}
      >
        {error && <Note tone="bad">{error}</Note>}
        {notice && !error && <Note tone="good">{notice}</Note>}

        {!on ? (
          <p style={{ fontSize: 13, color: 'var(--aq-text-muted)', margin: 0 }}>
            Booking an influencer or a UGC vendor switches this on by itself.
            Turn it on here to keep a sheet for anything else.
          </p>
        ) : (
          <>
            <p style={{ fontSize: 13, color: 'var(--aq-text-secondary)', margin: '0 0 10px' }}>
              {state.detail}
            </p>

            {publishedAt && canEdit && (
              confirmWithdraw ? (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
                  padding: '10px 13px', borderRadius: 9,
                  background: '#fee2e2', color: '#991b1b', fontSize: 12.5,
                }}>
                  <span style={{ flex: 1, minWidth: 200 }}>
                    Withdraw the sheet? The client stops seeing it entirely — this
                    is not the same as updating it.
                  </span>
                  <button
                    type="button" style={quietButton(busy)} disabled={busy}
                    onClick={() => { setConfirmWithdraw(false); void run(async () => {
                      await unpublishTrackingSheet(task.id);
                      setNotice('Withdrawn. The client can no longer see the sheet.');
                    }); }}
                  >Withdraw it</button>
                  <button type="button" style={quietButton()} onClick={() => setConfirmWithdraw(false)}>
                    Keep it up
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  style={{ ...quietButton(busy), color: '#991b1b' }}
                  disabled={busy}
                  onClick={() => setConfirmWithdraw(true)}
                >Withdraw it from the client</button>
              )
            )}
          </>
        )}
      </Card>

      {openSheet && (
        <TrackingSheetPanel
          taskId={task.id}
          taskTitle={task.task_name || task.title || 'Campaign'}
          brandName={brandName ?? task.brand_name}
          role={role}
          onClose={() => { setOpenSheet(false); void onChanged(); }}
        />
      )}
    </>
  );
}
