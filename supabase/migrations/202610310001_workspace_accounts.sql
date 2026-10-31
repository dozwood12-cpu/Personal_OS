begin;
create table if not exists public.workspace_accounts (
 id uuid primary key default gen_random_uuid(),
 username text not null unique check(username ~ '^[a-z0-9_.-]{3,64}$'),
 password_hash text not null,
 credentials jsonb not null,
 project_url text not null unique,
 active boolean not null default true,
 session_version integer not null default 1,
 created_at timestamptz not null default now()
);
alter table public.workspace_accounts enable row level security;
revoke all on public.workspace_accounts from anon, authenticated;
grant all on public.workspace_accounts to service_role;
notify pgrst,'reload schema';
commit;
