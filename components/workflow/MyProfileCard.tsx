'use client';

import { useEffect, useRef, useState } from 'react';
import {
  useMyProfile, saveMyProfile, uploadMyAvatar, removeMyAvatar, changeMyPassword,
} from '@/hooks/use-workflow';
import {
  nameProblems, jobTitleProblems, avatarProblems, passwordProblems,
  profileUnchanged, MAX_AVATAR_BYTES,
} from '@/lib/profile';
import { Avatar } from '@/components/ui/Avatar';
import { SkeletonFields } from '@/components/Skeleton';

/**
 * Your own profile, in Settings.
 *
 * Everything here is what colleagues see: the name on your tasks and
 * comments, the face beside it, and what you do. Nothing here is about
 * permissions — the role is set by an owner further down the page, and
 * showing it as a field you cannot change would only invite the question.
 *
 * Saves on a button, not on blur. Every other field in this app commits when
 * you leave it, which is right for a field on somebody else's task and wrong
 * for your own name: half-typed names would appear to the whole team for as
 * long as it took to finish the word.
 */
export function MyProfileCard({
  userId, onSaved,
}: {
  userId: string;
  /** The page keeps its own copy of the name in the header. */
  onSaved?: (profile: { full_name: string; avatar_url: string | null }) => void;
}) {
  const { profile, loading, refetch } = useMyProfile(userId);

  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  // Fill the form once the row arrives, and again if it changes underneath.
  useEffect(() => {
    if (!profile) return;
    setName(profile.full_name ?? '');
    setTitle(profile.job_title ?? '');
  }, [profile?.id, profile?.full_name, profile?.job_title]);

  const problems = [...nameProblems(name), ...jobTitleProblems(title)];
  const unchanged = profile
    ? profileUnchanged(profile, { full_name: name, job_title: title })
    : true;

  const save = async () => {
    if (problems.length) { setError(problems[0]); return; }
    setSaving(true); setError(''); setNote('');
    try {
      const saved = await saveMyProfile(userId, {
        full_name: name.trim(),
        job_title: title.trim() || null,
      });
      await refetch();
      setNote('Saved.');
      if (saved) onSaved?.({ full_name: saved.full_name, avatar_url: saved.avatar_url });
    } catch (e: any) { setError(e?.message ?? String(e)); }
    finally { setSaving(false); }
  };

  const pickPicture = async (file: File | null) => {
    if (!file) return;
    const bad = avatarProblems(file);
    if (bad.length) { setError(bad[0]); return; }
    setSaving(true); setError(''); setNote('');
    try {
      const saved = await uploadMyAvatar(userId, file);
      await refetch();
      setNote('Picture updated.');
      if (saved) onSaved?.({ full_name: saved.full_name, avatar_url: saved.avatar_url });
    } catch (e: any) { setError(e?.message ?? String(e)); }
    finally {
      setSaving(false);
      // Let the same file be picked again after a failure.
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const dropPicture = async () => {
    setSaving(true); setError(''); setNote('');
    try {
      const saved = await removeMyAvatar(userId);
      await refetch();
      setNote('Picture removed.');
      if (saved) onSaved?.({ full_name: saved.full_name, avatar_url: saved.avatar_url });
    } catch (e: any) { setError(e?.message ?? String(e)); }
    finally { setSaving(false); }
  };

  return (
    <section className="aq-card" style={{ padding: 22, marginBottom: 18 }}>
      <h2 style={{ fontSize: 16, fontWeight: 700 }}>Your profile</h2>
      <p style={{ fontSize: 12.5, color: 'var(--aq-text-muted)', marginTop: 3 }}>
        What the rest of the team sees on your tasks, comments and mentions.
      </p>

      {loading ? (
        <div style={{ marginTop: 18 }}><SkeletonFields rows={3} label="Loading your profile" /></div>
      ) : (
        <>
          {/* ── The face ─────────────────────────────────────────── */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 18 }}>
            <div style={{ position: 'relative' }}>
              <Avatar user={profile} size="lg" />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="aq-btn aq-btn-secondary"
                  disabled={saving}
                  onClick={() => fileRef.current?.click()}
                  style={{ fontSize: 13, padding: '6px 14px' }}
                >{profile?.avatar_url ? 'Change picture' : 'Upload a picture'}</button>
                {profile?.avatar_url && (
                  <button
                    type="button"
                    className="aq-btn aq-btn-ghost"
                    disabled={saving}
                    onClick={dropPicture}
                    style={{ fontSize: 13, padding: '6px 12px' }}
                  >Remove</button>
                )}
              </div>
              <p style={{ fontSize: 11.5, color: 'var(--aq-text-muted)', marginTop: 5 }}>
                PNG, JPEG, WEBP or GIF, up to {Math.round(MAX_AVATAR_BYTES / 1024 / 1024)}MB.
                Without one you get your initials, which is a perfectly good answer.
              </p>
            </div>
          </div>

          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            hidden
            onChange={(e) => pickPicture(e.target.files?.[0] ?? null)}
          />

          {/* ── The words ────────────────────────────────────────── */}
          <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 460 }}>
            <label style={{ display: 'block' }}>
              <span className="aq-label">Name</span>
              <input
                className="aq-input"
                value={name}
                disabled={saving}
                placeholder="The name colleagues should see"
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !problems.length && !unchanged) save(); }}
              />
            </label>

            <label style={{ display: 'block' }}>
              <span className="aq-label">Job title</span>
              <input
                className="aq-input"
                value={title}
                disabled={saving}
                placeholder="e.g. Key account manager"
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !problems.length && !unchanged) save(); }}
              />
            </label>
          </div>

          {/* The first problem only. A list of everything wrong at once is
              a wall; people fix one thing and look again. */}
          {(error || problems.length > 0) && (
            <p style={{ fontSize: 12.5, color: 'var(--aq-error)', marginTop: 12 }}>
              {error || problems[0]}
            </p>
          )}
          {note && !error && (
            <p style={{ fontSize: 12.5, color: 'var(--aq-accent)', marginTop: 12 }}>{note}</p>
          )}

          <div style={{ marginTop: 14 }}>
            <button
              type="button"
              className="aq-btn aq-btn-primary"
              disabled={saving || unchanged || problems.length > 0}
              onClick={save}
              style={{ fontSize: 13.5 }}
            >{saving ? 'Saving…' : unchanged ? 'Saved' : 'Save changes'}</button>
          </div>

          <PasswordSection />
        </>
      )}
    </section>
  );
}

/**
 * Change your own password.
 *
 * Folded shut by default: it is not something you came here to do, and an
 * open pair of password boxes on a settings page invites browsers to fill
 * them in and people to wonder whether they must.
 */
function PasswordSection() {
  const [open, setOpen] = useState(false);
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const problems = passwordProblems(next, confirm);
  const touched = next.length > 0 || confirm.length > 0;

  const submit = async () => {
    if (problems.length) { setError(problems[0]); return; }
    setBusy(true); setError(''); setNote('');
    try {
      await changeMyPassword(next);
      setNext(''); setConfirm('');
      setNote('Password changed. It applies the next time you sign in anywhere else.');
    } catch (e: any) { setError(e?.message ?? String(e)); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ marginTop: 22, paddingTop: 18, borderTop: '1px solid var(--aq-border-light)' }}>
      {!open ? (
        <button
          type="button"
          className="aq-btn aq-btn-secondary"
          onClick={() => setOpen(true)}
          style={{ fontSize: 13, padding: '6px 14px' }}
        >Change password</button>
      ) : (
        <>
          <div className="aq-label">Change password</div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 8, maxWidth: 460 }}>
            <input
              className="aq-input"
              type="password"
              autoComplete="new-password"
              placeholder="New password"
              value={next}
              disabled={busy}
              onChange={(e) => setNext(e.target.value)}
              style={{ flex: 1, minWidth: 200 }}
            />
            <input
              className="aq-input"
              type="password"
              autoComplete="new-password"
              placeholder="Again"
              value={confirm}
              disabled={busy}
              onChange={(e) => setConfirm(e.target.value)}
              style={{ flex: 1, minWidth: 200 }}
            />
          </div>

          {/* Quiet until they have started typing — telling somebody their
              empty password is too short is not help. */}
          {(error || (touched && problems.length > 0)) && (
            <p style={{ fontSize: 12.5, color: 'var(--aq-error)', marginTop: 10 }}>
              {error || problems[0]}
            </p>
          )}
          {note && !error && (
            <p style={{ fontSize: 12.5, color: 'var(--aq-accent)', marginTop: 10 }}>{note}</p>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button
              type="button"
              className="aq-btn aq-btn-primary"
              disabled={busy || problems.length > 0}
              onClick={submit}
              style={{ fontSize: 13.5 }}
            >{busy ? 'Changing…' : 'Change password'}</button>
            <button
              type="button"
              className="aq-btn aq-btn-ghost"
              disabled={busy}
              onClick={() => { setOpen(false); setNext(''); setConfirm(''); setError(''); setNote(''); }}
              style={{ fontSize: 13.5 }}
            >Cancel</button>
          </div>
        </>
      )}
    </div>
  );
}
