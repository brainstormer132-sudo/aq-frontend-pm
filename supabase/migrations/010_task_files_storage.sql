-- ============================================================
-- 010_task_files_storage.sql
-- Create the `task-files` Storage bucket and RLS policies for it.
-- File metadata still lives in `task_attachments` (added in 009);
-- this just stores the actual file bytes and gates who can upload /
-- download / delete them.
--
-- Run in Supabase SQL Editor:
--   Dashboard → SQL Editor → paste → Run
--
-- File path convention used by the app:
--   {workspace_id}/{task_id}/{uuid}-{original_filename}
--
-- The first path segment (workspace_id) is what the policies key on,
-- so a member of workspace A can never read/write workspace B's files.
-- ============================================================

-- ── 1. Create the bucket (private, no public listing) ────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'task-files',
  'task-files',
  false,                     -- private; access goes through signed URLs
  52428800,                  -- 50 MB per file
  null                       -- allow any MIME; tighten later if needed
)
ON CONFLICT (id) DO NOTHING;


-- ── 2. RLS policies on storage.objects for the bucket ────────
-- Helper: extract workspace_id from the path (first segment).
-- e.g. '6f2a..-aaaa../9e0b..-bbbb../uuid-myfile.docx' → '6f2a..-aaaa..'

-- Drop old policies if re-running this migration
DROP POLICY IF EXISTS "task_files_select" ON storage.objects;
DROP POLICY IF EXISTS "task_files_insert" ON storage.objects;
DROP POLICY IF EXISTS "task_files_delete" ON storage.objects;

-- READ: any member of the workspace whose id is in the path's first segment.
CREATE POLICY "task_files_select"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'task-files'
    AND public.has_role(
      ((string_to_array(name, '/'))[1])::uuid,
      ARRAY['owner','admin','marketing','sales','key_account','member']
    )
  );

-- WRITE: same — any workspace member can upload.
CREATE POLICY "task_files_insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'task-files'
    AND public.has_role(
      ((string_to_array(name, '/'))[1])::uuid,
      ARRAY['owner','admin','marketing','sales','key_account','member']
    )
  );

-- DELETE: only the original uploader OR a privileged role.
-- We check uploader via the `task_attachments` row (file_url contains the path).
CREATE POLICY "task_files_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'task-files'
    AND (
      -- Privileged roles can delete any file in their workspace
      public.has_role(
        ((string_to_array(name, '/'))[1])::uuid,
        ARRAY['owner','admin','marketing']
      )
      -- OR uploader can delete their own
      OR EXISTS (
        SELECT 1 FROM public.task_attachments ta
        WHERE ta.file_url LIKE '%' || storage.objects.name
          AND ta.uploader_id = auth.uid()
      )
    )
  );


-- ── 3. Verification ──────────────────────────────────────────
-- After running, confirm with:
--   SELECT id, name, public FROM storage.buckets WHERE id = 'task-files';
--   SELECT polname FROM pg_policy WHERE polrelid = 'storage.objects'::regclass
--    AND polname LIKE 'task_files_%';
-- Expect 1 bucket row and 3 policy rows.
