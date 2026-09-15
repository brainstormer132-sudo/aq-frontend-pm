'use client';

import { createContext, useContext, useEffect, useLayoutEffect } from 'react';
import { ringOffset, type BandExtras } from '@/lib/band';

/**
 * The dark band every screen opens with.
 *
 * page.tsx draws one ScreenBand above whichever view is showing, with the
 * screen's name and question. A view that has something worth a hero (a
 * figure, the severity counts) publishes it through BandContext from an
 * effect, and the band redraws. Nothing here fetches anything: the numbers
 * are the ones the view already has on screen.
 */

export const BandContext = createContext<(extras: BandExtras | null) => void>(() => {});

// Layout effect so the band shows the view's title on the same frame the
// view mounts rather than one frame late; plain effect on the server, where
// useLayoutEffect only warns.
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** Publish extras for as long as the calling view is mounted. */
export function useBandExtras(extras: BandExtras | null) {
  const set = useContext(BandContext);
  useIsoLayoutEffect(() => {
    set(extras);
    return () => set(null);
  }, [extras, set]);
}

const TONE_DOT: Record<string, string> = {
  urgent: '#f87171', soon: '#fbbf24', tidy: '#9ca3af', neutral: '#7fa9b5',
};

export function ScreenBand({
  title, sub, extras, eyebrow,
}: {
  title: string;
  sub: string;
  extras: BandExtras | null;
  /** Small line above the title: workspace and role. */
  eyebrow?: string;
}) {
  const t = extras?.title ?? title;
  const s = extras?.sub ?? sub;
  const hero = extras?.hero ?? null;
  const chips = extras?.chips ?? [];
  const hasRing = hero != null && hero.pct != null;

  return (
    <header className="aq-band" key={t}>
      <div className="aq-band-text">
        {eyebrow && <p className="aq-band-eyebrow">{eyebrow}</p>}
        <h1 className="aq-band-title">{t}</h1>
        <p className="aq-band-sub">{s}</p>
        {chips.length > 0 && (
          <div className="aq-band-chips" role="list">
            {chips.map((c) => {
              const inner = (
                <>
                  <i className="aq-band-dot" style={{ background: TONE_DOT[c.tone] }} aria-hidden="true" />
                  {c.label} <b>{c.count}</b>
                </>
              );
              return c.onClick ? (
                <button
                  key={c.label} type="button" role="listitem"
                  className={`aq-band-chip${c.count === 0 ? ' is-zero' : ''}`}
                  onClick={c.onClick}
                >{inner}</button>
              ) : (
                <span key={c.label} role="listitem" className={`aq-band-chip${c.count === 0 ? ' is-zero' : ''}`}>{inner}</span>
              );
            })}
          </div>
        )}
      </div>
      {hero && (
        <div className="aq-band-hero">
          {hasRing && (
            <svg className="aq-band-ring" viewBox="0 0 54 54" aria-hidden="true">
              <circle className="bg" cx="27" cy="27" r="22" />
              <circle className="fg" cx="27" cy="27" r="22" style={{ strokeDashoffset: ringOffset(hero.pct) }} />
            </svg>
          )}
          <div>
            <strong>{hero.value}</strong>
            <small>{hero.label}</small>
          </div>
        </div>
      )}
    </header>
  );
}
