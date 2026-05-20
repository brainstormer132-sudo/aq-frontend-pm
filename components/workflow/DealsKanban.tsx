'use client';

import { useMemo, useState } from 'react';
import {
  useCrmDeals, moveCrmDealStage, deleteCrmDeal,
  useClients, useLegacyVendors,
  DEAL_STAGES, type CrmDeal, type DealStage,
} from '@/hooks/use-workflow';
import { DealEditor } from './DealEditor';

/**
 * Sales pipeline kanban.
 *
 * Renders one column per deal stage (Prospect → Won/Lost), with a card per
 * deal showing name, value, owner, and the linked contact. Cards can be
 * dragged between columns to move stages — the trigger on crm_deals takes
 * care of `stage_changed_at` and `closed_at`.
 *
 * "New deal" opens the slide-over DealEditor. Clicking a card opens the
 * editor in edit mode.
 */
export function DealsKanban({
  workspaceId, currentUserId, currentUserName,
}: {
  workspaceId: string;
  currentUserId: string;
  currentUserName: string;
}) {
  const { items: deals, loading, refetch } = useCrmDeals(workspaceId);
  const { clients } = useClients();
  const { vendors } = useLegacyVendors();

  const [editing, setEditing] = useState<CrmDeal | null>(null);
  const [creating, setCreating] = useState(false);
  const [stageForNew, setStageForNew] = useState<DealStage>('prospect');
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<DealStage | null>(null);
  const [query, setQuery] = useState('');
  const [ownerFilter, setOwnerFilter] = useState<string>('');

  // Build a quick lookup so cards can show contact names instead of bare IDs.
  const contactName = useMemo(() => {
    const m = new Map<string, string>();
    (clients || []).forEach((c) => m.set(`client:${c.id}`, c.company_name));
    (vendors || []).forEach((v) => m.set(`vendor:${v.id}`, v.name));
    return m;
  }, [clients, vendors]);

  const ownerOptions = useMemo(() => {
    const set = new Set<string>();
    (deals || []).forEach((d) => { if (d.owner_name) set.add(d.owner_name); });
    return Array.from(set).sort();
  }, [deals]);

  const filteredDeals = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (deals || []).filter((d) => {
      if (ownerFilter && d.owner_name !== ownerFilter) return false;
      if (!q) return true;
      const haystack = [
        d.name, d.owner_name, d.notes,
        d.target_id ? contactName.get(`${d.target_type}:${d.target_id}`) : '',
      ].join(' ').toLowerCase();
      return haystack.includes(q);
    });
  }, [deals, query, ownerFilter, contactName]);

  // Per-stage stats + grouping
  const byStage = useMemo(() => {
    const m = new Map<DealStage, CrmDeal[]>();
    DEAL_STAGES.forEach((s) => m.set(s.key, []));
    filteredDeals.forEach((d) => {
      const arr = m.get(d.stage) || [];
      arr.push(d);
      m.set(d.stage, arr);
    });
    return m;
  }, [filteredDeals]);

  const stageTotal = (stage: DealStage) => {
    const arr = byStage.get(stage) || [];
    return arr.reduce((s, d) => s + Number(d.value || 0), 0);
  };

  const onDrop = async (stage: DealStage) => {
    if (!dragId) return;
    const deal = (deals || []).find((d) => d.id === dragId);
    setDragId(null);
    setDragOverStage(null);
    if (!deal || deal.stage === stage) return;
    try {
      await moveCrmDealStage(deal.id, stage);
      await refetch();
    } catch (e) {
      console.error('moveCrmDealStage', e);
      alert('Could not move deal — see console.');
    }
  };

  const openNew = (stage: DealStage) => {
    setStageForNew(stage);
    setCreating(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this deal? This cannot be undone.')) return;
    try {
      await deleteCrmDeal(id);
      setEditing(null);
      await refetch();
    } catch (e: any) {
      alert('Delete failed: ' + (e?.message ?? e));
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Toolbar */}
      <div style={{
        display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap',
      }}>
        <h2 style={{ fontSize: 18, fontWeight: 800, marginRight: 'auto' }}>
          Sales pipeline
        </h2>
        <input
          className="aq-input"
          placeholder="Search deals…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ maxWidth: 220 }}
        />
        <select
          className="aq-select"
          value={ownerFilter}
          onChange={(e) => setOwnerFilter(e.target.value)}
          style={{ maxWidth: 180 }}
        >
          <option value="">All owners</option>
          {ownerOptions.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        <button
          type="button"
          className="aq-btn aq-btn-primary"
          onClick={() => openNew('prospect')}
        >+ New deal</button>
      </div>

      {/* Kanban scroller */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${DEAL_STAGES.length}, minmax(240px, 1fr))`,
        gap: 12,
        overflowX: 'auto',
        paddingBottom: 4,
      }}>
        {DEAL_STAGES.map((s) => {
          const cards = byStage.get(s.key) || [];
          const total = stageTotal(s.key);
          const isOver = dragOverStage === s.key;
          return (
            <div
              key={s.key}
              onDragOver={(e) => { e.preventDefault(); setDragOverStage(s.key); }}
              onDragLeave={() => setDragOverStage((cur) => cur === s.key ? null : cur)}
              onDrop={() => onDrop(s.key)}
              className="aq-card"
              style={{
                padding: 10,
                display: 'flex', flexDirection: 'column', gap: 8,
                minHeight: 320,
                background: isOver ? 'var(--aq-accent-light)' : undefined,
                outline: isOver ? '2px dashed var(--aq-accent)' : 'none',
                outlineOffset: -2,
                transition: 'background 120ms ease',
              }}
            >
              <header style={{
                display: 'flex', justifyContent: 'space-between',
                alignItems: 'baseline', padding: '4px 6px',
              }}>
                <div>
                  <strong style={{ fontSize: 13, color: stageColor(s.key) }}>
                    {s.label}
                  </strong>
                  <div style={{ fontSize: 11, color: 'var(--aq-text-muted)' }}>
                    {cards.length} · {fmtCurrency(total)}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => openNew(s.key)}
                  aria-label={`Add deal to ${s.label}`}
                  style={{
                    background: 'transparent', border: 'none',
                    fontSize: 18, color: 'var(--aq-text-muted)',
                    cursor: 'pointer', lineHeight: 1, padding: 2,
                  }}
                >+</button>
              </header>

              {cards.length === 0 ? (
                <div style={{
                  padding: 18, fontSize: 12, color: 'var(--aq-text-muted)',
                  textAlign: 'center',
                  border: '1px dashed var(--aq-border-light)',
                  borderRadius: 'var(--aq-radius)',
                  margin: 6,
                }}>Drop deals here</div>
              ) : (
                <ul style={{
                  listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6,
                }}>
                  {cards.map((d) => (
                    <li key={d.id}>
                      <DealCard
                        deal={d}
                        contactLabel={d.target_id ? contactName.get(`${d.target_type}:${d.target_id}`) || `(${d.target_type} ${d.target_id})` : null}
                        onClick={() => setEditing(d)}
                        onDragStart={() => setDragId(d.id)}
                        onDragEnd={() => { setDragId(null); setDragOverStage(null); }}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      {loading && (
        <p style={{ color: 'var(--aq-text-muted)', fontSize: 13 }}>Loading deals…</p>
      )}

      {(editing || creating) && (
        <DealEditor
          mode={editing ? 'edit' : 'create'}
          workspaceId={workspaceId}
          currentUserId={currentUserId}
          currentUserName={currentUserName}
          deal={editing}
          defaultStage={stageForNew}
          onClose={() => { setEditing(null); setCreating(false); }}
          onSaved={async () => { setEditing(null); setCreating(false); await refetch(); }}
          onDelete={editing ? () => handleDelete(editing.id) : undefined}
        />
      )}
    </div>
  );
}

function DealCard({
  deal, contactLabel, onClick, onDragStart, onDragEnd,
}: {
  deal: CrmDeal;
  contactLabel: string | null;
  onClick: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const stale = isStale(deal);
  const overdue = deal.expected_close_date
    && new Date(deal.expected_close_date) < new Date()
    && deal.stage !== 'won' && deal.stage !== 'lost';

  return (
    <button
      type="button"
      onClick={onClick}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      style={{
        display: 'flex', flexDirection: 'column', gap: 6,
        width: '100%', textAlign: 'left',
        padding: 10,
        background: 'var(--aq-bg)',
        border: '1px solid var(--aq-border-light)',
        borderRadius: 'var(--aq-radius)',
        cursor: 'grab',
        fontFamily: 'inherit',
        boxShadow: 'var(--aq-shadow-sm, none)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 6 }}>
        <strong style={{ fontSize: 13, color: 'var(--aq-text)' }}>{deal.name}</strong>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--aq-text)' }}>
          {fmtCurrency(Number(deal.value || 0), deal.currency_code)}
        </span>
      </div>
      {contactLabel && (
        <div style={{ fontSize: 11, color: 'var(--aq-text-muted)' }}>
          <span style={{
            display: 'inline-block', padding: '1px 6px', borderRadius: 999,
            background: 'var(--aq-bg-sunken)', marginRight: 4, fontWeight: 600,
            textTransform: 'capitalize',
          }}>{deal.target_type}</span>
          {contactLabel}
        </div>
      )}
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        fontSize: 10, color: 'var(--aq-text-muted)', marginTop: 2,
      }}>
        <span>{deal.owner_name || 'unassigned'}</span>
        <span>
          {deal.expected_close_date
            ? <span style={{ color: overdue ? '#b91c1c' : undefined, fontWeight: overdue ? 700 : undefined }}>
                {new Date(deal.expected_close_date).toLocaleDateString()}
              </span>
            : '—'}
        </span>
      </div>
      {(stale || overdue) && (
        <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
          {stale && <span className="aq-badge aq-badge-warning" style={{ fontSize: 9 }}>stuck {daysSince(deal.stage_changed_at)}d</span>}
          {overdue && <span className="aq-badge aq-badge-error" style={{ fontSize: 9 }}>overdue</span>}
        </div>
      )}
    </button>
  );
}

function stageColor(s: DealStage): string {
  switch (s) {
    case 'prospect':    return '#64748b';
    case 'qualified':   return '#0369a1';
    case 'proposal':    return '#6d28d9';
    case 'negotiation': return '#b45309';
    case 'won':         return '#15803d';
    case 'lost':        return '#991b1b';
    default:            return '#64748b';
  }
}

function fmtCurrency(v: number, code = 'SAR') {
  if (!isFinite(v) || v === 0) return `${code} 0`;
  return `${code} ${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function daysSince(iso: string) {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
}

function isStale(deal: CrmDeal): boolean {
  if (deal.stage === 'won' || deal.stage === 'lost') return false;
  return daysSince(deal.stage_changed_at) >= 14;
}
