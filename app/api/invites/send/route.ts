import { NextResponse } from 'next/server';

type InviteEmailBody = {
  email?: string;
  link?: string;
  role?: string;
  expiresAt?: string;
  workspaceName?: string;
};

export async function POST(request: Request) {
  let body: InviteEmailBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const email = body.email?.trim();
  const link = body.link?.trim();
  if (!email || !link) {
    return NextResponse.json({ error: 'email and link are required' }, { status: 400 });
  }

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.INVITE_FROM_EMAIL;
  if (!apiKey || !from) {
    return NextResponse.json({
      error: 'Email sending is not configured. Add RESEND_API_KEY and INVITE_FROM_EMAIL to .env.local, then restart npm run dev.',
    }, { status: 501 });
  }

  const workspace = body.workspaceName || 'AQ Creativity';
  const role = body.role || 'Member';
  const expires = body.expiresAt
    ? new Date(body.expiresAt).toLocaleString('en', { dateStyle: 'medium', timeStyle: 'short' })
    : 'soon';

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: email,
      subject: `You're invited to ${workspace}`,
      html: `
        <div style="font-family:Inter,Arial,sans-serif;line-height:1.55;color:#111827;max-width:560px;margin:0 auto;padding:24px">
          <h1 style="font-size:22px;margin:0 0 12px">You're invited to ${escapeHtml(workspace)}</h1>
          <p style="margin:0 0 16px">You've been invited to join the AQ Creativity project management workspace as <strong>${escapeHtml(role)}</strong>.</p>
          <p style="margin:0 0 20px;color:#6b7280">This invite expires on ${escapeHtml(expires)}.</p>
          <a href="${escapeAttribute(link)}" style="display:inline-block;background:#1f8f4f;color:#fff;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:8px">
            Accept invite
          </a>
          <p style="margin:22px 0 0;color:#6b7280;font-size:13px">If the button does not work, copy and paste this link into your browser:</p>
          <p style="word-break:break-all;font-size:13px">${escapeHtml(link)}</p>
        </div>
      `,
      text: [
        `You're invited to ${workspace}.`,
        `Role: ${role}`,
        `Expires: ${expires}`,
        '',
        `Accept invite: ${link}`,
      ].join('\n'),
    }),
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    // Surface Resend's structured error so admins can debug domain / from-address
    // problems instead of seeing a single truncated string.
    const providerName = result?.name || null;
    const providerMessage = result?.message || result?.error || 'Email provider rejected the invite email';
    const providerStatus = response.status;

    let humanError = providerMessage;
    if (providerName === 'validation_error' && /from/i.test(providerMessage)) {
      humanError = `${providerMessage} — verify INVITE_FROM_EMAIL or your Resend domain.`;
    } else if (providerName === 'restricted_api_key') {
      humanError = `${providerMessage} — the Resend API key is restricted. Issue a key with sending access.`;
    } else if (providerStatus === 401 || providerStatus === 403) {
      humanError = `${providerMessage} — check RESEND_API_KEY in .env.local.`;
    } else if (providerStatus === 429) {
      humanError = `${providerMessage} — Resend rate limit hit, wait a moment.`;
    }

    return NextResponse.json({
      error: humanError,
      provider: {
        name: providerName,
        message: providerMessage,
        status: providerStatus,
      },
    }, { status: providerStatus });
  }

  return NextResponse.json({ ok: true, id: result?.id ?? null });
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function escapeAttribute(value: string) {
  return escapeHtml(value).replaceAll('`', '&#096;');
}
