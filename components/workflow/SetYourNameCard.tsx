'use client';

import { useState } from 'react';
import { updateMyName } from '@/hooks/use-workflow';

/**
 * Prompt to set your own display name.
 *
 * Appears only while your profile has no real name — signup wrote your
 * email address in as one, which is why colleagues were seeing
 * "sbanjar@aqcreativity.com" instead of a person. Set a name and this
 * disappears for good.
 *
 * Deliberately self-service (Siraj's call): nobody else names you.
 */
export function SetYourNameCard({
  userId, onSaved,
}: {
  userId: string;
  onSaved: (name: string) => void;
}) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  const save = async () => {
    setBusy(true); setError('');
    try {
      const clean = name.trim().replace(/\s+/g, ' ');
      await updateMyName(userId, clean);
      onSaved(clean);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className="aq-card"
      style={{
        padding: '14px 18px', marginBottom: 16,
        borderLeft: '3px solid var(--aq-accent)',
      }}
    >
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        alignItems: 'baseline', gap: 12, flexWrap: 'wrap',
      }}>
        <div>
          <strong style={{ fontSize: 14 }}>What should your teammates call you?</strong>
          <p style={{ fontSize: 12, color: 'var(--aq-text-muted)', marginTop: 3 }}>
            Your profile has no name yet, so you show up to everyone else as
            &ldquo;Unnamed member&rdquo;. Set one and it appears everywhere —
            tasks, comments and mentions.
          </p>
        </div>
        <button
          type="button"
          className="aq-btn aq-btn-ghost"
          onClick={() => setDismissed(true)}
          style={{ padding: '2px 8px', fontSize: 12 }}
        >Not now</button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        <input
          className="aq-input"
          value={name}
          disabled={busy}
          placeholder="e.g. Sara Banjar"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) save(); }}
          style={{ flex: 1, minWidth: 220 }}
          aria-label="Your full name"
        />
        <button
          type="button"
          className="aq-btn aq-btn-primary"
          onClick={save}
          disabled={busy || !name.trim()}
        >{busy ? 'Saving…' : 'Save'}</button>
      </div>

      {error && (
        <p style={{ marginTop: 8, fontSize: 12, color: 'var(--aq-error)' }}>{error}</p>
      )}
    </section>
  );
}
