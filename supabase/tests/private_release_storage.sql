-- The official Mac artifact is private and available only through the
-- authenticated server route that mints a short-lived signed URL.

begin;
set local role postgres;
set local search_path = public, extensions;
create extension if not exists pgtap;
select plan(6);

select has_table('storage', 'buckets', 'Supabase Storage bucket registry exists');

select is(
  (select count(*)::integer from storage.buckets where id = 'weekform-releases'),
  1,
  'the Weekform release bucket exists exactly once'
);

select is(
  (select public from storage.buckets where id = 'weekform-releases'),
  false,
  'the release bucket is private'
);

select is(
  (select file_size_limit from storage.buckets where id = 'weekform-releases'),
  52428800::bigint,
  'release artifacts are capped at 50 MiB'
);

select is(
  (select allowed_mime_types from storage.buckets where id = 'weekform-releases'),
  array['application/x-apple-diskimage', 'application/octet-stream']::text[],
  'the bucket accepts only DMG-compatible content types'
);

select is(
  (
    select count(*)::integer
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and (
        coalesce(qual, '') like '%weekform-releases%'
        or coalesce(with_check, '') like '%weekform-releases%'
      )
  ),
  0,
  'no browser role has a direct release-object policy'
);

select * from finish();
rollback;
