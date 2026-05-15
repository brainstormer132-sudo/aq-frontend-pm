'use client';

interface EmptyStateProps {
  icon: string;
  title: string;
  description: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '60px 20px',
        textAlign: 'center',
      }}
    >
      <span style={{ fontSize: 48, marginBottom: 16 }}>{icon}</span>
      <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>{title}</h3>
      <p style={{ fontSize: 14, color: 'var(--aq-text-muted)', maxWidth: 320, marginBottom: action ? 20 : 0 }}>
        {description}
      </p>
      {action && (
        <button className="aq-btn aq-btn-primary" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  );
}
