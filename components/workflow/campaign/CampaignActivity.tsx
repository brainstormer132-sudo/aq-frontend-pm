'use client';

import React, { useMemo, useRef, useState } from 'react';
import {
  addComment, deleteComment, encodeMentions, parseCommentSegments,
  uploadTaskAttachment, getAttachmentDownloadUrl, deleteAttachment,
  displayName,
  type PMTask, type WorkspaceRole, type MentionPick,
} from '@/hooks/use-workflow';
import { MentionBox, CommentText } from '../MentionBox';
import { TaskAssignees } from '../TaskAssignees';
import { Card, Note, inkButton, quietButton, UndoBar
} from './ui';
import { fileSize, whenAgo } from '@/lib/campaign-page';

const UNDO_MS = 4000;

/**
 * Who is on it, what has been said, and what has been attached.
 *
 * The last of the drawer's cards to move. They sit together because they are
 * the same question asked three ways — what happened on this campaign that is
 * not a field — and because each one alone is too small to earn a card.
 *
 * Comments store ids and show names: `@[[uuid]]` in the database, the person's
 * *current* display name on screen, so renaming somebody does not leave old
 * comments addressing a name that no longer exists (migration 049).
 */
export function CampaignActivity({
  task, workspaceId, currentUserId, role, profiles, comments, attachments,
  refetchFiles, subtaskNames, onChanged,
}: {
  task: PMTask;
  workspaceId: string;
  currentUserId: string;
  role: WorkspaceRole | null;
  profiles: any[];
  /** The campaign's, AND every booking's — see subtaskNames. */
  comments: any[];
  attachments: any[];
  refetchFiles: () => Promise<void> | void;
  /**
   * Booking id → its name. Anything said or attached against a booking used
   * to be reachable only through the drawer, which is now gone; rather than
   * letting it disappear, it is shown here with the booking named on it.
   */
  subtaskNames: Map<string, string>;
  onChanged: () => Promise<void> | void;
}) {

  const [draft, setDraft] = useState('');
  const [picks, setPicks] = useState<MentionPick[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<{ id: string; what: string; left: number }[]>([]);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const isPrivileged = !!role && ['owner', 'admin', 'marketing'].includes(role);
  const canEdit = role !== 'member';

  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of profiles) m.set(String(p.id), displayName(p));
    return m;
  }, [profiles]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await fn(); await onChanged(); }
    catch (e: any) { setError(e?.message ?? String(e)); }
    finally { setBusy(false); }
  };

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    // Cleared first: the comment is going to land, and a box that stays full
    // while the request is in flight gets sent twice.
    setDraft(''); setPicks([]);
    void run(async () => {
      await addComment(task.id, currentUserId, encodeMentions(text, picks));
    });
  };

  /* ── Deleting, with a way back ─────────────────────────────────── */

  const startRemove = (id: string, what: string, commit: () => Promise<void>) => {
    setPending((p) => [...p, { id, what, left: UNDO_MS / 1000 }]);
    const timer = setInterval(() => {
      setPending((p) => {
        const row = p.find((x) => x.id === id);
        if (!row) { clearInterval(timer); return p; }
        if (row.left <= 1) {
          clearInterval(timer);
          void run(commit);
          return p.filter((x) => x.id !== id);
        }
        return p.map((x) => (x.id === id ? { ...x, left: x.left - 1 } : x));
      });
    }, 1000);
  };

  const pendingIds = new Set(pending.map((p) => p.id));

  const upload = (files: FileList | null) => {
    if (!files?.length) return;
    if (!task.workspace_id && !workspaceId) {
      setError('This campaign has no workspace, so a file cannot be attached to it.');
      return;
    }
    void run(async () => {
      // One at a time, so a rejection names the file that caused it rather
      // than failing the batch anonymously.
      for (const file of Array.from(files)) {
        await uploadTaskAttachment({
          file,
          task_id: task.id,
          uploader_id: currentUserId,
          workspace_id: task.workspace_id ?? workspaceId,
        });
      }
      await refetchFiles();
    });
    if (fileInput.current) fileInput.current.value = '';
  };

  const open = (fileUrl: string) => run(async () => {
    const url = await getAttachmentDownloadUrl(fileUrl);
    window.open(url, '_blank', 'noopener');
  });

  const shownComments = (comments ?? []).filter((c: any) => !pendingIds.has(String(c.id)));
  const shownFiles = (attachments ?? []).filter((f: any) => !pendingIds.has(String(f.id)));

  /** Nothing for the campaign's own rows; the booking's name for the rest. */
  const on = (taskId: unknown) => {
    const id = String(taskId ?? '');
    if (!id || id === task.id) return null;
    const name = subtaskNames.get(id);
    return (
      <span title={name ? `On the ${name} booking` : 'On a booking'} style={{
        fontSize: 10.5, fontWeight: 700, padding: '1px 7px', borderRadius: 999,
        background: 'var(--aq-bg-sunken)', color: 'var(--aq-text-secondary)',
        whiteSpace: 'nowrap', maxWidth: 160, overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}>{name ?? 'a booking'}</span>
    );
  };

  return (
    <Card
      id="activity"
      title="People, files &amp; comments"
      hint={[
        `${shownComments.length} comment${shownComments.length === 1 ? '' : 's'}`,
        `${shownFiles.length} file${shownFiles.length === 1 ? '' : 's'}`,
      ].join(' · ')}
    >
      {error && <Note tone="bad">{error}</Note>}

      {pending.map((p) => (
        <div key={p.id} style={{ marginBottom: 8 }}>
          <UndoBar
            label={`Deleted ${p.what}.`}
            seconds={p.left}
            onUndo={() => setPending((x) => x.filter((y) => y.id !== p.id))}
            onNow={() => setPending((x) => x.filter((y) => y.id !== p.id))}
          />
        </div>
      ))}

      {/* ── Who is on it ─────────────────────────────────────────── */}
      <TaskAssignees
        taskId={task.id}
        currentUserId={currentUserId}
        role={role}
        profiles={profiles as any}
        canEdit={canEdit}
      />

      {/* ── Files ────────────────────────────────────────────────── */}
      <div style={{ marginTop: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <span style={{
            fontSize: 10.5, fontWeight: 700, letterSpacing: '.09em',
            textTransform: 'uppercase', color: 'var(--aq-text-muted)',
          }}>Files</span>
          <span aria-hidden style={{ flex: 1, height: 1, background: 'var(--aq-border-light)' }} />
          <input
            ref={fileInput}
            type="file"
            multiple
            aria-label="Attach files to this campaign"
            onChange={(e) => upload(e.target.files)}
            style={{ display: 'none' }}
          />
          <button
            type="button"
            style={quietButton(busy)}
            disabled={busy}
            onClick={() => fileInput.current?.click()}
          >Attach a file</button>
        </div>

        {!shownFiles.length && (
          <p style={{ fontSize: 13, color: 'var(--aq-text-muted)', margin: '4px 0 0' }}>
            Nothing attached yet.
          </p>
        )}

        {shownFiles.map((f: any) => {
          const mine = String(f.uploader_id) === String(currentUserId);
          return (
            <div key={f.id} style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0',
              borderTop: '1px solid var(--aq-border-light)', fontSize: 13,
            }}>
              <button
                type="button"
                onClick={() => open(String(f.file_url))}
                style={{
                  flex: 1, minWidth: 0, textAlign: 'left', font: 'inherit',
                  background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                  color: 'var(--aq-text)', textDecoration: 'underline',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}
              >{f.file_name || 'Untitled file'}</button>
              {on(f.task_id)}
              <span style={{ fontSize: 12, color: 'var(--aq-text-muted)', whiteSpace: 'nowrap' }}>
                {fileSize(f.file_size)}
              </span>
              {(mine || isPrivileged) && (
                <button
                  type="button"
                  style={{ ...quietButton(busy), color: '#991b1b', padding: '4px 9px' }}
                  disabled={busy}
                  onClick={() => startRemove(String(f.id), f.file_name || 'the file',
                    async () => { await deleteAttachment(String(f.id)); await refetchFiles(); })}
                >Delete</button>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Comments ─────────────────────────────────────────────── */}
      <div style={{ marginTop: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <span style={{
            fontSize: 10.5, fontWeight: 700, letterSpacing: '.09em',
            textTransform: 'uppercase', color: 'var(--aq-text-muted)',
          }}>Comments</span>
          <span aria-hidden style={{ flex: 1, height: 1, background: 'var(--aq-border-light)' }} />
        </div>

        <MentionBox
          value={draft}
          onChange={setDraft}
          onSubmit={send}
          people={profiles as any}
          placeholder="Say something. Type @ to tag somebody."
          disabled={busy}
          onPicksChange={setPicks}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
          <button
            type="button"
            style={inkButton(busy || !draft.trim())}
            disabled={busy || !draft.trim()}
            onClick={send}
          >Send</button>
        </div>

        {!shownComments.length && (
          <p style={{ fontSize: 13, color: 'var(--aq-text-muted)', margin: '10px 0 0' }}>
            Nothing said yet.
          </p>
        )}

        {shownComments.map((c: any) => {
          const mine = String(c.author_id) === String(currentUserId);
          return (
            <div key={c.id} style={{
              padding: '11px 0', borderTop: '1px solid var(--aq-border-light)',
            }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, flexWrap: 'wrap' }}>
                <strong style={{ fontSize: 13 }}>
                  {nameById.get(String(c.author_id)) ?? displayName(c.author) ?? 'Somebody'}
                </strong>
                <span style={{ fontSize: 11.5, color: 'var(--aq-text-muted)' }}>
                  {whenAgo(c.created_at)}
                </span>
                {on(c.task_id)}
                {(mine || isPrivileged) && (
                  <button
                    type="button"
                    aria-label="Delete this comment"
                    onClick={() => startRemove(String(c.id), 'the comment',
                      async () => { await deleteComment(String(c.id)); })}
                    style={{
                      marginLeft: 'auto', font: 'inherit', fontSize: 12, border: 'none',
                      background: 'none', cursor: 'pointer', color: 'var(--aq-text-muted)',
                      padding: 0,
                    }}
                  >Delete</button>
                )}
              </div>
              <div style={{ fontSize: 13.5, marginTop: 3, whiteSpace: 'pre-wrap' }}>
                <CommentText segments={parseCommentSegments(c.content, nameById) as any} />
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
