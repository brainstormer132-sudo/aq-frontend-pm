'use client';

import { Avatar } from '@/components/ui/Avatar';
import { StatusBadge, PriorityBadge } from '@/components/ui/Badges';
import { formatRelativeDate, isOverdue, isDueToday, formatDate } from '@/lib/utils';
import type { Task, Project, ActivityLog, Profile } from '@/types';

interface DashboardViewProps {
  user: Profile | null;
  myTasks: Task[];
  projects: Project[];
  activity: ActivityLog[];
  onTaskClick: (task: Task) => void;
  onProjectClick: (projectId: string) => void;
}

export function DashboardView({
  user,
  myTasks,
  projects,
  activity,
  onTaskClick,
  onProjectClick,
}: DashboardViewProps) {
  const overdueTasks = myTasks.filter((t) => isOverdue(t.due_date));
  const todayTasks = myTasks.filter((t) => isDueToday(t.due_date));
  const upcomingTasks = myTasks.filter((t) => !isOverdue(t.due_date) && !isDueToday(t.due_date));

  const stats = [
    { label: 'My Tasks', value: myTasks.length, icon: '☑', color: 'var(--aq-accent)' },
    { label: 'Overdue', value: overdueTasks.length, icon: '⚠', color: 'var(--aq-error)' },
    { label: 'Due Today', value: todayTasks.length, icon: '◷', color: 'var(--aq-warning)' },
    { label: 'Projects', value: projects.length, icon: '◫', color: 'var(--aq-success)' },
  ];

  return (
    <div style={{ padding: 28, maxWidth: 1200, overflowY: 'auto', height: '100%' }}>
      {/* Greeting */}
      <div style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 24, fontWeight: 600, marginBottom: 4 }}>
          Good {getGreeting()}, {user?.full_name?.split(' ')[0] || 'there'}
        </h2>
        <p style={{ color: 'var(--aq-text-muted)', fontSize: 14 }}>
          Here&apos;s what&apos;s happening across your projects.
        </p>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 32 }}>
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="aq-card"
            style={{ padding: '20px 24px', display: 'flex', alignItems: 'center', gap: 16 }}
          >
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 10,
                background: stat.color + '14',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 20,
              }}
            >
              {stat.icon}
            </div>
            <div>
              <div style={{ fontSize: 26, fontWeight: 700, lineHeight: 1 }}>{stat.value}</div>
              <div style={{ fontSize: 12, color: 'var(--aq-text-muted)', marginTop: 2 }}>{stat.label}</div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 24 }}>
        {/* My Tasks */}
        <div>
          <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>My Tasks</h3>

          {overdueTasks.length > 0 && (
            <TaskSection
              title="Overdue"
              tasks={overdueTasks}
              dotColor="var(--aq-error)"
              onTaskClick={onTaskClick}
            />
          )}
          {todayTasks.length > 0 && (
            <TaskSection
              title="Today"
              tasks={todayTasks}
              dotColor="var(--aq-warning)"
              onTaskClick={onTaskClick}
            />
          )}
          {upcomingTasks.length > 0 && (
            <TaskSection
              title="Upcoming"
              tasks={upcomingTasks}
              dotColor="var(--aq-info)"
              onTaskClick={onTaskClick}
            />
          )}

          {myTasks.length === 0 && (
            <div
              className="aq-card"
              style={{ padding: 40, textAlign: 'center', color: 'var(--aq-text-muted)', fontSize: 14 }}
            >
              No tasks assigned to you. Enjoy the free time!
            </div>
          )}
        </div>

        {/* Activity Feed */}
        <div>
          <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>Recent Activity</h3>
          <div className="aq-card" style={{ padding: 0, overflow: 'hidden' }}>
            {activity.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--aq-text-muted)', fontSize: 14 }}>
                No recent activity
              </div>
            ) : (
              activity.slice(0, 12).map((item, i) => (
                <div
                  key={item.id}
                  className={i === 0 ? '' : ''}
                  style={{
                    display: 'flex',
                    gap: 10,
                    padding: '12px 16px',
                    borderBottom: i < activity.length - 1 ? '1px solid var(--aq-border-light)' : 'none',
                    fontSize: 13,
                  }}
                >
                  <Avatar user={item.user || null} size="sm" />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div>
                      <span style={{ fontWeight: 500 }}>{item.user?.full_name}</span>{' '}
                      <span style={{ color: 'var(--aq-text-secondary)' }}>
                        {formatAction(item.action)}
                      </span>{' '}
                      {item.task && (
                        <span style={{ fontWeight: 500 }}>{item.task.title}</span>
                      )}
                    </div>
                    <div style={{ color: 'var(--aq-text-muted)', fontSize: 11, marginTop: 2 }}>
                      {formatRelativeDate(item.created_at)}
                      {item.project && ` · ${item.project.name}`}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Projects Grid */}
      <div style={{ marginTop: 32 }}>
        <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>Projects</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
          {projects.map((project) => (
            <button
              key={project.id}
              onClick={() => onProjectClick(project.id)}
              className="aq-card"
              style={{
                padding: 20,
                border: 'none',
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'all var(--aq-transition)',
                background: 'var(--aq-bg-elevated)',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.boxShadow = 'var(--aq-shadow-md)')}
              onMouseLeave={(e) => (e.currentTarget.style.boxShadow = 'var(--aq-shadow-sm)')}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <span style={{ fontSize: 22 }}>{project.icon}</span>
                <span style={{ fontSize: 15, fontWeight: 600 }}>{project.name}</span>
              </div>
              {project.description && (
                <p style={{ fontSize: 13, color: 'var(--aq-text-muted)', marginBottom: 12, lineHeight: 1.4 }}>
                  {project.description}
                </p>
              )}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span
                  className="aq-badge"
                  style={{
                    background: project.status === 'active' ? 'var(--aq-success)' + '18' : 'var(--aq-bg-hover)',
                    color: project.status === 'active' ? 'var(--aq-success)' : 'var(--aq-text-muted)',
                  }}
                >
                  {project.status}
                </span>
                {project.due_date && (
                  <span style={{ fontSize: 12, color: 'var(--aq-text-muted)' }}>
                    Due {formatDate(project.due_date)}
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function TaskSection({
  title,
  tasks,
  dotColor,
  onTaskClick,
}: {
  title: string;
  tasks: Task[];
  dotColor: string;
  onTaskClick: (task: Task) => void;
}) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor }} />
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--aq-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          {title} ({tasks.length})
        </span>
      </div>
      <div className="aq-card" style={{ padding: 0, overflow: 'hidden' }}>
        {tasks.map((task, i) => (
          <button
            key={task.id}
            onClick={() => onTaskClick(task)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              width: '100%',
              padding: '10px 16px',
              background: 'none',
              border: 'none',
              borderBottom: i < tasks.length - 1 ? '1px solid var(--aq-border-light)' : 'none',
              cursor: 'pointer',
              textAlign: 'left',
              fontSize: 13,
              transition: 'background var(--aq-transition)',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--aq-bg-sunken)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            <StatusBadge status={task.status} />
            <span style={{ flex: 1, fontWeight: 500 }}>{task.title}</span>
            <PriorityBadge priority={task.priority} />
            {task.due_date && (
              <span
                style={{
                  fontSize: 12,
                  color: isOverdue(task.due_date) ? 'var(--aq-error)' : 'var(--aq-text-muted)',
                }}
              >
                {formatDate(task.due_date)}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

function formatAction(action: string): string {
  const map: Record<string, string> = {
    created: 'created',
    updated: 'updated',
    deleted: 'deleted',
    completed: 'completed',
    assigned: 'was assigned',
    unassigned: 'was unassigned from',
    commented: 'commented on',
    moved: 'moved',
    status_changed: 'changed status of',
    priority_changed: 'changed priority of',
  };
  return map[action] || action;
}
