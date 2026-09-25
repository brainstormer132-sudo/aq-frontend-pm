'use client';

import { getInitials } from '@/lib/utils';

/**
 * All an avatar needs of a person. Two fields, declared here rather than
 * imported: this used to `Pick` from a 364-line scaffold type file that
 * nothing else in the app used, which is a lot of module to reach through
 * for a name and a URL.
 */
export interface AvatarUser {
  full_name: string;
  avatar_url: string | null;
}

interface AvatarProps {
  user: AvatarUser | null;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizes = {
  sm: { container: 24, text: 10 },
  md: { container: 32, text: 12 },
  lg: { container: 40, text: 14 },
};

export function Avatar({ user, size = 'md', className = '' }: AvatarProps) {
  const { container, text } = sizes[size];

  if (user?.avatar_url) {
    return (
      <img
        src={user.avatar_url}
        alt={user.full_name}
        style={{ width: container, height: container, borderRadius: '50%', objectFit: 'cover' }}
        className={className}
      />
    );
  }

  const initials = getInitials(user?.full_name || '?');
  const hue = (user?.full_name || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0) % 360;

  return (
    <div
      style={{
        width: container,
        height: container,
        borderRadius: '50%',
        background: `hsl(${hue}, 55%, 55%)`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: text,
        fontWeight: 600,
        color: '#fff',
        flexShrink: 0,
      }}
      className={className}
      title={user?.full_name}
    >
      {initials}
    </div>
  );
}

interface AvatarGroupProps {
  users: AvatarUser[];
  max?: number;
  size?: 'sm' | 'md';
}

export function AvatarGroup({ users, max = 4, size = 'sm' }: AvatarGroupProps) {
  const visible = users.slice(0, max);
  const remaining = users.length - max;

  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      {visible.map((u, i) => (
        <div key={i} style={{ marginLeft: i > 0 ? -8 : 0, zIndex: visible.length - i }}>
          <Avatar user={u} size={size} />
        </div>
      ))}
      {remaining > 0 && (
        <div
          style={{
            marginLeft: -8,
            width: sizes[size].container,
            height: sizes[size].container,
            borderRadius: '50%',
            background: 'var(--aq-bg-hover)',
            border: '2px solid var(--aq-bg-elevated)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: sizes[size].text - 1,
            fontWeight: 600,
            color: 'var(--aq-text-muted)',
          }}
        >
          +{remaining}
        </div>
      )}
    </div>
  );
}
