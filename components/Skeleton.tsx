'use client';

import { AQLoadingOverlay } from '@/components/AQLoading';

/**
 * Placeholders shaped like the thing that is loading.
 *
 * The app used to show nothing while it fetched — and an empty list and a
 * list that has not arrived yet look exactly the same. People read the blank
 * as "there is nothing here" or as the app being broken, then clicked around
 * or reloaded, which made it slower still.
 *
 * These are deliberately the same size as the real content, so nothing jumps
 * when the data lands. The shimmer is the only part that says "wait" — no
 * spinner takes over the screen, because the rest of the page is usable.
 *
 * Rule of thumb: a skeleton for a first load, where the shape is known and
 * the wait is short. A word ("Saving…", "Loading…") for anything a person
 * just triggered themselves, because then they want to know it registered,
 * not what shape the answer will be.
 */

export function SkeletonLine({
  width = '100%', height = 12, style,
}: {
  width?: number | string;
  height?: number;
  style?: React.CSSProperties;
}) {
  return <div className="aq-skeleton" style={{ width, height, ...style }} aria-hidden="true" />;
}

export function SkeletonBlock({
  height = 120, style,
}: { height?: number; style?: React.CSSProperties }) {
  return (
    <div
      className="aq-skeleton"
      style={{ width: '100%', height, borderRadius: 'var(--aq-radius)', ...style }}
      aria-hidden="true"
    />
  );
}

/**
 * One screen-reader announcement for a whole skeleton region.
 *
 * The pieces are aria-hidden — forty shimmering divs read out one at a time
 * is worse than silence. This says the one useful thing instead.
 */
export function SkeletonRegion({
  label = 'Loading', children,
}: { label?: string; children: React.ReactNode }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span style={SR_ONLY}>{label}</span>
      {children}
    </div>
  );
}

/** Rows in a list — the shape All Tasks, Contracts and the registries take. */
export function SkeletonRows({
  rows = 6, height = 52, gap = 8, label = 'Loading list',
}: { rows?: number; height?: number; gap?: number; label?: string }) {
  return (
    <SkeletonRegion label={label}>
      <div style={{ display: 'flex', flexDirection: 'column', gap }}>
        {Array.from({ length: rows }, (_, i) => (
          <div
            key={i}
            className="aq-card"
            style={{
              height, padding: '0 16px', display: 'flex', alignItems: 'center', gap: 12,
              // Later rows fade out: the eye reads it as a list continuing
              // past the fold rather than as exactly six things.
              opacity: 1 - i * (0.7 / Math.max(rows, 1)),
            }}
          >
            <SkeletonLine width={i % 3 === 0 ? '38%' : '26%'} height={13} />
            <SkeletonLine width="14%" height={11} />
            <div style={{ flex: 1 }} />
            <SkeletonLine width={64} height={18} style={{ borderRadius: 999 }} />
          </div>
        ))}
      </div>
    </SkeletonRegion>
  );
}

/** Label-and-value rows — the detail panel's shape. */
export function SkeletonFields({
  rows = 6, label = 'Loading details',
}: { rows?: number; label?: string }) {
  return (
    <SkeletonRegion label={label}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: 12, alignItems: 'center' }}>
            <SkeletonLine width={90 + (i % 3) * 22} height={11} />
            <SkeletonLine width={`${52 + ((i * 13) % 40)}%`} height={15} />
          </div>
        ))}
      </div>
    </SkeletonRegion>
  );
}

/** A row of stat tiles, then a chart — the dashboard and Data view shape. */
export function SkeletonDashboard({ tiles = 4 }: { tiles?: number }) {
  return (
    <SkeletonRegion label="Loading dashboard">
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${tiles}, 1fr)`, gap: 14 }}>
        {Array.from({ length: tiles }, (_, i) => (
          <div key={i} className="aq-card" style={{ padding: 18 }}>
            <SkeletonLine width="55%" height={10} />
            <SkeletonLine width="42%" height={26} style={{ marginTop: 12 }} />
          </div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 14 }}>
        <div className="aq-card" style={{ padding: 18 }}>
          <SkeletonLine width="34%" height={12} />
          <SkeletonBlock height={180} style={{ marginTop: 14 }} />
        </div>
        <div className="aq-card" style={{ padding: 18 }}>
          <SkeletonLine width="34%" height={12} />
          <SkeletonBlock height={180} style={{ marginTop: 14 }} />
        </div>
      </div>
    </SkeletonRegion>
  );
}

/**
 * The whole page, while the workspace is still being worked out.
 *
 * Replaces a centred "Loading workspace…" card. The sidebar and the header
 * are in the same place they will be a moment later, so the app appears to
 * settle rather than to jump.
 */
export function SkeletonShell() {
  return (
    <SkeletonRegion label="Loading workspace">
      {/* Booting is the app's longest wait — auth, membership, role, then the
          first screen — and it is the one people watch. The mark goes over
          it; the skeleton underneath still says what is coming. */}
      <AQLoadingOverlay label="Loading your workspace" />
      <div style={{ display: 'flex', minHeight: '100vh' }}>
        <div style={{
          width: 260, flexShrink: 0, background: 'var(--aq-sidebar-bg)',
          padding: 22, display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
            <div style={{
              width: 40, height: 40, borderRadius: 12, background: 'var(--aq-accent)',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff', fontWeight: 800,
            }}>AQ</div>
            <div style={{ flex: 1 }}>
              <div style={{ ...ON_DARK, width: '70%', height: 12 }} />
              <div style={{ ...ON_DARK, width: '45%', height: 9, marginTop: 6 }} />
            </div>
          </div>
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} style={{ ...ON_DARK, height: 32, borderRadius: 10, opacity: 0.5 - i * 0.04 }} />
          ))}
        </div>

        <div style={{ flex: 1, padding: 28 }}>
          <SkeletonLine width={160} height={10} />
          <SkeletonLine width={300} height={28} style={{ marginTop: 8 }} />
          <SkeletonLine width={420} height={13} style={{ marginTop: 10 }} />
          <div style={{ marginTop: 26 }}><SkeletonDashboard /></div>
        </div>
      </div>
    </SkeletonRegion>
  );
}

/** The shimmer does not show on the dark sidebar, so that half uses tint. */
const ON_DARK: React.CSSProperties = {
  background: 'rgba(255,255,255,0.10)',
  borderRadius: 6,
};

const SR_ONLY: React.CSSProperties = {
  position: 'absolute', width: 1, height: 1, padding: 0, margin: -1,
  overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
};
