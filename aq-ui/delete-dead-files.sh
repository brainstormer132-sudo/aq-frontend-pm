#!/usr/bin/env bash
#
# Delete the 24 files nothing in the app reaches.
#
# Run from the root of aq-frontend-pm, on a branch, then `npx next build`
# before committing. Aug 2026.
#
# ── How these were found ────────────────────────────────────────────
#
# Reachability walk from every file under app/ (plus middleware), following
# static imports, dynamic import() and require(), resolving @/ and relative
# specifiers. 56 component files are reachable; these were not. Every name
# was then grepped across the repo by hand — the only hits outside their own
# files are three code COMMENTS mentioning them, which is itself the story:
#
#   app/dashboard/workflow/page.tsx:17
#     "NotificationsBell removed from topbar 2026-05-17 — the inbox is now…"
#   components/auth/AQWatermark.tsx:6
#     "It draws itself in exactly the way AnimatedAQLogo does…"
#   WorkflowSidebar.tsx
#     "My Tasks retired Aug 2026: it was All Tasks with one filter applied…"
#
# Verified after deleting: `npx tsc --noEmit` clean, `npx next build` compiles
# (it still stops at the /auth prerender for want of Supabase env vars, which
# it did before too).
#
# ── Why it is worth doing ───────────────────────────────────────────
#
# Four of these share a filename with a live screen — ClientsView,
# ContractsView, VendorsView, DashboardView — in a components/clients/,
# components/contracts/, components/vendors/, components/dashboard/ that look
# exactly like the real thing. They are an earlier scaffold that never got
# removed. Opening the wrong one and editing it for an hour is a matter of
# time, and it has already cost this pass more than once.
#
set -euo pipefail

echo "Deleting 24 unreachable files…"

git rm -q \
  components/auth/AnimatedAQLogo.tsx \
  components/clients/ClientsView.tsx \
  components/contracts/ContractsView.tsx \
  components/dashboard/DashboardView.tsx \
  components/layout/Sidebar.tsx \
  components/layout/TopBar.tsx \
  components/projects/CreateProjectModal.tsx \
  components/projects/ProjectView.tsx \
  components/tasks/BoardView.tsx \
  components/tasks/CalendarView.tsx \
  components/tasks/CreateTaskModal.tsx \
  components/tasks/ListView.tsx \
  components/tasks/TaskDetail.tsx \
  components/ui/Badges.tsx \
  components/ui/Dropdown.tsx \
  components/ui/EmptyState.tsx \
  components/ui/Modal.tsx \
  components/vendors/VendorsView.tsx \
  components/workflow/ClientsBrandsView.tsx \
  components/workflow/ManualEntryView.tsx \
  components/workflow/MyTasksList.tsx \
  components/workflow/NotificationsBell.tsx \
  components/workflow/RegistrationsView.tsx \
  hooks/use-supabase.ts

# Left behind on purpose, because something live still uses them:
#
#   components/ui/Avatar.tsx   MyProfileCard imports it
#   lib/utils.ts               Avatar imports getInitials from it
#   types/index.ts             Avatar and lib/utils import types from it
#
# That is the whole of what survives from the old scaffold: one avatar, one
# helper and a types file. Worth folding into the workflow components one day;
# not worth doing in the same commit as a deletion.

echo
echo "Now check it:"
echo "  npx tsc --noEmit      # expect silence"
echo "  npx next build        # expect 'Compiled successfully'"
echo
echo "Then commit. Nothing here is imported, so there is nothing to fix up."
