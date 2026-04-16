-- Create private storage bucket for scan and heatmap images.
insert into storage.buckets (id, name, public)
values ('scans', 'scans', false)
on conflict (id) do nothing;

-- Allow authenticated users to read only files in their own folder.
create policy scans_bucket_select_own
on storage.objects
for select
using (
  bucket_id = 'scans'
  and (
    auth.role() = 'service_role'
    or (storage.foldername(name))[1] = auth.uid()::text
  )
);

-- Allow service role to write all scan files.
create policy scans_bucket_insert_service_role
on storage.objects
for insert
with check (
  bucket_id = 'scans'
  and auth.role() = 'service_role'
);

create policy scans_bucket_update_service_role
on storage.objects
for update
using (
  bucket_id = 'scans'
  and auth.role() = 'service_role'
)
with check (
  bucket_id = 'scans'
  and auth.role() = 'service_role'
);

create policy scans_bucket_delete_service_role
on storage.objects
for delete
using (
  bucket_id = 'scans'
  and auth.role() = 'service_role'
);
