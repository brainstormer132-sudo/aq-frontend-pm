'use client';

import { useEffect, useState } from 'react';
import { type ExternalInvite, buildSetupLink } from '@/lib/contract-api';

/**
 * Shown after admin issues an invite. The link is the only way the
 * recipient can set up their account, since email is off in dev. Admin
 * copies it manually and sends it however they like.
 */
export function InviteLinkModal({
  invite, onClose,
}: {
  invite: ExternalInvite | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => { setCopied(false); }, [invite?.id]);

  if (!invite) return null;
  const link = buildSetupLink(invite);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* no-op — user can still select and copy by hand */
    }
  };

  return (
    <div onClick={onClose} style={overlay}>
      <div onClick={(e) => e.stopPropagation()} className="aq-card" style={panel}>
        <h3 style={{ fontSize: 16, fontWeight: 800, margin: 0 }}>
          Invite ready for {invite.email}
        </h3>
        <p style={{ color: 'var(--aq-text-muted)', fontSize: 13, margin: '6px 0 16px' }}>
          Send this link to the {invite.role}. They open it, choose a password, and
          they're in. The link expires {new Date(invite.expires_at).toLocaleString()}.
        </p>

        <div style={linkBox}>
          <code style={linkText}>{link}</code>
          <button type="button" className="aq-btn aq-btn-primary" onClick={copy}>
            {copied ? 'Copied' : 'Copy link'}
          </button>
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            className="aq-btn aq-btn-secondary"
            style={{ display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }}
            title="Open the setup page in a new tab — useful for testing the portal locally"
          >
            Open setup
          </a>
        </div>

        <details style={{ marginTop: 14 }}>
          <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--aq-text-muted)' }}>
            Hint — message text you can paste
          </summary>
          <textarea
            readOnly
            style={pasteBox}
            value={`Hi,\n\nYou now have access to the AQ Creativity ${invite.role} portal. Open this link to set your password and sign in:\n\n${link}\n\nThe link works for 7 days.`}
          />
        </details>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <button type="button" className="aq-btn aq-btn-ghost" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 1200,
  background: 'rgba(15, 23, 42, 0.45)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
};

const panel: React.CSSProperties = {
  maxWidth: 540, width: '100%', padding: 24,
  background: 'var(--aq-bg-elevated)',
  boxShadow: '0 16px 48px rgba(15, 23, 42, 0.25)',
};

const linkBox: React.CSSProperties = {
  display: 'flex', gap: 8, alignItems: 'stretch',
  border: '1px solid var(--aq-border-light)',
  borderRadius: 'var(--aq-radius)',
  padding: 8,
};

const linkText: React.CSSProperties = {
  flex: 1, padding: '8px 10px',
  background: 'transparent', wordBreak: 'break-all',
  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
  fontSize: 12, lineHeight: 1.5,
};

const pasteBox: React.CSSProperties = {
  width: '100%', minHeight: 110, marginTop: 8,
  padding: 10, fontSize: 13,
  border: '1px solid var(--aq-border-light)',
  borderRadius: 'var(--aq-radius)',
  fontFamily: 'inherit',
};
