'use client';

import { ReactNode } from 'react';
import { AQWatermark } from './AQWatermark';

/**
 * The shared welcome surface. Used by:
 *   - /auth                        (PM app sign in / create account)
 *   - /vendor/auth, /client/auth   (portal logins, via PortalAuthShell)
 *
 * It is no longer a split screen despite the name — the name is kept so the
 * three call sites don't have to change. A light page on AQ's paper tone, the
 * mark drawn oversized and transparent behind it, and the form in a single
 * card. `public/hub.html` is the same design in static HTML; change one and
 * you should change the other.
 *
 * Props are unchanged apart from the optional `heading`:
 *   - subtitle : the role line under the wordmark ("Client portal")
 *   - heading  : optional page headline. Omit it where `children` already
 *                bring their own <h2> — /auth does, the portals don't.
 *   - blurb    : one line of context under the headline
 *   - tabs     : optional pill toggle, rendered above the form
 */
export function SplitAuthLayout({
  subtitle, heading, blurb, children, tabs,
}: {
  subtitle: string;
  heading?: string;
  blurb?: string;
  children: ReactNode;
  tabs?: ReactNode;
}) {
  return (
    <div className="aq-welcome">
      {/* Scoped so this page renders the same whatever the surrounding theme
          does. The PM app's global --aq-bg is a tan that fights the card. */}
      <style>{`
        body{background:#f5f1ea !important;}
        .aq-welcome{
          position:relative; overflow:hidden; min-height:100vh;
          display:flex; flex-direction:column;
          background:#f5f1ea; color:#0b0b0e;
        }
        .aq-welcome-bar{
          position:relative; z-index:1;
          display:flex; align-items:center; justify-content:space-between; gap:16px;
          padding:22px clamp(22px,5vw,56px);
          border-bottom:1px solid #e4e2dc;
        }
        .aq-welcome-word{font-size:16px; font-weight:700; letter-spacing:-.015em; line-height:1.2}
        .aq-welcome-role{
          font-size:10px; font-weight:600; letter-spacing:.18em; text-transform:uppercase;
          color:#6b7280; margin-top:3px;
        }
        .aq-welcome-main{
          position:relative; z-index:1; flex:1;
          width:100%; max-width:1060px; margin:0 auto;
          padding:clamp(38px,7vh,74px) clamp(22px,5vw,56px) 46px;
          display:flex; flex-direction:column; justify-content:center;
        }
        .aq-welcome-head{
          font-size:clamp(32px,4.6vw,50px); font-weight:700; line-height:1.05;
          letter-spacing:-.03em; margin:0 0 12px; max-width:16ch;
        }
        .aq-welcome-sub{
          font-size:15px; line-height:1.65; color:#6b7280;
          max-width:52ch; margin:0 0 clamp(26px,5vh,40px);
        }
        .aq-welcome-card{
          max-width:440px; background:#fff; border:1px solid #e4e2dc;
          border-radius:16px; padding:30px 28px;
          display:flex; flex-direction:column; gap:14px;
        }

        /* The forms use the app's own .aq-input / .aq-btn classes. Restyle
           them here rather than in each call site, so all three surfaces
           match without touching their markup. */
        .aq-welcome .aq-input{
          width:100%; font:inherit; font-size:14px;
          padding:12px 14px; border:1px solid #e8e8ea; border-radius:11px;
          background:#fbfbfc; transition:.15s;
        }
        .aq-welcome .aq-input:focus{
          outline:none; border-color:#0f766e; background:#fff;
          box-shadow:0 0 0 3px rgba(15,118,110,.14);
        }
        .aq-welcome .aq-btn-primary{
          width:100%; font:inherit; font-size:14px; font-weight:600;
          padding:13px 18px; background:#0f766e !important; border:0 !important;
          color:#fff !important; border-radius:11px !important; cursor:pointer;
        }
        .aq-welcome .aq-btn-primary:hover{background:#0b544e !important}
        .aq-welcome a{color:#0b0b0e; font-weight:600}

        @media (max-width:720px){
          .aq-welcome-main{justify-content:flex-start; padding-top:34px}
          .aq-welcome-head{max-width:none}
          .aq-welcome-card{max-width:none}
        }
      `}</style>

      <AQWatermark />

      <div className="aq-welcome-bar">
        <div>
          <div className="aq-welcome-word">AQ Creativity</div>
          <div className="aq-welcome-role">{subtitle}</div>
        </div>
      </div>

      <div className="aq-welcome-main">
        {heading && <h1 className="aq-welcome-head">{heading}</h1>}
        {blurb && <p className="aq-welcome-sub">{blurb}</p>}
        {tabs}
        <div className="aq-welcome-card">{children}</div>
      </div>
    </div>
  );
}
