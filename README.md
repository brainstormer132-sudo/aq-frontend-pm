# AQ Creativity — Project Management Platform

A modern, full-featured project management web app built with **Next.js 14**, **Supabase**, and **TypeScript**. Designed for creative teams who need powerful task management with real-time collaboration.

---

## Features

### Core
- **Team Collaboration & Assignments** — Multi-member workspaces with role-based access (Owner, Admin, Member, Guest)
- **Projects & Workspaces** — Organize work into workspaces and projects with custom icons and colors
- **Task Management** — Full task lifecycle with statuses, priorities, due dates, assignees, and subtasks
- **Three View Modes** — Kanban board (drag & drop), List view (sortable), Calendar view
- **Real-time Updates** — Supabase Realtime subscriptions for live collaboration
- **Comments** — Threaded comments on tasks
- **Activity Feed** — Full audit trail of all workspace activity
- **Notifications** — In-app notification system

### Technical
- **Row Level Security (RLS)** — Every table has granular RLS policies
- **Auth** — Email/password + Google/GitHub OAuth via Supabase Auth
- **Middleware** — Route protection with Next.js middleware
- **Dark Mode** — Full dark mode support via CSS variables
- **Responsive** — Mobile-friendly sidebar and layouts

---

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Set up Supabase

1. Create a project at [supabase.com](https://supabase.com)
2. Copy your project URL and anon key
3. Create `.env.local` from the template:

```bash
cp .env.local.example .env.local
```

4. Fill in your Supabase credentials

### 3. Run the migration

Go to your Supabase Dashboard → SQL Editor and paste the contents of:

```
supabase/migrations/001_initial_schema.sql
```

This creates all tables, RLS policies, triggers, and indexes.

### 4. Enable Realtime

In Supabase Dashboard → Database → Replication, enable realtime for:
- `tasks`
- `comments`
- `notifications`
- `activity_log`

### 5. Configure Auth (optional)

In Supabase Dashboard → Authentication → Providers:
- Enable Google OAuth (add client ID/secret)
- Enable GitHub OAuth (add client ID/secret)

### 6. Run the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

---

## Project Structure

```
aq-web/
├── app/
│   ├── auth/page.tsx          # Login / signup page
│   ├── dashboard/page.tsx     # Main app orchestrator
│   ├── layout.tsx             # Root layout with fonts
│   └── page.tsx               # Redirect to dashboard
├── components/
│   ├── ui/                    # Reusable UI primitives
│   │   ├── Avatar.tsx         # Avatar + AvatarGroup
│   │   ├── Badges.tsx         # Status & Priority badges
│   │   ├── Dropdown.tsx       # Dropdown menu
│   │   ├── EmptyState.tsx     # Empty state placeholder
│   │   └── Modal.tsx          # Modal dialog
│   ├── layout/
│   │   ├── Sidebar.tsx        # App sidebar navigation
│   │   └── TopBar.tsx         # Page header bar
│   ├── dashboard/
│   │   └── DashboardView.tsx  # Dashboard overview
│   ├── projects/
│   │   ├── ProjectView.tsx    # Project page with views
│   │   └── CreateProjectModal.tsx
│   ├── tasks/
│   │   ├── BoardView.tsx      # Kanban board
│   │   ├── ListView.tsx       # Table/list view
│   │   ├── CalendarView.tsx   # Monthly calendar
│   │   ├── TaskDetail.tsx     # Task detail panel
│   │   └── CreateTaskModal.tsx
│   └── team/
│       └── TeamView.tsx       # Team management
├── hooks/
│   ├── use-supabase.ts        # Data fetching hooks
│   └── use-realtime.ts        # Realtime subscription hook
├── lib/
│   ├── supabase-browser.ts    # Browser Supabase client
│   ├── supabase-server.ts     # Server Supabase client
│   └── utils.ts               # Utilities & constants
├── types/
│   └── index.ts               # Full TypeScript types
├── styles/
│   └── globals.css            # Global styles & CSS vars
├── supabase/
│   └── migrations/
│       └── 001_initial_schema.sql  # Full DB schema
├── middleware.ts               # Auth route protection
└── package.json
```

---

## Database Schema

| Table | Description |
|---|---|
| `profiles` | User profiles (auto-created on signup) |
| `workspaces` | Team workspaces |
| `workspace_members` | Workspace membership with roles |
| `projects` | Projects within workspaces |
| `sections` | Board columns / task groups |
| `tasks` | Tasks with status, priority, assignee |
| `task_assignments` | Multi-assignee support |
| `labels` | Color-coded labels |
| `task_labels` | Label ↔ task junction |
| `comments` | Task comments |
| `activity_log` | Audit trail |
| `notifications` | User notifications |

---

## Customization

### Theming

All colors are defined as CSS variables in `styles/globals.css`. Override them for custom branding:

```css
:root {
  --aq-accent: #your-brand-color;
  --aq-sidebar-bg: #your-sidebar-color;
}
```

### Dark Mode

Add `class="dark"` to the `<html>` element to enable dark mode. All variables automatically switch.

---

## Next Steps

- [ ] Add drag-and-drop library (e.g. `@dnd-kit`) for smoother board interactions
- [ ] Add file attachments to tasks (Supabase Storage)
- [ ] Add @mentions in comments
- [ ] Add project templates
- [ ] Add time tracking
- [ ] Add reporting / analytics dashboard
- [ ] Add Supabase Edge Functions for email notifications
- [ ] Add workspace invite flow with magic links

---

## License

Private — AQ Creativity
