-- Private storage for the exact Developer ID signed and notarized Mac release.
-- Browser roles receive no storage.objects policy; the authenticated download
-- route re-checks the user and uses its server-only service role solely to mint
-- a short-lived signed URL.

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
) values (
  'weekform-releases',
  'weekform-releases',
  false,
  52428800,
  array['application/x-apple-diskimage', 'application/octet-stream']::text[]
)
on conflict (id) do update
set name = excluded.name,
    public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types,
    updated_at = now();
