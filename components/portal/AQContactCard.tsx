'use client';

/**
 * Static AQ-Creativity contact card. Placeholder values until the
 * workspace_contacts table + GET /external-portal/workspace-contacts
 * endpoint land (planned for the next backend pass).
 *
 * Keeping this in its own file so swapping to an API-driven version
 * later is a single-file change.
 */

import { initials } from './PortalUI';

interface PortalContact {
  name: string;
  role: string;
  email: string;
  phone?: string;
}

const AQ_CONTACTS: PortalContact[] = [
  { name: 'Siraj Qurunfulah', role: 'Account lead', email: 'siraj@aqcreativity.com' },
  { name: 'AQ Operations',    role: 'Contracts & billing', email: 'hello@aqcreativity.com' },
];

const AQ_PHONE = '+971 50 000 0000';
const AQ_EMAIL = 'hello@aqcreativity.com';

export function AQContactCard() {
  return (
    <div className="portal-card portal-contact">
      <h3>Your AQ contact</h3>
      {AQ_CONTACTS.map((p) => (
        <div key={p.email} className="person">
          <div className="portal-avatar">{initials(p.name)}</div>
          <div className="meta">
            <strong>{p.name}</strong>
            <span>{p.role} · {p.email}</span>
          </div>
        </div>
      ))}
      <div className="links">
        <a href={`mailto:${AQ_EMAIL}`}>✉ Email</a>
        <a href={`tel:${AQ_PHONE.replace(/\s+/g, '')}`}>☏ Call</a>
      </div>
    </div>
  );
}
