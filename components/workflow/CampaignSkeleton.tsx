'use client';

import React from 'react';
import { SkeletonLine } from '@/components/Skeleton';
import { AQLoadingOverlay } from '@/components/AQLoading';

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
 * The overlay is `AQLoadingOverlay`, shared with every other whole-screen
 * wait in the app — see that file for why it appears late and why it loops.
 */
export function CampaignLoading() {
  return (
    <div style={{ background: 'var(--aq-bg)', minHeight: '100vh', position: 'relative' }}>

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

      <AQLoadingOverlay label="Loading the campaign" />
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
