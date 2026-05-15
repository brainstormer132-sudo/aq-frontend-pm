'use client';

import { useState } from 'react';
import { Avatar } from '@/components/ui/Avatar';
import { StatusBadge, PriorityBadge } from '@/components/ui/Badges';
import { Dropdown } from '@/components/ui/Dropdown';
import { formatDate, isOverdue, STATUS_CONFIG, PRIORITY_CONFIG } from '@/lib/utils';
import type { Task, TaskStatus, TaskPriority } from '@/types';

interface ListViewProps {
  tasks: Task[];
  onTaskClick: (task: Task) => void;
  onStatusChange: (taskId: string, status: TaskStatus) => void;
  onPriorityChange: (taskId: string, priority: TaskPriority) => void;
}

export function ListView({ tasks, onTaskClick, onStatusChange, onPriorityChange }: ListViewProps) {
  const [sortBy, setSortBy] = useState<'position' | 'due_date' | 'priority' | 'status'>('position');

  const sortedTasks = [...tasks].sort((a, b) => {
    switch (sortBy) {
      case 'due_date':
        if (!a.due_date) return 1;
        if (!b.due_date) return -1;
        return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
      case 'priority': {
        const order = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 };
        return order[a.priority] - order[b.priority];
      }
      case 'status': {
        const order = { todo: 0, in_progress: 1, in_review: 2, done: 3, cancelled: 4 };
        return order[a.status] - order[b.status];
      }
      default:
        return a.position - b.position;
    }
  });

  const statusItems = Object.entries(STATUS_CONFIG).map(([value, config]) => ({
    label: config.label,
    value,
    color: config.color,
  }));

  const priorityItems = Object.entries(PRIORITY_CONFIG).map(([value, config]) => ({
    label: config.label,
    value,
    icon: config.icon,
  }));

  return (
    <div style={{ padding: 24 }}>
      {/* Sort controls */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {(['position', 'due_date', 'priority', 'status'] as const).map((key) => (
          <button
            key={key}
            onClick={() => setSortBy(key)}
            className={`aq-btn ${sortBy === key ? 'aq-btn-secondary' : 'aq-btn-ghost'}`}
            style={{ fontSize: 12, padding: '4px 10px' }}
          >
            {key === 'position' ? 'Default' : key === 'due_date' ? 'Due Date' : key.charAt(0).toUpperCase() + key.slice(1)}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="aq-card" style={{ overflow: 'hidden' }}>
        {/* Header */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 120px 100px 100px 120px 40px',
            padding: '10px 16px',
            borderBottom: '1px solid var(--aq-border-light)',
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--aq-text-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
          }}
        >
          <span>Task</span>
          <span>Status</span>
          <span>Priority</span>
          <span>Assignee</span>
          <span>Due Date</span>
          <span />
        </div>

        {/* Rows */}
        {sortedTasks.map((task) => (
          <div
            key={task.id}
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 120px 100px 100px 120px 40px',
              padding: '10px 16px',
              alignItems: 'center',
              borderBottom: '1px solid var(--aq-border-light)',
              cursor: 'pointer',
              transition: 'background var(--aq-transition)',
              fontSize: 13,
            }}
            onClick={() => onTaskClick(task)}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--aq-bg-sunken)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onStatusChange(task.id, task.status === 'done' ? 'todo' : 'done');
                }}
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 4,
                  border: `2px solid ${task.status === 'done' ? 'var(--aq-success)' : 'var(--aq-border)'}`,
                  background: task.status === 'done' ? 'var(--aq-success)' : 'transparent',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#fff',
                  fontSize: 10,
                  flexShrink: 0,
                }}
              >
                {task.status === 'done' && '✓'}
              </button>
              <span
                style={{
                  fontWeight: 500,
                  textDecoration: task.status === 'done' ? 'line-through' : 'none',
                  color: task.status === 'done' ? 'var(--aq-text-muted)' : 'var(--aq-text)',
                }}
              >
                {task.title}
              </span>
            </div>

            <div onClick={(e) => e.stopPropagation()}>
              <Dropdown
                trigger={<StatusBadge status={task.status} />}
                items={statusItems}
                onSelect={(v) => onStatusChange(task.id, v as TaskStatus)}
              />
            </div>

            <div onClick={(e) => e.stopPropagation()}>
              <Dropdown
                trigger={<PriorityBadge priority={task.priority} />}
                items={priorityItems}
                onSelect={(v) => onPriorityChange(task.id, v as TaskPriority)}
              />
            </div>

            <div>
              {task.assignee ? (
                <Avatar user={task.assignee} size="sm" />
              ) : (
                <span style={{ fontSize: 12, color: 'var(--aq-text-muted)' }}>—</span>
              )}
            </div>

            <span
              style={{
                fontSize: 12,
                color: isOverdue(task.due_date) ? 'var(--aq-error)' : 'var(--aq-text-muted)',
                fontWeight: isOverdue(task.due_date) ? 600 : 400,
              }}
            >
              {task.due_date ? formatDate(task.due_date) : '—'}
            </span>

            <span style={{ color: 'var(--aq-text-muted)', fontSize: 16 }}>›</span>
          </div>
        ))}

        {sortedTasks.length === 0 && (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--aq-text-muted)', fontSize: 14 }}>
            No tasks yet. Create one to get started.
          </div>
        )}
      </div>
    </div>
  );
}
