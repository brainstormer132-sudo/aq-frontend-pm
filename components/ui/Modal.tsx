'use client';

import { useEffect, useRef } from 'react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  width?: string;
}

export function Modal({ open, onClose, title, children, width = '480px' }: ModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={overlayRef}
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.4)',
        backdropFilter: 'blur(4px)',
      }}
    >
      <div
        className="aq-card animate-scale-in"
        style={{
          width,
          maxWidth: '90vw',
          maxHeight: '85vh',
          overflow: 'auto',
          padding: 0,
        }}
      >
        {title && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '16px 20px',
              borderBottom: '1px solid var(--aq-border-light)',
            }}
          >
            <h2 style={{ fontSize: 16, fontWeight: 600 }}>{title}</h2>
            <button
              onClick={onClose}
              className="aq-btn aq-btn-ghost"
              style={{ padding: 4, fontSize: 18, lineHeight: 1 }}
            >
              ×
            </button>
          </div>
        )}
        <div style={{ padding: 20 }}>{children}</div>
      </div>
    </div>
  );
}
