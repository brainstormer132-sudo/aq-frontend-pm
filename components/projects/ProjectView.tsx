'use client';

import { useState } from 'react';
import { TopBar } from '@/components/layout/TopBar';
import { BoardView } from '@/components/tasks/BoardView';
import { ListView } from '@/components/tasks/ListView';
import { CalendarView } from '@/components/tasks/CalendarView';
import { TaskDetail } from '@/components/tasks/TaskDetail';
import { CreateTaskModal } from '@/components/tasks/CreateTaskModal';
import { EmptyState } from '@/components/ui/EmptyState';
import type { Project, Task, Comment, Section, Profile, ViewMode, TaskStatus, TaskPriority, FilterState } from '@/types';

interface ProjectViewProps {
  project: Project;
  tasks: Task[];
  sections: Section[];
  comments: Comment[];
  members: Profile[];
  currentUser: Profile | null;
  onUpdateTask: (id: string, updates: Partial<Task>) => void;
  onCreateTask: (task: Partial<Task>) => void;
  onDeleteTask: (id: string) => void;
  onAddComment: (taskId: string, content: string) => void;
  onDeleteProject?: () => void;
  onRefresh: () => void;
}

export function ProjectView({
  project, tasks, sections, comments, members, currentUser,
  onUpdateTask, onCreateTask, onDeleteTask, onAddComment, onDeleteProject, onRefresh,
}: ProjectViewProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('board');
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [defaultStatus, setDefaultStatus] = useState<TaskStatus>('todo');
  const [filters, setFilters] = useState<FilterState>({});

  const filteredTasks = tasks.filter((t) => {
    if (filters.search && !t.title.toLowerCase().includes(filters.search.toLowerCase())) return false;
    if (filters.assignee && t.assignee_id !== filters.assignee) return false;
    if (filters.priority && t.priority !== filters.priority) return false;
    return true;
  });

  const taskComments = comments.filter((c) => c.task_id === selectedTask?.id);

  const views: { id: ViewMode; label: string; icon: string }[] = [
    { id: 'board', label: 'Board', icon: '▦' },
    { id: 'list', label: 'List', icon: '☰' },
    { id: 'calendar', label: 'Calendar', icon: '◷' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TopBar
        title={`${project.icon} ${project.name}`}
        subtitle={project.description || undefined}
        onSearch={(q) => setFilters((f) => ({ ...f, search: q }))}
        actions={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {/* View switcher */}
            <div
              style={{
                display: 'flex',
                background: 'var(--aq-bg-sunken)',
                borderRadius: 'var(--aq-radius)',
                padding: 2,
              }}
            >
              {views.map((v) => (
                <button
                  key={v.id}
                  onClick={() => setViewMode(v.id)}
                  className="aq-btn"
                  style={{
                    padding: '4px 10px',
                    fontSize: 12,
                    background: viewMode === v.id ? 'var(--aq-bg-elevated)' : 'transparent',
                    color: viewMode === v.id ? 'var(--aq-text)' : 'var(--aq-text-muted)',
                    boxShadow: viewMode === v.id ? 'var(--aq-shadow-sm)' : 'none',
                    borderRadius: 'var(--aq-radius-sm)',
                  }}
                >
                  {v.icon} {v.label}
                </button>
              ))}
            </div>

            {/* Filter by priority */}
            <select
              className="aq-input"
              style={{ width: 120, padding: '4px 8px', fontSize: 12 }}
              value={filters.priority || ''}
              onChange={(e) => setFilters((f) => ({ ...f, priority: e.target.value as TaskPriority || undefined }))}
            >
              <option value="">All priorities</option>
              <option value="urgent">Urgent</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>

            <button
              className="aq-btn aq-btn-primary"
              style={{ fontSize: 13 }}
              onClick={() => { setDefaultStatus('todo'); setCreateModalOpen(true); }}
            >
              + Add Task
            </button>

            {onDeleteProject && (
              <button
                className="aq-btn aq-btn-ghost"
                style={{ fontSize: 13, color: 'var(--aq-error)', padding: '4px 8px' }}
                onClick={() => onDeleteProject()}
                title="Delete project"
              >
                🗑
              </button>
            )}
          </div>
        }
      />

      <div style={{ flex: 1, overflow: 'hidden' }}>
        {filteredTasks.length === 0 && !filters.search && !filters.priority ? (
          <EmptyState
            icon="📋"
            title="No tasks yet"
            description="Create your first task to get this project moving."
            action={{ label: '+ Create Task', onClick: () => setCreateModalOpen(true) }}
          />
        ) : (
          <>
            {viewMode === 'board' && (
              <BoardView
                tasks={filteredTasks}
                sections={sections}
                onTaskClick={setSelectedTask}
                onMoveTask={(id, status) => onUpdateTask(id, { status })}
                onCreateTask={(status) => { setDefaultStatus(status); setCreateModalOpen(true); }}
              />
            )}
            {viewMode === 'list' && (
              <ListView
                tasks={filteredTasks}
                onTaskClick={setSelectedTask}
                onStatusChange={(id, status) => onUpdateTask(id, { status })}
                onPriorityChange={(id, priority) => onUpdateTask(id, { priority })}
              />
            )}
            {viewMode === 'calendar' && (
              <CalendarView
                tasks={filteredTasks}
                onTaskClick={setSelectedTask}
                onCreateTask={(date) => {
                  setDefaultStatus('todo');
                  setCreateModalOpen(true);
                }}
              />
            )}
          </>
        )}
      </div>

      {/* Task detail panel */}
      {selectedTask && (
        <TaskDetail
          task={selectedTask}
          comments={taskComments}
          currentUser={currentUser}
          onClose={() => setSelectedTask(null)}
          onUpdate={(updates) => {
            onUpdateTask(selectedTask.id, updates);
            setSelectedTask({ ...selectedTask, ...updates });
          }}
          onAddComment={(content) => onAddComment(selectedTask.id, content)}
          onDelete={() => {
            onDeleteTask(selectedTask.id);
            setSelectedTask(null);
          }}
        />
      )}

      {/* Create task modal */}
      <CreateTaskModal
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        onCreate={(task) => {
          onCreateTask({
            ...task,
            project_id: project.id,
            creator_id: currentUser?.id,
          } as Partial<Task>);
        }}
        defaultStatus={defaultStatus}
        members={members}
      />
    </div>
  );
}
