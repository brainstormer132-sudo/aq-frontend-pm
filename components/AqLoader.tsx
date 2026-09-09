'use client';

import { AQ_PATH_RING, AQ_PATH_A } from '@/components/auth/AQMark';

/**
 * The waiting state, wearing the AQ mark instead of a bare spinner.
 *
 * The register and the campaign screens showed an empty card while their
 * data paged in - a blank rectangle that reads as "broken", not "loading".
 * This spins the real logo (the same two vector paths the sidebar draws, so
 * there is no second asset to keep in sync) and, on the block variant, says
 * what it is waiting for underneath.
 */

export function AqLoader({ size = 22, title }: { size?: number; title?: string }) {
  return (
    <span
      role={title ? 'status' : undefined}
      aria-label={title}
      style={{ display: 'inline-flex', color: 'var(--aq-accent, #14603a)' }}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 5906 5906"
        aria-hidden
        focusable="false"
        style={{ display: 'block', transformOrigin: '50% 50%', animation: 'aqSpin 1s linear infinite' }}
      >
        <path fill="currentColor" opacity={0.28} d={AQ_PATH_RING} />
        <path fill="currentColor" d={AQ_PATH_A} />
      </svg>
    </span>
  );
}

/** A centred loading panel for the middle of a screen. */
export function AqLoaderBlock({ label = 'Loading\u2026' }: { label?: string }) {
  return (
    <div
      className="aq-card animate-fade-in"
      role="status"
      aria-live="polite"
      style={{
        padding: 40, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 12,
      }}
    >
      <AqLoader size={34} />
      <span style={{ fontSize: 12.5, color: 'var(--aq-text-muted)', fontWeight: 500 }}>{label}</span>
    </div>
  );
}
