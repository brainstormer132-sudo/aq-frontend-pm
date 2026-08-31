/**
 * Portal-side API client. The vendor and client dashboards (under /vendor/*
 * and /client/*) hit the FastAPI backend through nginx at /contracts/api.
 *
 * Auth: Supabase JWT, same as the PM-side cross-app helper, but the JWT
 * here belongs to an external_users row, not a workspace_members row. The
 * backend resolves the difference.
 */

import { createClient } from '@/lib/supabase-browser';

const supabase = createClient();

function resolveBase(): string {
  if (typeof window !== 'undefined' && window.location.protocol.startsWith('http')) {
    return `${window.location.origin}/contracts/api`;
  }
  const direct = process.env.NEXT_PUBLIC_CONTRACT_API_URL || 'http://127.0.0.1:8000';
  return `${direct.replace(/\/$/, '')}/api`;
}

async function authHeader(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error('Sign in again — your session expired.');
  }
  return { Authorization: `Bearer ${session.access_token}` };
}

async function publicFetch<T>(path: string, init: RequestInit): Promise<T> {
  const res = await fetch(`${resolveBase()}${path}`, init);
  const text = await res.text();
  let body: any;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) {
    const detail = body?.detail || body || `Request failed (${res.status})`;
    throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
  }
  return body as T;
}

async function authedFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> || {}),
    ...(await authHeader()),
  };
  return publicFetch<T>(path, { ...init, headers });
}

// ─── Invite lifecycle (used by setup pages) ─────────────────────────────────

export interface InviteValidationResult {
  valid: boolean;
  reason: string | null;
  email: string | null;
  role: 'vendor' | 'client' | null;
  vendor_id: number | null;
  client_id: string | null;
  expires_at: string | null;
}

export async function validateInviteToken(token: string): Promise<InviteValidationResult> {
  const result = await publicFetch<InviteValidationResult>('/external-invites/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  return result;
}

/**
 * Turn an invite into a working account, in one call.
 *
 * Replaces the browser doing signUp → claim → signIn. Two things went
 * wrong with that:
 *
 *   * **A reset could never work.** `supabase.auth.signUp` does not change
 *     an existing user's password, so on a re-issued invite the new
 *     password was never set and the sign-in afterwards failed against one
 *     that did not exist.
 *   * **A failure burned the token.** The invite was consumed before the
 *     session was proven, so any error after that point marked it used and
 *     every retry reported "Invite already used" — which is the "invalid
 *     token" people were seeing, usually on their own second attempt.
 *
 * The backend sets the password with the service role FIRST and consumes
 * the invite only once that has worked, so a failure leaves the link
 * usable.
 */
export async function acceptInvite(token: string, password: string) {
  return publicFetch<{
    ok: true;
    email: string;
    role: 'vendor' | 'client';
    external_user_id: string;
  }>('/external-invites/accept', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, password }),
  });
}

export async function claimInvite(token: string, authUserId: string) {
  return publicFetch<{
    external_user_id: string;
    role: 'vendor' | 'client';
    vendor_id: number | null;
    client_id: string | null;
  }>('/external-invites/claim', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, auth_user_id: authUserId }),
  });
}

// ─── Authenticated portal data ──────────────────────────────────────────────

export interface PortalProfileVendor {
  id: number;
  name: string;
  license_number: string;
  vendor_category: string | null;
  platforms: string | null;
  phone: string | null;
  email: string | null;
  invite_status: string | null;
}

export interface PortalProfileClient {
  id: string;
  company_name: string;
  contact_name: string | null;
  company_email: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  cr_number: string | null;
  vat_number: string | null;
  city: string | null;
  country: string | null;
  invite_status: string | null;
}

export interface PortalBank {
  id: number;
  bank_name: string;
  account_name: string;
  iban: string;
  account_number: string;
  swift_code: string;
}

export type PortalMe =
  | {
      role: 'vendor';
      external_user_id: string;
      email: string;
      /** True when admin created this account with a temp password.
       *  PortalShell forces a password change before showing the dashboard. */
      must_change_password: boolean;
      profile: PortalProfileVendor;
      banks: PortalBank[];
    }
  | {
      role: 'client';
      external_user_id: string;
      email: string;
      must_change_password: boolean;
      profile: PortalProfileClient;
    };

export interface PortalContractRow {
  contract_id: string;
  brand_name: string;
  amount: string;
  contract_type: string;
  generated_at: string;
  has_pdf: boolean;
  has_docx: boolean;
  pdf_error: string | null;
}

export interface PortalBrandRow {
  id: string;
  brand_name: string;
  description: string | null;
  status: string | null;
}

export const portal = {
  me: () => authedFetch<PortalMe>('/external-portal/me'),
  contracts: () => authedFetch<PortalContractRow[]>('/external-portal/contracts'),
  brands: () => authedFetch<PortalBrandRow[]>('/external-portal/brands'),
  downloadUrl: (contractId: string, kind: 'pdf' | 'docx') =>
    `${resolveBase()}/external-portal/contracts/${encodeURIComponent(contractId)}/download/${kind}`,
  /**
   * Update the portal user's password and clear the must_change_password
   * flag in one round-trip. Backend uses Supabase Admin API (service role)
   * to set the password, then clears the flag on the external_users row.
   */
  changePassword: (newPassword: string) =>
    authedFetch<{ ok: true; message?: string }>('/external-portal/change-password', {
      method: 'POST',
      body: JSON.stringify({ new_password: newPassword }),
    }),
};
