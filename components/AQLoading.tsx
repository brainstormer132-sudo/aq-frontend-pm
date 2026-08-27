'use client';

import React from 'react';
import { AQ_PATH_A, AQ_PATH_RING, AQ_TRACE_A, AQ_TRACE_RING } from '@/components/auth/AQMark';

/**
 * The mark, drawing itself, over whatever is loading.
 *
 * One component so every wait in the app looks like the same app waiting.
 * It sits *over* a skeleton rather than replacing it: the skeleton says what
 * shape is coming, the mark says the wait is ours rather than the network's.
 *
 * Two behaviours worth keeping when this is edited:
 *
 *  - **It is late.** Nothing is drawn for the first 260ms. Anything cached
 *    arrives well inside that, and an overlay that flashes for a tenth of a
 *    second reads as a glitch rather than as progress. A fast load shows the
 *    skeleton alone for a blink; only a slow one is worth interrupting for.
 *  - **It loops, with a rest.** A one-shot that finishes and then sits still
 *    while the page is *still* loading looks frozen — the exact impression a
 *    loader exists to prevent. The beat at the end of each cycle is what
 *    stops it reading as a spinner wearing a logo.
 *
 * **Where this belongs.** Whole-screen waits only: booting the workspace,
 * opening a campaign, opening a portal. NOT a section still filling in
 * inside a page you can already use — there the skeleton alone is right, and
 * an overlay would take the screen away from someone who can still work. The
 * rule Skeleton.tsx already states: a skeleton for a first load, a word for
 * something a person just triggered themselves.
 */
export function AQLoadingOverlay({ label = 'Loading' }: { label?: string }) {
  return (
    <div
      className="aq-load-veil"
      role="status"
      aria-live="polite"
      aria-busy="true"
      style={{
        position: 'fixed', inset: 0, display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        // Not a black scrim: the skeleton behind is the reassuring part, and
        // dimming it to nothing throws away the only thing on screen that
        // says what is coming.
        background: 'rgba(245, 245, 244, 0.58)',
        backdropFilter: 'blur(1.5px)',
        WebkitBackdropFilter: 'blur(1.5px)',
        zIndex: 60,
      }}
    >
      <AQLoadingStyle />
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16,
        padding: '30px 40px', borderRadius: 18,
        background: 'var(--aq-bg-elevated)',
        border: '1px solid var(--aq-border-light)',
        boxShadow: '0 12px 34px rgba(28, 25, 23, 0.12)',
      }}>
        <AQDrawingMark size={72} />
        <span style={{
          fontSize: 12, fontWeight: 700, letterSpacing: '.1em',
          textTransform: 'uppercase', color: 'var(--aq-text-muted)',
        }}>{label}</span>
      </div>
    </div>
  );
}

/**
 * The whole screen, when there is no skeleton worth drawing.
 *
 * For waits where the shape of what is coming is not known — a portal whose
 * role decides its layout, a route still working out who you are. A skeleton
 * of the wrong shape is worse than none, because it promises a page that
 * never arrives.
 */
export function AQLoadingScreen({ label = 'Loading' }: { label?: string }) {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--aq-bg)', position: 'relative' }}>
      <AQLoadingOverlay label={label} />
    </div>
  );
}

/** The mark itself, drawing and filling on a loop. */
export function AQDrawingMark({ size = 72 }: { size?: number }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 5906 5906"
      aria-hidden="true" focusable="false"
      style={{ display: 'block', color: 'var(--aq-text)' }}
    >
      <path className="aq-load-trace aq-load-trace-a" pathLength={100} d={AQ_TRACE_A} />
      <path className="aq-load-trace aq-load-trace-ring" pathLength={100} d={AQ_TRACE_RING} />
      <path className="aq-load-final aq-load-final-ring" d={AQ_PATH_RING} />
      <path className="aq-load-final aq-load-final-a" d={AQ_PATH_A} />
    </svg>
  );
}

/**
 * The keyframes.
 *
 * Rendered inline rather than living in globals.css because the stylesheet is
 * not in this repo's tree (see claude/aq-pm-context) — and because a loader
 * that carries its own CSS cannot be broken by a stylesheet change made for
 * something else. Duplicated <style> tags with identical content are free:
 * the browser dedupes the rules.
 */
export function AQLoadingStyle() {
  return (
    <style>{`
      .aq-load-trace{
        fill:none; stroke:currentColor; stroke-width:280;
        stroke-linecap:butt; stroke-linejoin:miter; stroke-miterlimit:10;
        stroke-dasharray:100; stroke-dashoffset:100;
      }
      .aq-load-trace-a     {animation:aq-load-draw 2.6s ease-in-out infinite}
      .aq-load-trace-ring  {animation:aq-load-draw 2.6s ease-in-out .35s infinite}
      .aq-load-final       {fill:currentColor; opacity:0}
      .aq-load-final-a     {animation:aq-load-fill 2.6s ease-in-out infinite}
      .aq-load-final-ring  {animation:aq-load-fill 2.6s ease-in-out .35s infinite}

      @keyframes aq-load-draw{
        0%{stroke-dashoffset:100} 30%{stroke-dashoffset:0}
        42%{stroke-dashoffset:0; opacity:1} 50%{opacity:0}
        92%{opacity:0; stroke-dashoffset:0} 100%{stroke-dashoffset:100; opacity:1}
      }
      @keyframes aq-load-fill{
        0%,38%{opacity:0} 50%,86%{opacity:1} 96%,100%{opacity:0}
      }

      .aq-load-veil{animation:aq-load-in .3s ease .26s both}
      @keyframes aq-load-in{from{opacity:0} to{opacity:1}}

      @media (prefers-reduced-motion:reduce){
        .aq-load-trace{animation:none !important; opacity:0 !important}
        .aq-load-final{animation:none !important; opacity:1 !important}
        .aq-load-veil{animation:none; opacity:1}
      }
    `}</style>
  );
}
