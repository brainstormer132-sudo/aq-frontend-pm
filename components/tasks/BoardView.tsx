'use client';

import { useState, useRef } from 'react';
import { Avatar } from '@/components/ui/Avatar';
import { PriorityBadge } from '@/components/ui/Badges';
import { STATUS_CONFIG, formatDate, isOverdue } from '@/lib/utils';
import type { Task, TaskStatus, Section } from '@/types';

interface BoardViewProps {
  tasks: Task[];
  sections: Section[];
  onTaskClick: (task: Task) => void;
  onMoveTask: (taskId: string, status: TaskStatus) => void;
  onCreateTask: (status: TaskStatus) => void;
}

const COLUMNS: { status: TaskStatus; label: string }[] = [
  { status: 'todo', label: 'To Do' },
  { status: 'in_progress', label: 'In Progress' },
  { status: 'in_review', label: 'In Review' },
  { status: 'done', label: 'Done' },
];

export function BoardView({ tasks, sections, onTaskClick, onMoveTask, onCreateTask }: BoardViewProps) {
  const [draggedTask, setDraggedTask] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<TaskStatus | null>(null);

  const handleDragStart = (taskId: string) => {
    setDraggedTask(taskId);
  };

  const handleDragOver = (e: React.DragEvent, status: TaskStatus) => {
    e.preventDefault();
    setDragOverColumn(status);
  };

  const handleDrop = (status: TaskStatus) => {
    if (draggedTask) {
      onMoveTask(draggedTask, status);
    }
    setDraggedTask(null);
    setDragOverColumn(null);
  };

  const handleDragEnd = () => {
    setDraggedTask(null);
    setDragOverColumn(null);
  };

  return (
    <div
      style={{
        display: 'flex',
        gap: 16,
        padding: 24,
        height: '100%',
        overflowX: 'auto',
      }}
    >
      {COLUMNS.map((col) => {
        const columnTasks = tasks.filter((t) => t.status === col.status);
        const config = STATUS_CONFIG[col.status];
        const isOver = dragOverColumn === col.status;

        return (
          <div
            key={col.status}
            onDragOver={(e) => handleDragOver(e, col.status)}
            onDrop={() => handleDrop(col.status)}
            onDragLeave={() => setDragOverColumn(null)}
            style={{
              width: 300,
              minWidth: 300,
              display: 'flex',
              flexDirection: 'column',
              borderRadius: 'var(--aq-radius-lg)',
              background: isOver ? config.bgColor : 'var(--aq-bg-sunken)',
              transition: 'background 0.15s ease',
              border: isOver ? `2px dashed ${config.color}` : '2px solid transparent',
            }}
          >
            {/* Column header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '14px 16px 10px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    background: config.color,
                  }}
                />
                <span style={{ fontSize: 13, fontWeight: 600 }}>{col.label}</span>
                <span
                  style={{
                    fontSize: 11,
                    color: 'var(--aq-text-muted)',
                    background: 'var(--aq-bg-hover)',
                    borderRadius: 99,
                    padding: '1px 7px',
                    fontWeight: 600,
                  }}
                >
                  {columnTasks.length}
                </span>
              </div>
              <button
                onClick={() => onCreateTask(col.status)}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--aq-text-muted)',
                  fontSize: 18,
                  lineHeight: 1,
                  padding: '0 4px',
                }}
                title={`Add task to ${col.label}`}
              >
                +
              </button>
            </div>

            {/* Cards */}
            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                padding: '0 8px 8px',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              {columnTasks.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  isDragged={draggedTask === task.id}
                  onClick={() => onTaskClick(task)}
                  onDragStart={() => handleDragStart(task.id)}
                  onDragEnd={handleDragEnd}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TaskCard({
  task,
  isDragged,
  onClick,
  onDragStart,
  onDragEnd,
}: {
  task: Task;
  isDragged: boolean;
  onClick: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
      className="aq-card"
      style={{
        padding: '12px 14px',
        cursor: 'grab',
        opacity: isDragged ? 0.4 : 1,
        transition: 'all var(--aq-transition)',
        userSelect: 'none',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = 'var(--aq-shadow-md)';
        e.currentTarget.style.transform = 'translateY(-1px)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = 'var(--aq-shadow-sm)';
        e.currentTarget.style.transform = 'translateY(0)';
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8, lineHeight: 1.4 }}>
        {task.title}
      </div>

      {task.description && (
        <div
          style={{
            fontSize: 12,
            color: 'var(--aq-text-muted)',
            marginBottom: 8,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {task.description}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <PriorityBadge priority={task.priority} />
          {task.due_date && (
            <span
              style={{
                fontSize: 11,
                color: isOverdue(task.due_date) ? 'var(--aq-error)' : 'var(--aq-text-muted)',
                fontWeight: isOverdue(task.due_date) ? 600 : 400,
              }}
            >
              {formatDate(task.due_date)}
            </span>
          )}
        </div>
        {task.assignee && <Avatar user={task.assignee} size="sm" />}
      </div>

      {task.subtasks && task.subtasks.length > 0 && (
        <div style={{ marginTop: 8, fontSize: 11, color: 'var(--aq-text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
          <span>☐</span>
          {task.subtasks.filter((s) => s.status === 'done').length}/{task.subtasks.length} subtasks
        </div>
      )}
    </div>
  );
}
