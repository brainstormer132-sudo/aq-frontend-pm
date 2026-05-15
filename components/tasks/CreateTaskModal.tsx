'use client';

import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { STATUS_CONFIG, PRIORITY_CONFIG } from '@/lib/utils';
import type { TaskStatus, TaskPriority, Profile } from '@/types';

interface CreateTaskModalProps {
  open: boolean;
  onClose: () => void;
  onCreate: (task: {
    title: string;
    description: string;
    status: TaskStatus;
    priority: TaskPriority;
    due_date: string | null;
    assignee_id: string | null;
  }) => void;
  defaultStatus?: TaskStatus;
  members?: Profile[];
}

export function CreateTaskModal({
  open,
  onClose,
  onCreate,
  defaultStatus = 'todo',
  members = [],
}: CreateTaskModalProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<TaskStatus>(defaultStatus);
  const [priority, setPriority] = useState<TaskPriority>('none');
  const [dueDate, setDueDate] = useState('');
  const [assigneeId, setAssigneeId] = useState('');

  const handleSubmit = () => {
    if (!title.trim()) return;
    onCreate({
      title: title.trim(),
      description: description.trim(),
      status,
      priority,
      due_date: dueDate || null,
      assignee_id: assigneeId || null,
    });
    setTitle('');
    setDescription('');
    setStatus('todo');
    setPriority('none');
    setDueDate('');
    setAssigneeId('');
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="Create Task" width="520px">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--aq-text-muted)', display: 'block', marginBottom: 4 }}>
            Title *
          </label>
          <input
            className="aq-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What needs to be done?"
            autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) handleSubmit(); }}
          />
        </div>

        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--aq-text-muted)', display: 'block', marginBottom: 4 }}>
            Description
          </label>
          <textarea
            className="aq-input"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Add more details..."
            rows={3}
            style={{ resize: 'vertical', fontFamily: 'inherit' }}
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--aq-text-muted)', display: 'block', marginBottom: 4 }}>
              Status
            </label>
            <select
              className="aq-input"
              value={status}
              onChange={(e) => setStatus(e.target.value as TaskStatus)}
            >
              {Object.entries(STATUS_CONFIG).map(([key, config]) => (
                <option key={key} value={key}>{config.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--aq-text-muted)', display: 'block', marginBottom: 4 }}>
              Priority
            </label>
            <select
              className="aq-input"
              value={priority}
              onChange={(e) => setPriority(e.target.value as TaskPriority)}
            >
              {Object.entries(PRIORITY_CONFIG).map(([key, config]) => (
                <option key={key} value={key}>{config.icon} {config.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--aq-text-muted)', display: 'block', marginBottom: 4 }}>
              Due Date
            </label>
            <input
              type="date"
              className="aq-input"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>

          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--aq-text-muted)', display: 'block', marginBottom: 4 }}>
              Assignee
            </label>
            <select
              className="aq-input"
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
            >
              <option value="">Unassigned</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>{m.full_name}</option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
          <button className="aq-btn aq-btn-secondary" onClick={onClose}>Cancel</button>
          <button
            className="aq-btn aq-btn-primary"
            onClick={handleSubmit}
            disabled={!title.trim()}
            style={{ opacity: title.trim() ? 1 : 0.5 }}
          >
            Create Task
          </button>
        </div>
      </div>
    </Modal>
  );
}
