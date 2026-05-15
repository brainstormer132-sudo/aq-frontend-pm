'use client';

import { useState } from 'react';
import { Avatar } from '@/components/ui/Avatar';
import { StatusBadge, PriorityBadge } from '@/components/ui/Badges';
import { Dropdown } from '@/components/ui/Dropdown';
import { formatDate, formatRelativeDate, STATUS_CONFIG, PRIORITY_CONFIG } from '@/lib/utils';
import type { Task, Comment, Profile, TaskStatus, TaskPriority } from '@/types';

interface TaskDetailProps {
  task: Task;
  comments: Comment[];
  currentUser: Profile | null;
  onClose: () => void;
  onUpdate: (updates: Partial<Task>) => void;
  onAddComment: (content: string) => void;
  onDelete: () => void;
}

export function TaskDetail({
  task,
  comments,
  currentUser,
  onClose,
  onUpdate,
  onAddComment,
  onDelete,
}: TaskDetailProps) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description || '');
  const [editingDesc, setEditingDesc] = useState(false);
  const [commentText, setCommentText] = useState('');

  const statusItems = Object.entries(STATUS_CONFIG).map(([value, config]) => ({
    label: config.label, value, color: config.color,
  }));

  const priorityItems = Object.entries(PRIORITY_CONFIG).map(([value, config]) => ({
    label: config.label, value, icon: config.icon,
  }));

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        width: 560,
        maxWidth: '100vw',
        height: '100vh',
        background: 'var(--aq-bg-elevated)',
        borderLeft: '1px solid var(--aq-border-light)',
        boxShadow: 'var(--aq-shadow-lg)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 500,
      }}
      className="animate-slide-in"
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 20px',
          borderBottom: '1px solid var(--aq-border-light)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <StatusBadge status={task.status} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <Dropdown
            trigger={
              <button className="aq-btn aq-btn-ghost" style={{ padding: '4px 8px', fontSize: 14 }}>
                ⋯
              </button>
            }
            items={[
              { label: 'Delete task', value: 'delete', icon: '🗑', danger: true },
            ]}
            onSelect={(v) => { if (v === 'delete') onDelete(); }}
            align="right"
          />
          <button
            className="aq-btn aq-btn-ghost"
            onClick={onClose}
            style={{ padding: '4px 8px', fontSize: 18 }}
          >
            ×
          </button>
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
        {/* Title */}
        {editingTitle ? (
          <input
            className="aq-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => { setEditingTitle(false); if (title !== task.title) onUpdate({ title }); }}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
            autoFocus
            style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}
          />
        ) : (
          <h2
            onClick={() => setEditingTitle(true)}
            style={{ fontSize: 18, fontWeight: 600, marginBottom: 16, cursor: 'text' }}
          >
            {task.title}
          </h2>
        )}

        {/* Meta fields */}
        <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr', gap: '12px 16px', marginBottom: 24, fontSize: 13 }}>
          <span style={{ color: 'var(--aq-text-muted)', fontWeight: 500 }}>Status</span>
          <Dropdown
            trigger={<StatusBadge status={task.status} />}
            items={statusItems}
            onSelect={(v) => onUpdate({ status: v as TaskStatus })}
          />

          <span style={{ color: 'var(--aq-text-muted)', fontWeight: 500 }}>Priority</span>
          <Dropdown
            trigger={
              task.priority === 'none'
                ? <span style={{ color: 'var(--aq-text-muted)' }}>Set priority</span>
                : <PriorityBadge priority={task.priority} />
            }
            items={priorityItems}
            onSelect={(v) => onUpdate({ priority: v as TaskPriority })}
          />

          <span style={{ color: 'var(--aq-text-muted)', fontWeight: 500 }}>Assignee</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {task.assignee ? (
              <>
                <Avatar user={task.assignee} size="sm" />
                <span>{task.assignee.full_name}</span>
              </>
            ) : (
              <span style={{ color: 'var(--aq-text-muted)' }}>Unassigned</span>
            )}
          </div>

          <span style={{ color: 'var(--aq-text-muted)', fontWeight: 500 }}>Due date</span>
          <input
            type="date"
            value={task.due_date || ''}
            onChange={(e) => onUpdate({ due_date: e.target.value || null })}
            className="aq-input"
            style={{ width: 160, padding: '4px 8px', fontSize: 13 }}
          />

          <span style={{ color: 'var(--aq-text-muted)', fontWeight: 500 }}>Created</span>
          <span style={{ color: 'var(--aq-text-secondary)' }}>{formatDate(task.created_at)}</span>

          {task.creator && (
            <>
              <span style={{ color: 'var(--aq-text-muted)', fontWeight: 500 }}>Creator</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Avatar user={task.creator} size="sm" />
                <span>{task.creator.full_name}</span>
              </div>
            </>
          )}
        </div>

        {/* Description */}
        <div style={{ marginBottom: 24 }}>
          <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Description</h4>
          {editingDesc ? (
            <div>
              <textarea
                className="aq-input"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                style={{ resize: 'vertical', fontFamily: 'inherit' }}
                autoFocus
              />
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button
                  className="aq-btn aq-btn-primary"
                  style={{ fontSize: 12, padding: '4px 12px' }}
                  onClick={() => { setEditingDesc(false); onUpdate({ description }); }}
                >
                  Save
                </button>
                <button
                  className="aq-btn aq-btn-ghost"
                  style={{ fontSize: 12, padding: '4px 12px' }}
                  onClick={() => { setEditingDesc(false); setDescription(task.description || ''); }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div
              onClick={() => setEditingDesc(true)}
              style={{
                fontSize: 13,
                color: description ? 'var(--aq-text-secondary)' : 'var(--aq-text-muted)',
                lineHeight: 1.6,
                cursor: 'text',
                padding: '8px 12px',
                borderRadius: 'var(--aq-radius)',
                border: '1px solid transparent',
                transition: 'border var(--aq-transition)',
                minHeight: 40,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--aq-border)')}
              onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'transparent')}
            >
              {description || 'Add a description...'}
            </div>
          )}
        </div>

        {/* Comments */}
        <div>
          <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>
            Comments ({comments.length})
          </h4>

          {comments.map((comment) => (
            <div
              key={comment.id}
              style={{
                display: 'flex',
                gap: 10,
                marginBottom: 16,
              }}
            >
              <Avatar user={comment.author || null} size="sm" />
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{comment.author?.full_name}</span>
                  <span style={{ fontSize: 11, color: 'var(--aq-text-muted)' }}>
                    {formatRelativeDate(comment.created_at)}
                  </span>
                </div>
                <p style={{ fontSize: 13, color: 'var(--aq-text-secondary)', lineHeight: 1.5 }}>
                  {comment.content}
                </p>
              </div>
            </div>
          ))}

          {/* Comment input */}
          <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
            <Avatar user={currentUser} size="sm" />
            <div style={{ flex: 1 }}>
              <textarea
                className="aq-input"
                placeholder="Write a comment..."
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                rows={2}
                style={{ resize: 'none', fontFamily: 'inherit', fontSize: 13 }}
              />
              {commentText.trim() && (
                <button
                  className="aq-btn aq-btn-primary"
                  style={{ fontSize: 12, padding: '4px 14px', marginTop: 6 }}
                  onClick={() => {
                    onAddComment(commentText.trim());
                    setCommentText('');
                  }}
                >
                  Comment
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
