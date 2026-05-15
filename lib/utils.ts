import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { TaskPriority, TaskStatus, ProjectColor } from '@/types';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

export function formatDate(date: string | null): string {
  if (!date) return '';
  return new Date(date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatRelativeDate(date: string): string {
  const now = new Date();
  const d = new Date(date);
  const diff = now.getTime() - d.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return formatDate(date);
}

export function isOverdue(dueDate: string | null): boolean {
  if (!dueDate) return false;
  return new Date(dueDate) < new Date(new Date().toDateString());
}

export function isDueToday(dueDate: string | null): boolean {
  if (!dueDate) return false;
  const today = new Date().toDateString();
  return new Date(dueDate).toDateString() === today;
}

export const PRIORITY_CONFIG: Record<TaskPriority, { label: string; color: string; icon: string }> = {
  urgent: { label: 'Urgent', color: '#ef4444', icon: '🔴' },
  high:   { label: 'High',   color: '#f97316', icon: '🟠' },
  medium: { label: 'Medium', color: '#eab308', icon: '🟡' },
  low:    { label: 'Low',    color: '#3b82f6', icon: '🔵' },
  none:   { label: 'None',   color: '#6b7280', icon: '⚪' },
};

export const STATUS_CONFIG: Record<TaskStatus, { label: string; color: string; bgColor: string }> = {
  todo:        { label: 'To Do',       color: '#6b7280', bgColor: '#f3f4f6' },
  in_progress: { label: 'In Progress', color: '#3b82f6', bgColor: '#dbeafe' },
  in_review:   { label: 'In Review',   color: '#8b5cf6', bgColor: '#ede9fe' },
  done:        { label: 'Done',        color: '#10b981', bgColor: '#d1fae5' },
  cancelled:   { label: 'Cancelled',   color: '#ef4444', bgColor: '#fee2e2' },
};

export const PROJECT_COLORS: Record<ProjectColor, string> = {
  red:    '#ef4444',
  orange: '#f97316',
  yellow: '#eab308',
  green:  '#22c55e',
  teal:   '#14b8a6',
  blue:   '#3b82f6',
  indigo: '#6366f1',
  purple: '#a855f7',
  pink:   '#ec4899',
  gray:   '#6b7280',
};

export function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
