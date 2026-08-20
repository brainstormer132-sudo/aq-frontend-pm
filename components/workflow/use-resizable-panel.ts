'use client';

import { useEffect, useState } from 'react';

/**
 * The width of the slide-over panel, dragged by its left edge and remembered
 * between sessions.
 *
 * A vendor booking with twelve ads — each with a type, a platform, a date, a
 * price and a proof link — does not fit in 760px, and this panel is where
 * people read as much as they write. So it stretches.
 *
 * Two rules worth keeping in one place:
 *
 *   • The stored width is read in an effect, never during render. The server
 *     has no localStorage; reading it while rendering makes the first paint
 *     disagree with the markup React shipped, and React throws the client
 *     tree away to fix it.
 *   • It is always clamped against the CURRENT window. A width saved on a
 *     wide monitor and reopened on a laptop would otherwise hang off the
 *     screen with the close button on it.
 */

export const PANEL_WIDTH_KEY = 'aq.task-panel-width';
export const DEFAULT_PANEL_WIDTH = 760;
export const MIN_PANEL_WIDTH = 420;
/** How much of the list behind stays visible, so it can be clicked back to. */
const GUTTER = 120;

export function maxPanelWidth(viewport?: number): number {
  const w = viewport ?? (typeof window === 'undefined' ? 1520 : window.innerWidth);
  return Math.max(MIN_PANEL_WIDTH, w - GUTTER);
}

export function clampPanelWidth(width: number, viewport?: number): number {
  if (!Number.isFinite(width)) return DEFAULT_PANEL_WIDTH;
  return Math.min(maxPanelWidth(viewport), Math.max(MIN_PANEL_WIDTH, Math.round(width)));
}

/** The width a drag to this x-position means, for a right-anchored panel. */
export function widthFromPointer(clientX: number, viewport?: number): number {
  const w = viewport ?? (typeof window === 'undefined' ? 1520 : window.innerWidth);
  return clampPanelWidth(w - clientX, w);
}

export function useResizablePanel() {
  const [width, setWidth] = useState(DEFAULT_PANEL_WIDTH);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    try {
      const saved = Number(window.localStorage.getItem(PANEL_WIDTH_KEY));
      if (Number.isFinite(saved) && saved > 0) setWidth(clampPanelWidth(saved));
    } catch { /* private mode, or storage disabled — the default is fine */ }
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => setWidth(widthFromPointer(e.clientX));
    const onUp = () => {
      setDragging(false);
      setWidth((w) => remember(w));
    };
    // Selecting text while dragging turns the whole page blue.
    const prev = document.body.style.userSelect;
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      document.body.style.userSelect = prev;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [dragging]);

  useEffect(() => {
    const onResize = () => setWidth((w) => clampPanelWidth(w));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  /** Arrow keys move it too — a mouse-only control puts the extra columns
      out of reach of anyone not using one. */
  const nudge = (delta: number) => setWidth((w) => remember(clampPanelWidth(w + delta)));

  return { width, dragging, startDrag: () => setDragging(true), nudge };
}

function remember(w: number): number {
  try { window.localStorage.setItem(PANEL_WIDTH_KEY, String(w)); } catch { /* ignore */ }
  return w;
}
