-- =====================================================================
-- 003: fix "new row violates row-level security policy" on photo upload.
-- Supabase Storage reads the uploaded file's row back after saving it,
-- which needs a SELECT rule. Photos are public anyway (public bucket).
-- Safe to run more than once.
-- =====================================================================
drop policy if exists "avatar read" on storage.objects;
create policy "avatar read" on storage.objects for select to authenticated
  using (bucket_id = 'avatars');
