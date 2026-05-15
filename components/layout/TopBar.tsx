'use client';

import { useState } from 'react';

interface TopBarProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  onSearch?: (query: string) => void;
}

export function TopBar({ title, subtitle, actions, onSearch }: TopBarProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');

  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 28px',
        height: 56,
        borderBottom: '1px solid var(--aq-border-light)',
        background: 'var(--aq-bg-elevated)',
        flexShrink: 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
        <h1 style={{ fontSize: 18, fontWeight: 600 }}>{title}</h1>
        {subtitle && (
          <span style={{ fontSize: 13, color: 'var(--aq-text-muted)' }}>{subtitle}</span>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {onSearch && (
          <div style={{ position: 'relative' }}>
            {searchOpen ? (
              <input
                className="aq-input"
                style={{ width: 240, fontSize: 13 }}
                placeholder="Search..."
                value={query}
                onChange={(e) => { setQuery(e.target.value); onSearch(e.target.value); }}
                onBlur={() => { if (!query) setSearchOpen(false); }}
                autoFocus
              />
            ) : (
              <button
                className="aq-btn aq-btn-ghost"
                onClick={() => setSearchOpen(true)}
                style={{ padding: '6px 10px' }}
              >
                🔍
              </button>
            )}
          </div>
        )}
        {actions}
      </div>
    </header>
  );
}
