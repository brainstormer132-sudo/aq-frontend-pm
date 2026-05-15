-- ============================================================
-- 027_seed_service_catalog.sql
-- Replace the original 9 service types with the user's updated
-- catalog of 8 service types + common subtasks.
--
-- Run in Supabase SQL Editor:
--   Dashboard → SQL Editor → paste → Run
--
-- WARNING: This deletes ALL existing template service types
-- and their steps, then re-inserts the new catalog. Any tasks
-- already triaged with the old service types will keep their
-- child tasks but lose their service_type_id reference.
-- ============================================================

-- ── 1. Delete old template steps + types ──────────────────────
-- Steps cascade from service_types FK, but let's be explicit.
DELETE FROM public.service_type_steps
WHERE service_type_id IN (
  SELECT id FROM public.service_types WHERE is_template = true
);

DELETE FROM public.task_service_types
WHERE service_type_id IN (
  SELECT id FROM public.service_types WHERE is_template = true
);

DELETE FROM public.service_types WHERE is_template = true;


-- ── 2. Insert new service types ───────────────────────────────
-- Using deterministic UUIDs so this script is idempotent.
INSERT INTO public.service_types (id, workspace_id, name, icon, description, is_template, position)
VALUES
  ('00000000-0000-0000-bbbb-000000000001', NULL, 'Ad Hook',          '🎯', 'Single ad hook / one-off creative',                true, 1),
  ('00000000-0000-0000-bbbb-000000000002', NULL, 'Package Ad',       '📦', 'Packaged ad bundle with timeline and direction',    true, 2),
  ('00000000-0000-0000-bbbb-000000000003', NULL, 'Campaign',         '📊', 'Full marketing campaign with strategy and visuals', true, 3),
  ('00000000-0000-0000-bbbb-000000000004', NULL, 'Sponsorship',      '🤝', 'Sponsorship deal with briefing and deliverables',   true, 4),
  ('00000000-0000-0000-bbbb-000000000005', NULL, 'Billboard',        '🪧',  'Billboard placement with briefing and visuals',     true, 5),
  ('00000000-0000-0000-bbbb-000000000006', NULL, 'Media Production', '🎬', 'End-to-end media production pipeline',              true, 6),
  ('00000000-0000-0000-bbbb-000000000007', NULL, 'Social Media',     '📱', 'Social media management and content',               true, 7),
  ('00000000-0000-0000-bbbb-000000000008', NULL, 'Event',            '🎪', 'Event concept, mood board and visuals',              true, 8)
ON CONFLICT (id) DO NOTHING;


-- ── 3. Insert service-type-specific steps ─────────────────────
-- Position 1..N = type-specific subtasks
-- Position 101..105 = common subtasks (added in step 4)

INSERT INTO public.service_type_steps (service_type_id, position, title, description) VALUES
  -- ── AD HOOK (no type-specific subtasks — only common) ──
  -- (common subtasks added below)

  -- ── PACKAGE AD ──
  ('00000000-0000-0000-bbbb-000000000002', 1, 'Timeline',         'Delivery timeline and milestones'),
  ('00000000-0000-0000-bbbb-000000000002', 2, 'Direction',        'Creative direction and brief'),
  ('00000000-0000-0000-bbbb-000000000002', 3, 'Media Production', 'Media production for the package'),

  -- ── CAMPAIGN ──
  ('00000000-0000-0000-bbbb-000000000003', 1, 'Analysis Report',                'Market / audience analysis'),
  ('00000000-0000-0000-bbbb-000000000003', 2, 'Insight',                        'Key insights and takeaways'),
  ('00000000-0000-0000-bbbb-000000000003', 3, 'Proof of Posting (for each ad)', 'POP screenshot per ad placement'),
  ('00000000-0000-0000-bbbb-000000000003', 4, 'Campaign Design',                'Visual design for the campaign'),
  ('00000000-0000-0000-bbbb-000000000003', 5, 'Marketing Strategy',             'Overall marketing strategy document'),
  ('00000000-0000-0000-bbbb-000000000003', 6, 'Visuals',                        'All visual assets'),
  ('00000000-0000-0000-bbbb-000000000003', 7, 'Blueprint Mapping / 3D',         'Blueprint mapping or 3D renders'),
  ('00000000-0000-0000-bbbb-000000000003', 8, 'Vendoring',                      'Vendor coordination and contracts'),

  -- ── SPONSORSHIP ──
  ('00000000-0000-0000-bbbb-000000000004', 1, 'Briefing',  'Sponsorship briefing document'),
  ('00000000-0000-0000-bbbb-000000000004', 2, 'Timeline',  'Delivery timeline'),
  ('00000000-0000-0000-bbbb-000000000004', 3, 'Visuals',   'Visual assets and branding'),

  -- ── BILLBOARD ──
  ('00000000-0000-0000-bbbb-000000000005', 1, 'Briefing',  'Billboard briefing document'),
  ('00000000-0000-0000-bbbb-000000000005', 2, 'Timeline',  'Installation and removal timeline'),
  ('00000000-0000-0000-bbbb-000000000005', 3, 'Visuals',   'Billboard artwork and visuals'),

  -- ── MEDIA PRODUCTION ──
  ('00000000-0000-0000-bbbb-000000000006', 1, 'Concept',                       'Creative concept'),
  ('00000000-0000-0000-bbbb-000000000006', 2, 'Story Board / Mood Board',      'Storyboard or mood board'),
  ('00000000-0000-0000-bbbb-000000000006', 3, 'Timeline',                      'Production timeline'),
  ('00000000-0000-0000-bbbb-000000000006', 4, 'Shooting',                      'Filming / photography'),
  ('00000000-0000-0000-bbbb-000000000006', 5, 'Art Direction',                 'Art direction for the shoot'),
  ('00000000-0000-0000-bbbb-000000000006', 6, 'Proof of Posting / Submission', 'POP or submission confirmation'),
  ('00000000-0000-0000-bbbb-000000000006', 7, 'Script Writing',                'Script / copy writing'),
  ('00000000-0000-0000-bbbb-000000000006', 8, 'Budgeting',                     'Production budget breakdown'),
  ('00000000-0000-0000-bbbb-000000000006', 9, 'Vendoring',                     'Vendor coordination'),

  -- ── SOCIAL MEDIA ──
  ('00000000-0000-0000-bbbb-000000000007', 1, 'Campaign',         'Social media campaign plan'),
  ('00000000-0000-0000-bbbb-000000000007', 2, 'Branding',         'Brand identity and assets'),
  ('00000000-0000-0000-bbbb-000000000007', 3, 'Posts',            'Post creation and scheduling'),
  ('00000000-0000-0000-bbbb-000000000007', 4, 'Content Calendar', 'Monthly content calendar'),
  ('00000000-0000-0000-bbbb-000000000007', 5, 'POP',             'Proof of posting'),
  ('00000000-0000-0000-bbbb-000000000007', 6, 'Paid Promotion',  'Paid ad management'),

  -- ── EVENT ──
  ('00000000-0000-0000-bbbb-000000000008', 1, 'Concept',    'Event concept and theme'),
  ('00000000-0000-0000-bbbb-000000000008', 2, 'Mood Board', 'Visual mood board'),
  ('00000000-0000-0000-bbbb-000000000008', 3, 'Visuals',    'Event visual assets')

ON CONFLICT (service_type_id, position) DO NOTHING;


-- ── 4. COMMON SUBTASKS — added to every service type ──────────
-- These 5 items appear for all service types at positions 101-105
-- so they sort after the type-specific steps.

INSERT INTO public.service_type_steps (service_type_id, position, title, description)
SELECT st.id, pos.p, pos.title, pos.descr
FROM public.service_types st
CROSS JOIN (VALUES
  (101, 'Tracking Sheet',        'Master tracking sheet for deliverables'),
  (102, 'Quotation',             'Price quotation for the client'),
  (103, 'Payment Confirmation',  'Payment receipt / confirmation'),
  (104, 'Invoice',               'Invoice generation'),
  (105, 'Contracts / Vendoring', 'Contract and vendor paperwork')
) AS pos(p, title, descr)
WHERE st.is_template = true
  AND st.id IN (
    '00000000-0000-0000-bbbb-000000000001',
    '00000000-0000-0000-bbbb-000000000002',
    '00000000-0000-0000-bbbb-000000000003',
    '00000000-0000-0000-bbbb-000000000004',
    '00000000-0000-0000-bbbb-000000000005',
    '00000000-0000-0000-bbbb-000000000006',
    '00000000-0000-0000-bbbb-000000000007',
    '00000000-0000-0000-bbbb-000000000008'
  )
ON CONFLICT (service_type_id, position) DO NOTHING;


-- ── 5. Verify ─────────────────────────────────────────────────
-- Run after to confirm (should show 8 types, 75 steps total):
--
--   SELECT count(*) AS types FROM service_types WHERE is_template = true;
--   SELECT count(*) AS steps FROM service_type_steps
--     WHERE service_type_id IN (SELECT id FROM service_types WHERE is_template = true);
--
-- Detailed view:
--   SELECT st.icon, st.name, s.position, s.title
--     FROM service_type_steps s
--     JOIN service_types st ON st.id = s.service_type_id
--     WHERE st.is_template = true
--     ORDER BY st.position, s.position;
