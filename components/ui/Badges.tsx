'use client';

import { PRIORITY_CONFIG, STATUS_CONFIG } from '@/lib/utils';
import type { TaskPriority, TaskStatus } from '@/types';

export function PriorityBadge({ priority }: { priority: TaskPriority }) {
  const config = PRIORITY_CONFIG[priority];
  if (priority === 'none') return null;

  return (
    <span
      className="aq-badge"
      style={{ background: config.color + '18', color: config.color }}
    >
      {config.icon} {config.label}
    </span>
  );
}

export function StatusBadge({ status }: { status: TaskStatus }) {
  const config = STATUS_CONFIG[status];

  return (
    <span
      className="aq-badge"
      style={{ background: config.bgColor, color: config.color }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: config.color,
          marginRight: 4,
          display: 'inline-block',
        }}
      />
      {config.label}
    </span>
  );
}
