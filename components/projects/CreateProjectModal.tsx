'use client';

import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { PROJECT_COLORS } from '@/lib/utils';
import type { ProjectColor, ProjectStatus } from '@/types';

interface CreateProjectModalProps {
  open: boolean;
  onClose: () => void;
  onCreate: (project: {
    name: string;
    description: string;
    color: ProjectColor;
    icon: string;
  }) => void;
}

const ICONS = ['📁', '🚀', '🎨', '📊', '💡', '🔧', '📱', '🌐', '📝', '🎯', '⚡', '🏗️', '📦', '🎮', '🛒', '📣'];

export function CreateProjectModal({ open, onClose, onCreate }: CreateProjectModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState<ProjectColor>('blue');
  const [icon, setIcon] = useState('📁');

  const handleSubmit = () => {
    if (!name.trim()) return;
    onCreate({ name: name.trim(), description: description.trim(), color, icon });
    setName('');
    setDescription('');
    setColor('blue');
    setIcon('📁');
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="Create Project" width="480px">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--aq-text-muted)', display: 'block', marginBottom: 4 }}>
            Project Name *
          </label>
          <input
            className="aq-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Website Redesign"
            autoFocus
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
            placeholder="What's this project about?"
            rows={2}
            style={{ resize: 'vertical', fontFamily: 'inherit' }}
          />
        </div>

        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--aq-text-muted)', display: 'block', marginBottom: 8 }}>
            Icon
          </label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {ICONS.map((ic) => (
              <button
                key={ic}
                onClick={() => setIcon(ic)}
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 'var(--aq-radius)',
                  border: icon === ic ? '2px solid var(--aq-accent)' : '2px solid transparent',
                  background: icon === ic ? 'var(--aq-accent-light)' : 'var(--aq-bg-sunken)',
                  fontSize: 18,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {ic}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--aq-text-muted)', display: 'block', marginBottom: 8 }}>
            Color
          </label>
          <div style={{ display: 'flex', gap: 6 }}>
            {(Object.entries(PROJECT_COLORS) as [ProjectColor, string][]).map(([key, hex]) => (
              <button
                key={key}
                onClick={() => setColor(key)}
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  background: hex,
                  border: color === key ? '3px solid var(--aq-text)' : '3px solid transparent',
                  cursor: 'pointer',
                  outline: color === key ? '2px solid var(--aq-bg-elevated)' : 'none',
                }}
              />
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
          <button className="aq-btn aq-btn-secondary" onClick={onClose}>Cancel</button>
          <button
            className="aq-btn aq-btn-primary"
            onClick={handleSubmit}
            disabled={!name.trim()}
            style={{ opacity: name.trim() ? 1 : 0.5 }}
          >
            Create Project
          </button>
        </div>
      </div>
    </Modal>
  );
}
