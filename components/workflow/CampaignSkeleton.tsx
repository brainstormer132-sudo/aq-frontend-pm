'use client';

import React from 'react';
import { SkeletonLine } from '@/components/Skeleton';
import { AQ_PATH_A, AQ_PATH_RING, AQ_TRACE_A, AQ_TRACE_RING } from '@/components/auth/AQMark';

/**
 * What the campaign page looks like before it has anything to say.
 *
 * Two halves, doing two different jobs:
 *
 *  - **The skeleton** is the page's own shape — ink band, index, cards — so
 *    nothing moves when the data lands. A campaign is seven fetches, and a
 *    blank screen for the length of the slowest one reads as broken.
 *  - **The mark**, drawing itself in the middle, says the wait is ours rather
 *    than the network's. It is the same trace-then-fill the welcome page
 *    uses, so it is recognisably the same logo behaving the same way.
 *
 * The overlay is deliberately **late**: nothing is drawn for the first 260ms.
 * A cached campaign arrives well inside that, and an overlay that flashes for
 * a tenth of a second is worse than no overlay — it reads as a glitch. So a
 * fast load shows the skeleton alone for a blink, and only a slow one is
 * worth interrupting for.
 *
 * The animation loops rather than playing once. A one-shot that finishes and
 * then sits still while the page is *still* loading looks frozen, which is
 * the exact impression a loader exists to prevent.
 */
export function CampaignLoading() {
  return (
    <div style={{ background: 'var(--aq-bg)', minHeight: '100vh', position: 'relative' }}>
      <style>{`
        /* ── the mark, drawing itself, over and over ── */
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

        /* Draw, hold, release. The gap at the end is the beat that stops it
           reading as a spinner — a logo that never rests is a busy-indicator
           wearing a costume. */
        @keyframes aq-load-draw{
          0%{stroke-dashoffset:100} 30%{stroke-dashoffset:0}
          42%{stroke-dashoffset:0; opacity:1} 50%{opacity:0}
          92%{opacity:0; stroke-dashoffset:0} 100%{stroke-dashoffset:100; opacity:1}
        }
        @keyframes aq-load-fill{
          0%,38%{opacity:0} 50%,86%{opacity:1} 96%,100%{opacity:0}
        }

        /* Nothing at all for a quarter of a second. */
        .aq-load-veil{animation:aq-load-in .3s ease .26s both}
        @keyframes aq-load-in{from{opacity:0} to{opacity:1}}

        @media (prefers-reduced-motion:reduce){
          .aq-load-trace{animation:none !important; opacity:0 !important}
          .aq-load-final{animation:none !important; opacity:1 !important}
          .aq-load-veil{animation:none; opacity:1}
        }
      `}</style>

      {/* ── The page's shape, behind ─────────────────────────────── */}

      {/* Breadcrumb */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '11px 22px', borderBottom: '1px solid var(--aq-border-light)',
        background: 'var(--aq-bg-elevated)',
      }}>
        <SkeletonLine width={64} height={11} />
        <SkeletonLine width={92} height={11} />
        <SkeletonLine width={150} height={11} />
      </div>

      {/* The ink band. Drawn in ink, not shimmer — it is a known quantity,
          and a flashing black bar is a strobe rather than a placeholder. */}
      <header style={{ background: '#141210' }}>
        <div style={{ maxWidth: 1280, margin: '0 auto', padding: '24px 22px 22px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <span style={{ width: 22, height: 22, borderRadius: 6, background: '#2c2825' }} />
            <Bone w={190} h={11} />
            <Bone w={74} h={16} r={999} />
          </div>
          <Bone w="min(520px, 70%)" h={40} r={9} />
          <div style={{ display: 'flex', gap: 34, marginTop: 22 }}>
            {[0, 1, 2, 3].map((i) => (
              <span key={i}>
                <Bone w={92} h={22} r={5} />
                <span style={{ display: 'block', marginTop: 7 }}><Bone w={62} h={9} /></span>
              </span>
            ))}
          </div>
          <div style={{ marginTop: 20 }}><Bone w="100%" h={8} r={99} /></div>
        </div>
      </header>

      {/* Index and cards */}
      <div style={{
        maxWidth: 1280, margin: '0 auto', padding: 22,
        display: 'grid', gridTemplateColumns: 'minmax(0, 194px) minmax(0, 1fr)',
        gap: 26, alignItems: 'start',
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '4px 10px 16px' }}>
            <span className="aq-skeleton" style={{ width: 42, height: 42, borderRadius: '50%' }} />
            <span><SkeletonLine width={54} height={14} /><span style={{ display: 'block', marginTop: 5 }}><SkeletonLine width={40} height={9} /></span></span>
          </div>
          {[124, 96, 110, 138, 118, 108, 92, 96].map((w, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 10px' }}>
              <span className="aq-skeleton" style={{ width: 15, height: 15, borderRadius: '50%' }} />
              <SkeletonLine width={w} height={11} />
            </div>
          ))}
        </div>

        <div>
          {/* The vendor tiles, in their grid. */}
          <section className="aq-card" style={{ padding: '15px 18px 18px', marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <span className="aq-skeleton" style={{ width: 8, height: 8, borderRadius: 2 }} />
              <SkeletonLine width={186} height={14} />
              <SkeletonLine width={140} height={11} />
            </div>
            <div style={{
              display: 'grid', gap: 11,
              gridTemplateColumns: 'repeat(auto-fill, minmax(214px, 1fr))',
            }}>
              {[0, 1, 2, 3].map((i) => (
                <div key={i} style={{
                  border: '1px solid var(--aq-border-light)', borderRadius: 12,
                  padding: 13, background: 'var(--aq-bg)',
                }}>
                  <span className="aq-skeleton" style={{ width: 38, height: 38, borderRadius: 11, display: 'block' }} />
                  <span style={{ display: 'block', marginTop: 11 }}><SkeletonLine width="82%" height={12} /></span>
                  <span style={{ display: 'block', marginTop: 8 }}><SkeletonLine width={96} height={16} style={{ borderRadius: 999 }} /></span>
                  <span style={{ display: 'block', marginTop: 10 }}><SkeletonLine width={104} height={18} /></span>
                  <span style={{ display: 'block', marginTop: 10 }}><SkeletonLine width="100%" height={4} /></span>
                </div>
              ))}
            </div>
          </section>

          {[0, 1].map((i) => (
            <section key={i} className="aq-card" style={{ padding: '15px 18px 18px', marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <span className="aq-skeleton" style={{ width: 8, height: 8, borderRadius: 2 }} />
                <SkeletonLine width={i ? 132 : 168} height={14} />
              </div>
              <SkeletonLine width="88%" height={11} style={{ marginBottom: 9 }} />
              <SkeletonLine width="64%" height={11} />
            </section>
          ))}
        </div>
      </div>

      {/* ── The mark, in the middle ──────────────────────────────── */}
      <div
        className="aq-load-veil"
        role="status"
        aria-live="polite"
        aria-busy="true"
        style={{
          position: 'fixed', inset: 0, display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          // Not a black scrim: the skeleton behind is the reassuring part and
          // dimming it to nothing throws away the only thing that says what is
          // coming. Light enough that the ink band still reads as ink — at 72%
          // it washed to grey and the page lost the one thing that identifies
          // it while you wait.
          background: 'rgba(245, 245, 244, 0.58)',
          backdropFilter: 'blur(1.5px)',
          WebkitBackdropFilter: 'blur(1.5px)',
          zIndex: 60,
        }}
      >
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16,
          padding: '30px 40px', borderRadius: 18,
          background: 'var(--aq-bg-elevated)',
          border: '1px solid var(--aq-border-light)',
          boxShadow: '0 12px 34px rgba(28, 25, 23, 0.12)',
        }}>
          <svg
            width={72} height={72} viewBox="0 0 5906 5906"
            aria-hidden="true" focusable="false"
            style={{ display: 'block', color: 'var(--aq-text)' }}
          >
            <path className="aq-load-trace aq-load-trace-a" pathLength={100} d={AQ_TRACE_A} />
            <path className="aq-load-trace aq-load-trace-ring" pathLength={100} d={AQ_TRACE_RING} />
            <path className="aq-load-final aq-load-final-ring" d={AQ_PATH_RING} />
            <path className="aq-load-final aq-load-final-a" d={AQ_PATH_A} />
          </svg>
          <span style={{
            fontSize: 12, fontWeight: 700, letterSpacing: '.1em',
            textTransform: 'uppercase', color: 'var(--aq-text-muted)',
          }}>Loading the campaign</span>
        </div>
      </div>
    </div>
  );
}

/** A shimmerless placeholder, for use on the ink band where shimmer strobes. */
function Bone({ w, h, r = 4 }: { w: number | string; h: number; r?: number }) {
  return (
    <span aria-hidden style={{
      display: 'block', width: w, height: h, borderRadius: r, background: '#2c2825',
    }} />
  );
}
