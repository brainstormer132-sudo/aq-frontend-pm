'use client';

import React, { useEffect, useState } from 'react';
import { AQDrawingMark, AQLoadingStyle } from '@/components/AQLoading';

/**
 * The first thing you see after signing in.
 *
 * ── Why this exists ───────────────────────────────────────────────
 *
 * Signing in used to drop you straight onto a half-drawn dashboard: the
 * shell rendered, then the profile arrived, then the contracts, and the
 * page moved twice while you were reading it. For a vendor or a client
 * who signs in once a month, that first second is most of their
 * impression of the whole thing.
 *
 * So the wait gets a face. It is the same mark, drawing itself, that the
 * campaign page and the portal shell already use — the point of a house
 * animation is that it turns up in the same places for the same reason.
 *
 * ── Two rules it keeps ────────────────────────────────────────────
 *
 *  - **It never outstays the load.** It leaves as soon as the portal has
 *    what it needs, or after `maxMs`, whichever is first. A greeting that
 *    holds the screen after the page is ready is a page that got slower
 *    on purpose.
 *  - **It greets by name only when there is a name.** "Welcome back,"
 *    with a blank after it is worse than "Welcome back." on its own, and
 *    the name arrives a moment after the session does.
 */
export function PortalWelcome({
  name,
  firstTime = false,
  ready,
  maxMs = 1600,
  onDone,
}: {
  /** Who they are. Blank until their profile lands, and that is fine. */
  name?: string | null;
  /** True just after setting a password — a different sentence is owed. */
  firstTime?: boolean;
  /** The portal has its data. The greeting steps aside as soon as this is true. */
  ready: boolean;
  maxMs?: number;
  onDone: () => void;
}) {
  const [leaving, setLeaving] = useState(false);

  // A floor as well as a ceiling: on a warm cache `ready` is true almost
  // immediately, and something that appears and vanishes inside 200ms
  // reads as a flicker rather than as a greeting.
  const MIN_MS = 900;
  const [floorPassed, setFloorPassed] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setFloorPassed(true), MIN_MS);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!(ready && floorPassed)) return;
    setLeaving(true);
    const t = setTimeout(onDone, 260);   // matches the fade below
    return () => clearTimeout(t);
  }, [ready, floorPassed, onDone]);

  // The ceiling. If something never finishes loading, the greeting must
  // still get out of the way — an apology screen you cannot leave is the
  // worst version of this.
  useEffect(() => {
    const t = setTimeout(() => { setLeaving(true); setTimeout(onDone, 260); }, maxMs);
    return () => clearTimeout(t);
  }, [maxMs, onDone]);

  const first = (name ?? '').trim().split(/\s+/)[0] ?? '';

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed', inset: 0, zIndex: 80,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 22,
        background: 'var(--aq-bg)',
        opacity: leaving ? 0 : 1,
        transition: 'opacity .26s ease',
        pointerEvents: leaving ? 'none' : undefined,
      }}
    >
      <AQLoadingStyle />
      <AQDrawingMark size={84} />

      <div style={{ textAlign: 'center', padding: '0 24px' }}>
        <p style={{
          fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em',
          color: 'var(--aq-text)', margin: 0,
        }}>
          {firstTime
            ? (first ? `You're all set, ${first}.` : "You're all set.")
            : (first ? `Welcome back, ${first}.` : 'Welcome back.')}
        </p>
        <p style={{
          fontSize: 13, color: 'var(--aq-text-muted)', marginTop: 8,
        }}>
          {firstTime
            ? 'Your account is ready — bringing everything in now.'
            : 'Getting your things together.'}
        </p>
      </div>
    </div>
  );
}
