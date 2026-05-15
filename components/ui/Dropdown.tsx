'use client';

import { useState, useRef, useEffect } from 'react';

interface DropdownItem {
  label: string;
  value: string;
  icon?: string;
  color?: string;
  divider?: boolean;
  danger?: boolean;
}

interface DropdownProps {
  trigger: React.ReactNode;
  items: DropdownItem[];
  onSelect: (value: string) => void;
  align?: 'left' | 'right';
}

export function Dropdown({ trigger, items, onSelect, align = 'left' }: DropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-flex' }}>
      <div onClick={() => setOpen(!open)} style={{ cursor: 'pointer' }}>
        {trigger}
      </div>
      {open && (
        <div
          className="aq-card animate-scale-in"
          style={{
            position: 'absolute',
            top: '100%',
            [align === 'right' ? 'right' : 'left']: 0,
            marginTop: 4,
            minWidth: 180,
            padding: '4px 0',
            zIndex: 100,
            boxShadow: 'var(--aq-shadow-lg)',
          }}
        >
          {items.map((item, i) =>
            item.divider ? (
              <div
                key={i}
                style={{
                  height: 1,
                  background: 'var(--aq-border-light)',
                  margin: '4px 0',
                }}
              />
            ) : (
              <button
                key={item.value}
                onClick={() => { onSelect(item.value); setOpen(false); }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  width: '100%',
                  padding: '8px 12px',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: 13,
                  color: item.danger ? 'var(--aq-error)' : 'var(--aq-text)',
                  textAlign: 'left',
                  transition: 'background var(--aq-transition)',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--aq-bg-hover)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                {item.icon && <span>{item.icon}</span>}
                <span style={{ color: item.color }}>{item.label}</span>
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}
