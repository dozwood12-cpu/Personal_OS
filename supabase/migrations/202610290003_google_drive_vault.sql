begin;
alter table public.documents add column if not exists storage_provider text not null default 'supabase' check(storage_provider in ('supabase','gdrive'));
alter table public.documents add column if not exists drive_file_id text;
alter table public.documents add column if not exists mime_type text;
create unique index if not exists documents_drive_file_id_idx on public.documents(drive_file_id) where drive_file_id is not null;
create table if not exists public.storage_connections (
 provider text primary key check(provider='gdrive'),account_email text not null,
 folder_id text,folder_name text,token_encrypted text not null,iv text not null,tag text not null,
 scope text not null,status text not null default 'connected' check(status in ('connected','reconnect')),
 connected_at timestamptz not null default now(),last_synced_at timestamptz
);
create table if not exists public.storage_oauth_states(state_hash text primary key,expires_at timestamptz not null);
create table if not exists public.vault_uploads (
 id uuid primary key default gen_random_uuid(),provider text not null check(provider in ('supabase','gdrive')),
 name text not null,mime_type text not null,size bigint not null check(size>0),category_id uuid references public.categories(id) on delete set null,
 path text not null unique,drive_file_id text,folder_id text,session_url text,
 completed_document_id uuid references public.documents(id) on delete set null,
 created_at timestamptz not null default now(),expires_at timestamptz not null default now()+interval '7 days'
);
create table if not exists public.storage_sync_reports (
 id uuid primary key default gen_random_uuid(),folder_id text not null,report jsonb not null,
 created_at timestamptz not null default now(),expires_at timestamptz not null default now()+interval '1 hour'
);
create table if not exists public.storage_migrations (
 document_id uuid primary key references public.documents(id) on delete cascade,source_path text not null,
 drive_file_id text,folder_id text,session_url text,size bigint,
 status text not null default 'queued' check(status in ('queued','copying','cleanup','done','error')),
 lease_until timestamptz,last_error text,updated_at timestamptz not null default now()
);
alter table public.storage_connections enable row level security;
alter table public.storage_oauth_states enable row level security;
alter table public.vault_uploads enable row level security;
alter table public.storage_sync_reports enable row level security;
alter table public.storage_migrations enable row level security;
revoke all on public.storage_connections,public.storage_oauth_states,public.vault_uploads,public.storage_sync_reports,public.storage_migrations from anon,authenticated;
grant all on public.storage_connections,public.storage_oauth_states,public.vault_uploads,public.storage_sync_reports,public.storage_migrations to service_role;
create or replace function public.claim_vault_migration() returns setof public.storage_migrations language plpgsql security definer set search_path=public as $$
declare chosen uuid;
begin
 insert into storage_migrations(document_id,source_path)
 select id,path from documents where storage_provider='supabase' and deletion_state='active'
 on conflict(document_id) do nothing;
 select m.document_id into chosen from storage_migrations m join documents d on d.id=m.document_id
 where m.status<>'done' and d.deletion_state='active' and (m.lease_until is null or m.lease_until<now())
 order by case when m.status='cleanup' then 0 else 1 end,m.document_id limit 1 for update of m skip locked;
 if chosen is null then return;end if;
 return query update storage_migrations set lease_until=now()+interval '5 minutes',updated_at=now() where document_id=chosen returning *;
end $$;
revoke all on function public.claim_vault_migration() from public,anon,authenticated;
grant execute on function public.claim_vault_migration() to service_role;
-- Never replace the user's selected provider when replaying the migration.
insert into public.app_settings(key,value) values('vault_storage','{"default_provider":"supabase","max_upload_mb":100}') on conflict(key) do nothing;
update storage.buckets set file_size_limit=104857600 where id='vault' and file_size_limit=10485760 and exists(select 1 from public.app_settings where key='vault_storage' and value->>'max_upload_mb'='100');
notify pgrst,'reload schema';
commit;
