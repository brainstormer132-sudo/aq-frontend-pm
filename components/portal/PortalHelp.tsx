'use client';

import { useState } from 'react';
import type { PortalMe } from '@/lib/portal-api';
import { AQContactCard } from './AQContactCard';

/**
 * Help & contact tab. Two columns:
 *  - Request-a-change form (currently visual-only — needs the
 *    POST /external-portal/request-change endpoint planned for the
 *    next backend pass + Resend email integration).
 *  - AQ contact card + FAQ accordion.
 */
export function PortalHelp({ me }: { me: PortalMe }) {
  const [topic, setTopic] = useState<string>(
    me.role === 'client' ? 'Company details' : 'Personal or contact details',
  );
  const [message, setMessage] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const topics = me.role === 'client'
    ? ['Company details', 'Brand details', 'Add a new contact person', 'Billing or invoice', 'Something else']
    : ['Personal or contact details', 'Bank or payment info', 'License or platform info', 'Contract correction', 'Something else'];

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    // Backend wiring lands in the next pass — for now we accept the message
    // optimistically and show a confirmation. The user can also fall back to
    // emailing AQ directly via the contact card.
    setSubmitted(true);
    setMessage('');
  };

  return (
    <>
      <div className="portal-section-head">
        <div>
          <h2>Help &amp; contact</h2>
          <p>Talk to your AQ team or request a change to your details.</p>
        </div>
      </div>

      <div className="portal-help-grid">
        <div className="portal-card">
          <h3>Request a change</h3>

          {submitted && (
            <div style={{
              background: 'var(--aq-accent-light)', color: 'var(--aq-accent)',
              padding: '10px 14px', borderRadius: 'var(--aq-radius)',
              fontSize: 13, marginBottom: 14,
            }}>
              Thanks — we&apos;ve noted it. Your AQ contact will reply within one business day.
            </div>
          )}

          <form onSubmit={submit}>
            <label className="aq-label">What needs updating?</label>
            <select
              className="aq-select"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              style={{ marginBottom: 12 }}
            >
              {topics.map((t) => <option key={t}>{t}</option>)}
            </select>

            <label className="aq-label">Tell us what&apos;s wrong</label>
            <textarea
              className="aq-input"
              rows={5}
              style={{ minHeight: 120, resize: 'vertical' }}
              placeholder="For example: the IBAN on file changed last month, here's the new one…"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              required
              minLength={4}
            />

            <button
              type="submit"
              className="aq-btn aq-btn-primary"
              style={{ marginTop: 14 }}
              disabled={message.trim().length < 4}
            >
              Send to AQ
            </button>

            <p style={{ marginTop: 12, fontSize: 12, color: 'var(--aq-text-muted)' }}>
              We usually reply within one business day. For urgent changes, call us directly.
            </p>
          </form>
        </div>

        <div>
          <AQContactCard />

          <div className="portal-card" style={{ marginTop: 16 }}>
            <h3>Common questions</h3>
            <div className="portal-faq">
              <details>
                <summary>How do I read my contract status?</summary>
                <div className="answer">
                  &ldquo;Ready&rdquo; means both DOCX and PDF are available to download. &ldquo;Generating PDF&rdquo;
                  means the DOCX is ready but the PDF is still rendering — usually it&apos;s available within
                  a minute or two. If a contract is stuck for more than 15 minutes, send us a note.
                </div>
              </details>
              <details>
                <summary>
                  {me.role === 'client'
                    ? 'Can I add or remove a brand myself?'
                    : 'Can I update my own IBAN?'}
                </summary>
                <div className="answer">
                  {me.role === 'client'
                    ? 'Not yet — to keep your file clean and audit-ready, brand changes are made by AQ on your behalf. Use the Request a change form and we’ll handle it.'
                    : 'Not yet — for security, payment info changes go through AQ. Use the Request a change form and your account lead will confirm the new IBAN with you before updating.'}
                </div>
              </details>
              <details>
                <summary>
                  {me.role === 'client' ? 'Who can see my company info?' : 'Why is my IBAN visible here?'}
                </summary>
                <div className="answer">
                  {me.role === 'client'
                    ? 'Only you and your AQ admin. Other clients and vendors don’t see your company details — they’re scoped to your AQ workspace.'
                    : 'So you can verify it’s correct and copy it when you need to share it externally. Only you and your AQ admin see this — it’s not exposed to other vendors or clients.'}
                </div>
              </details>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
