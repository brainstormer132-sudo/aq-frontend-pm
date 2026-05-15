/**
 * Thin client for the FastAPI contract backend, using the user's Supabase
 * JWT for cross-app auth. Reuses the same Authorization header the contract
 * generation bridge has been using.
 *
 * Through nginx the base path is /contracts/api/* (forwarded to :8000/api/*).
 * Standalone, the env var NEXT_PUBLIC_CONTRACT_API_URL points at :8000.
 */

import { createClient } from '@/lib/supabase-browser';

const supabase = createClient();

function resolveBase(): string {
  // When running behind nginx, hit the same origin (cookies + JWT both work).
  if (typeof window !== 'undefined' && window.location.protocol.startsWith('http')) {
    return `${window.location.origin}/contracts/api`;
  }
  // SSR / standalone fallback.
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

export type ContractApiOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | undefined | null>;
};

export async function contractApi<T = unknown>(
  path: string,
  opts: ContractApiOptions = {},
): Promise<T> {
  const method = opts.method || 'GET';
  let url = `${resolveBase()}${path.startsWith('/') ? path : `/${path}`}`;

  if (opts.query) {
    const usp = new URLSearchParams();
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined && v !== null && v !== '') usp.set(k, String(v));
    }
    const qs = usp.toString();
    if (qs) url += (url.includes('?') ? '&' : '?') + qs;
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(await authHeader()),
  };

  const response = await fetch(url, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let payload: any = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }

  if (!response.ok) {
    const detail = typeof payload?.detail === 'string'
      ? payload.detail
      : typeof payload === 'string' && payload
        ? payload
        : `Request failed (${response.status})`;
    throw new Error(detail);
  }
  return payload as T;
}

// ─── Typed wrappers for the routes the PM dashboard uses ────────────────────

export interface PendingVendorRow {
  id: number;
  full_name: string;
  license_number?: string;
  license_expiry?: string | null;
  email?: string;
  phone?: string;
  vendor_category?: string;
  platforms?: string;
  iban?: string;
  bank_name?: string;
  account_name?: string;
  account_number?: string;
  swift_code?: string;
  status: string;
  submitted_at?: string | null;
  reviewed_at?: string | null;
}

export interface PendingClientRow {
  id: number;
  company_name: string;
  cr_number?: string;
  vat_number?: string;
  signatory_name?: string;
  phone?: string;
  email?: string;
  company_email?: string;
  street?: string;
  city?: string;
  postcode?: string;
  country?: string;
  national_address?: string;
  permit_doc?: string;
  vat_doc?: string;
  national_address_doc?: string;
  status: string;
  submitted_at?: string | null;
}

export const pendingVendors = {
  list: (status?: string) =>
    contractApi<PendingVendorRow[]>('/vendors/pending/vendors', { query: { status } }),
  action: (id: number, action: 'approved' | 'rejected') =>
    contractApi<{ status: string; vendor_id?: number; vendor_name?: string }>(
      `/vendors/pending/vendors/${id}/action`,
      { method: 'POST', body: { action } },
    ),
};

export const pendingClients = {
  list: (status?: string) =>
    contractApi<PendingClientRow[]>('/vendors/pending/clients', { query: { status } }),
  action: (id: number, action: 'approved' | 'rejected') =>
    contractApi<{ status: string; client_id?: string }>(
      `/vendors/pending/clients/${id}/action`,
      { method: 'POST', body: { action } },
    ),
};

export const vendorOps = {
  remove: (vendorId: number) =>
    contractApi<void>(`/vendors/${vendorId}`, { method: 'DELETE' }),
};

export const clientOps = {
  remove: (clientId: string) =>
    contractApi<void>(`/vendors/clients/${clientId}`, { method: 'DELETE' }),
};

export const manualCreate = {
  vendor: (body: Record<string, unknown>) =>
    contractApi<{ id: number; name: string; invite_status: string }>(
      '/vendors/manual/vendors',
      { method: 'POST', body },
    ),
  client: (body: Record<string, unknown>) =>
    contractApi<{ id: string; company_name: string; invite_status: string }>(
      '/vendors/manual/clients',
      { method: 'POST', body },
    ),
};

export interface BrandRow {
  id: string;
  client_id: string;
  brand_name: string;
  description?: string | null;
  brand_logo_url?: string | null;
  status?: string;
  contract_count?: number;
}

export interface ExternalInvite {
  id: string;
  token: string;
  email: string;
  role: 'vendor' | 'client';
  expires_at: string;
}

export const externalInvites = {
  issue: (body: {
    role: 'vendor' | 'client';
    email: string;
    vendor_id?: number;
    client_id?: string;
  }) => contractApi<ExternalInvite>('/external-invites/issue', { method: 'POST', body }),
  reissue: (externalUserId: string) =>
    contractApi<ExternalInvite>(`/external-invites/${externalUserId}/reset`, { method: 'POST' }),
  /**
   * Admin-create: skips the email setup link entirely. Backend creates
   * the Supabase auth user with the chosen password, no email needed.
   * Use when the vendor/client has no email or won't go through a link.
   */
  adminCreate: (body: {
    role: 'vendor' | 'client';
    password: string;
    vendor_id?: number;
    client_id?: string;
    email?: string;
  }) => contractApi<{
    ok: boolean;
    auth_user_id: string;
    email: string;
    role: 'vendor' | 'client';
    portal_path: string;
  }>('/external-invites/admin-create', { method: 'POST', body }),
};

/**
 * Build the setup link the user opens to claim an invite.
 *  /vendor/setup?token=...   or   /client/setup?token=...
 * Through nginx these resolve to the PM Next.js app under /vendor/* / /client/*.
 */
export function buildSetupLink(invite: ExternalInvite): string {
  if (typeof window === 'undefined') return '';
  const path = invite.role === 'vendor' ? '/vendor/setup' : '/client/setup';
  return `${window.location.origin}${path}?token=${encodeURIComponent(invite.token)}`;
}

export const brands = {
  list: (clientId?: string) =>
    contractApi<BrandRow[]>('/brands', { query: { client_id: clientId } }),
  withCounts: (clientId: string) =>
    contractApi<BrandRow[]>(`/brands/by-client/${clientId}/with-counts`),
  create: (clientId: string, brandName: string, description?: string) =>
    contractApi<BrandRow>('/brands', {
      method: 'POST',
      body: { client_id: clientId, brand_name: brandName, description },
    }),
  update: (id: string, body: Partial<Pick<BrandRow, 'brand_name' | 'description' | 'status'>>) =>
    contractApi<BrandRow>(`/brands/${id}`, { method: 'PATCH', body }),
  remove: (id: string) =>
    contractApi<void>(`/brands/${id}`, { method: 'DELETE' }),
};
