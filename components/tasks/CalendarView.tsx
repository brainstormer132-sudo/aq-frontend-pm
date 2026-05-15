'use client';

import { useState, useMemo } from 'react';
import { Avatar } from '@/components/ui/Avatar';
import { PRIORITY_CONFIG, isOverdue } from '@/lib/utils';
import type { Task } from '@/types';

interface CalendarViewProps {
  tasks: Task[];
  onTaskClick: (task: Task) => void;
  onCreateTask: (date: string) => void;
}

export function CalendarView({ tasks, onTaskClick, onCreateTask }: CalendarViewProps) {
  const [currentDate, setCurrentDate] = useState(new Date());

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const days = useMemo(() => {
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();
    const grid: { date: number; month: 'prev' | 'current' | 'next'; fullDate: string }[] = [];

    for (let i = firstDay - 1; i >= 0; i--) {
      const d = daysInPrevMonth - i;
      const m = month === 0 ? 11 : month - 1;
      const y = month === 0 ? year - 1 : year;
      grid.push({ date: d, month: 'prev', fullDate: `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}` });
    }

    for (let d = 1; d <= daysInMonth; d++) {
      grid.push({ date: d, month: 'current', fullDate: `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}` });
    }

    const remaining = 42 - grid.length;
    for (let d = 1; d <= remaining; d++) {
      const m = month === 11 ? 0 : month + 1;
      const y = month === 11 ? year + 1 : year;
      grid.push({ date: d, month: 'next', fullDate: `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}` });
    }

    return grid;
  }, [year, month]);

  const tasksByDate = useMemo(() => {
    const map: Record<string, Task[]> = {};
    tasks.forEach((t) => {
      if (t.due_date) {
        const key = t.due_date.slice(0, 10);
        if (!map[key]) map[key] = [];
        map[key].push(t);
      }
    });
    return map;
  }, [tasks]);

  const today = new Date().toISOString().slice(0, 10);
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  return (
    <div style={{ padding: 24 }}>
      {/* Month navigation */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            className="aq-btn aq-btn-ghost"
            onClick={() => setCurrentDate(new Date(year, month - 1, 1))}
          >
            ‹
          </button>
          <h3 style={{ fontSize: 16, fontWeight: 600, minWidth: 160, textAlign: 'center' }}>
            {monthNames[month]} {year}
          </h3>
          <button
            className="aq-btn aq-btn-ghost"
            onClick={() => setCurrentDate(new Date(year, month + 1, 1))}
          >
            ›
          </button>
        </div>
        <button
          className="aq-btn aq-btn-secondary"
          onClick={() => setCurrentDate(new Date())}
          style={{ fontSize: 12 }}
        >
          Today
        </button>
      </div>

      {/* Calendar grid */}
      <div className="aq-card" style={{ overflow: 'hidden' }}>
        {/* Day headers */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: '1px solid var(--aq-border-light)' }}>
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
            <div
              key={day}
              style={{
                padding: '8px 0',
                textAlign: 'center',
                fontSize: 11,
                fontWeight: 600,
                color: 'var(--aq-text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}
            >
              {day}
            </div>
          ))}
        </div>

        {/* Day cells */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
          {days.map((day, i) => {
            const dayTasks = tasksByDate[day.fullDate] || [];
            const isToday = day.fullDate === today;

            return (
              <div
                key={i}
                onClick={() => onCreateTask(day.fullDate)}
                style={{
                  minHeight: 100,
                  padding: 6,
                  borderRight: (i + 1) % 7 !== 0 ? '1px solid var(--aq-border-light)' : 'none',
                  borderBottom: i < 35 ? '1px solid var(--aq-border-light)' : 'none',
                  background: isToday ? 'var(--aq-accent-light)' : day.month !== 'current' ? 'var(--aq-bg-sunken)' : 'transparent',
                  cursor: 'pointer',
                  transition: 'background var(--aq-transition)',
                }}
                onMouseEnter={(e) => { if (!isToday) e.currentTarget.style.background = 'var(--aq-bg-hover)'; }}
                onMouseLeave={(e) => { if (!isToday) e.currentTarget.style.background = day.month !== 'current' ? 'var(--aq-bg-sunken)' : 'transparent'; }}
              >
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: isToday ? 700 : 400,
                    color: day.month !== 'current' ? 'var(--aq-text-muted)' : isToday ? 'var(--aq-accent)' : 'var(--aq-text)',
                    marginBottom: 4,
                    textAlign: 'right',
                    padding: '0 2px',
                  }}
                >
                  {day.date}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {dayTasks.slice(0, 3).map((task) => (
                    <div
                      key={task.id}
                      onClick={(e) => { e.stopPropagation(); onTaskClick(task); }}
                      style={{
                        fontSize: 11,
                        padding: '2px 4px',
                        borderRadius: 3,
                        background: PRIORITY_CONFIG[task.priority].color + '18',
                        color: PRIORITY_CONFIG[task.priority].color === '#6b7280' ? 'var(--aq-text-secondary)' : PRIORITY_CONFIG[task.priority].color,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        cursor: 'pointer',
                        fontWeight: 500,
                      }}
                    >
                      {task.title}
                    </div>
                  ))}
                  {dayTasks.length > 3 && (
                    <div style={{ fontSize: 10, color: 'var(--aq-text-muted)', textAlign: 'center' }}>
                      +{dayTasks.length - 3} more
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
