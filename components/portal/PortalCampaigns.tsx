'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase-browser';
import { type PortalMe } from '@/lib/portal-api';

type ClientMe = Extract<PortalMe, { role: 'client' }>;
import { Icon } from './PortalUI';

const supabase = createClient();

/**
 * Campaign tracking, client side.
 *
 * Reads Supabase directly rather than going through the FastAPI backend
 * like the rest of the portal: the rows are already protected by RLS
 * keyed on auth.uid(), and a portal client IS a Supabase auth user, so
 * a backend hop would add nothing but latency.
 *
 * The client only ever sees `tracking_rows_published` — a snapshot AQ
 * chose to share. The working sheet is invisible to them (migration 045),
 * and the campaign list comes from a SECURITY DEFINER function because
 * pm_tasks itself is closed to external users (migration 046).
 */

interface PublishedCampaign {
  task_id: string;
  task_name: string | null;
  brand_name: string | null;
  published_at: string | null;
  row_count: number;
}

interface PublishedRow {
  id: string;
  position: number;
  influencer_name: string;
  profile_link: string | null;
  platform: string | null;
  type_of_ad: string | null;
  content: string | null;
  product: string | null;
  shooting_date: string | null;
  posting_date: string | null;
  ad_status: string;
  ad_link: string | null;
}

export function PortalCampaigns({ me }: { me: ClientMe }) {
  const [campaigns, setCampaigns] = useState<PublishedCampaign[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [rows, setRows] = useState<PublishedRow[] | null>(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error: e } = await supabase.rpc('client_published_campaigns');
      if (cancelled) return;
      if (e) { setError(e.message); setCampaigns([]); return; }
      const list = (data || []) as PublishedCampaign[];
      setCampaigns(list);
      if (list.length) setActiveId((cur) => cur ?? list[0].task_id);
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!activeId) { setRows([]); return; }
    let cancelled = false;
    setRows(null);
    (async () => {
      const { data, error: e } = await supabase
        .from('tracking_rows_published')
        .select('id, position, influencer_name, profile_link, platform, type_of_ad, content, product, shooting_date, posting_date, ad_status, ad_link')
        .eq('task_id', activeId)
        .order('position', { ascending: true });
      if (cancelled) return;
      if (e) { setError(e.message); setRows([]); return; }
      setRows((data || []) as PublishedRow[]);
    })();
    return () => { cancelled = true; };
  }, [activeId]);

  const active = campaigns?.find((c) => c.task_id === activeId) ?? null;

  const allStatuses = useMemo(() => {
    const set = new Set<string>();
    (rows ?? []).forEach((r) => r.ad_status && set.add(r.ad_status));
    return Array.from(set).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    const text = q.trim().toLowerCase();
    return (rows ?? []).filter((r) => {
      if (statusFilter !== 'all' && r.ad_status !== statusFilter) return false;
      if (!text) return true;
      return `${r.influencer_name} ${r.platform ?? ''} ${r.type_of_ad ?? ''} ${r.content ?? ''} ${r.product ?? ''}`
        .toLowerCase().includes(text);
    });
  }, [rows, q, statusFilter]);

  return (
    <>
      <div className="portal-section-head">
        <div>
          <h2>Campaign tracking</h2>
          <p>
            Live progress on your campaigns, as shared by AQ Creativity
            {me.profile?.company_name ? ` with ${me.profile.company_name}` : ''}.
          </p>
        </div>
      </div>

      {error && (
        <div className="portal-card" style={{ padding: 18, marginBottom: 12 }}>
          <strong>Couldn&apos;t load your campaigns.</strong>
          <p style={{ marginTop: 6, fontSize: 13 }}>{error}</p>
        </div>
      )}

      {campaigns === null && (
        <div className="portal-card" style={{ padding: 24 }}>Loading your campaigns…</div>
      )}

      {campaigns && campaigns.length === 0 && !error && (
        <div className="portal-card" style={{ padding: 32, textAlign: 'center' }}>
          <p style={{ fontWeight: 600 }}>Nothing shared yet.</p>
          <p style={{ marginTop: 6, fontSize: 13, opacity: 0.75 }}>
            When AQ publishes a tracking sheet for one of your campaigns, it appears here.
          </p>
        </div>
      )}

      {campaigns && campaigns.length > 0 && (
        <>
          {campaigns.length > 1 && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
              {campaigns.map((c) => (
                <button
                  key={c.task_id}
                  type="button"
                  onClick={() => setActiveId(c.task_id)}
                  className={`aq-btn ${c.task_id === activeId ? 'aq-btn-primary' : 'aq-btn-secondary'} aq-btn-sm`}
                >
                  {c.task_name || 'Campaign'}
                  {c.brand_name ? ` · ${c.brand_name}` : ''}
                </button>
              ))}
            </div>
          )}

          <div className="portal-card" style={{ padding: 18 }}>
            {active?.published_at && (
              <p style={{ fontSize: 12, opacity: 0.75, marginBottom: 12 }}>
                Last updated {new Date(active.published_at).toLocaleString()}.
              </p>
            )}

            <div className="portal-filter-bar">
              <div className="search">
                <span className="icon"><Icon.Search /></span>
                <input
                  className="aq-input"
                  placeholder="Search by name, platform, content…"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
              </div>
              <select className="aq-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="all">All statuses</option>
                {allStatuses.map((sx) => <option key={sx} value={sx}>{sx}</option>)}
              </select>
            </div>

            {rows === null && <p style={{ marginTop: 14, fontSize: 13 }}>Loading…</p>}

            {rows && rows.length === 0 && (
              <p style={{ marginTop: 14, fontSize: 13, opacity: 0.75 }}>
                This sheet is empty at the moment.
              </p>
            )}

            {rows && rows.length > 0 && (
              <div style={{ overflowX: 'auto', marginTop: 14 }}>
                <table className="portal-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      {['Name', 'Platform', 'Type', 'Content', 'Product', 'Shooting', 'Posting', 'Status', 'Link']
                        .map((h) => (
                          <th key={h} style={{ textAlign: 'left', padding: '8px 10px', fontSize: 12, opacity: 0.7 }}>{h}</th>
                        ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((r) => (
                      <tr key={r.id} style={{ borderTop: '1px solid rgba(128,128,128,0.2)' }}>
                        <td style={{ padding: '8px 10px', fontSize: 13, fontWeight: 600 }}>
                          {r.profile_link
                            ? <a href={r.profile_link} target="_blank" rel="noopener noreferrer">{r.influencer_name}</a>
                            : r.influencer_name}
                        </td>
                        <td style={{ padding: '8px 10px', fontSize: 13 }}>{r.platform || '—'}</td>
                        <td style={{ padding: '8px 10px', fontSize: 13 }}>{r.type_of_ad || '—'}</td>
                        <td style={{ padding: '8px 10px', fontSize: 13 }}>{r.content || '—'}</td>
                        <td style={{ padding: '8px 10px', fontSize: 13 }}>{r.product || '—'}</td>
                        <td style={{ padding: '8px 10px', fontSize: 13 }}>{r.shooting_date || '—'}</td>
                        <td style={{ padding: '8px 10px', fontSize: 13 }}>{r.posting_date || '—'}</td>
                        <td style={{ padding: '8px 10px', fontSize: 13 }}>{r.ad_status}</td>
                        <td style={{ padding: '8px 10px', fontSize: 13 }}>
                          {r.ad_link
                            ? <a href={r.ad_link} target="_blank" rel="noopener noreferrer">View</a>
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filtered.length === 0 && (
                  <p style={{ marginTop: 12, fontSize: 13, opacity: 0.75 }}>Nothing matches that filter.</p>
                )}
              </div>
            )}

            {/* Prices are deliberately absent: the published sheet carries them,
                but what the client is shown is delivery progress, not AQ's
                vendor costs. Add columns here only on purpose. */}
          </div>
        </>
      )}
    </>
  );
}
