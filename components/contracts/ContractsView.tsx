'use client';

import { useState } from 'react';
import { TopBar } from '@/components/layout/TopBar';
import { EmptyState } from '@/components/ui/EmptyState';
import type { LegacyTask, Subtask, Vendor, BankAccount, PendingVendor, PendingClient } from '@/types';

type ContractTab = 'tasks' | 'vendors' | 'bank_accounts' | 'pending_vendors' | 'pending_clients';

interface ContractsViewProps {
  legacyTasks: LegacyTask[];
  subtasks: Subtask[];
  vendors: Vendor[];
  bankAccounts: BankAccount[];
  pendingVendors: PendingVendor[];
  pendingClients: PendingClient[];
  onSelectLegacyTask: (taskId: string) => void;
}

const TABS: { id: ContractTab; label: string; icon: string }[] = [
  { id: 'tasks', label: 'Contract Tasks', icon: '📋' },
  { id: 'vendors', label: 'Vendors', icon: '🏢' },
  { id: 'bank_accounts', label: 'Bank Accounts', icon: '🏦' },
  { id: 'pending_vendors', label: 'Pending Vendors', icon: '⏳' },
  { id: 'pending_clients', label: 'Pending Clients', icon: '👥' },
];

export function ContractsView({
  legacyTasks,
  subtasks,
  vendors,
  bankAccounts,
  pendingVendors,
  pendingClients,
  onSelectLegacyTask,
}: ContractsViewProps) {
  const [activeTab, setActiveTab] = useState<ContractTab>('tasks');
  const [searchQuery, setSearchQuery] = useState('');

  const renderTable = (data: Record<string, any>[], onRowClick?: (row: any) => void) => {
    if (data.length === 0) {
      return (
        <EmptyState
          icon="📭"
          title="No records"
          description="This table is empty."
        />
      );
    }

    const columns = Object.keys(data[0]).filter(
      (k) => !['created_at', 'updated_at'].includes(k)
    );

    const filtered = searchQuery
      ? data.filter((row) =>
          columns.some((col) =>
            String(row[col] ?? '').toLowerCase().includes(searchQuery.toLowerCase())
          )
        )
      : data;

    return (
      <div className="aq-card" style={{ overflow: 'auto' }}>
        {/* Header */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: columns.map(() => '1fr').join(' '),
            padding: '10px 16px',
            borderBottom: '1px solid var(--aq-border-light)',
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--aq-text-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            minWidth: columns.length * 140,
          }}
        >
          {columns.map((col) => (
            <span key={col}>{col.replace(/_/g, ' ')}</span>
          ))}
        </div>

        {/* Rows */}
        {filtered.map((row, i) => (
          <div
            key={row.id || i}
            style={{
              display: 'grid',
              gridTemplateColumns: columns.map(() => '1fr').join(' '),
              padding: '10px 16px',
              borderBottom: '1px solid var(--aq-border-light)',
              fontSize: 13,
              cursor: onRowClick ? 'pointer' : 'default',
              transition: 'background var(--aq-transition)',
              minWidth: columns.length * 140,
            }}
            onClick={() => onRowClick?.(row)}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--aq-bg-sunken)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            {columns.map((col) => (
              <span
                key={col}
                style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  paddingRight: 8,
                }}
              >
                {row[col] != null ? String(row[col]) : '—'}
              </span>
            ))}
          </div>
        ))}

        {filtered.length === 0 && searchQuery && (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--aq-text-muted)', fontSize: 14 }}>
            No matching records for &ldquo;{searchQuery}&rdquo;
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TopBar
        title="Contracts & Finance"
        subtitle="Legacy data"
        onSearch={setSearchQuery}
      />

      {/* Tab bar */}
      <div
        style={{
          display: 'flex',
          gap: 4,
          padding: '12px 24px 0',
          borderBottom: '1px solid var(--aq-border-light)',
          background: 'var(--aq-bg-elevated)',
          overflowX: 'auto',
        }}
      >
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 14px',
              fontSize: 13,
              fontWeight: activeTab === tab.id ? 600 : 400,
              color: activeTab === tab.id ? 'var(--aq-accent)' : 'var(--aq-text-secondary)',
              background: 'none',
              border: 'none',
              borderBottom: activeTab === tab.id ? '2px solid var(--aq-accent)' : '2px solid transparent',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              transition: 'all var(--aq-transition)',
            }}
          >
            <span>{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
        {activeTab === 'tasks' && renderTable(legacyTasks, (row) => onSelectLegacyTask(row.id))}
        {activeTab === 'vendors' && renderTable(vendors)}
        {activeTab === 'bank_accounts' && renderTable(bankAccounts)}
        {activeTab === 'pending_vendors' && renderTable(pendingVendors)}
        {activeTab === 'pending_clients' && renderTable(pendingClients)}
      </div>
    </div>
  );
}
