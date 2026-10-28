-- Single-owner workspace. Server API exclusively accesses tables and private storage.
create table public.categories (
 id uuid primary key default gen_random_uuid(),
 name text not null check (length(trim(name)) between 1 and 80),
 kind text not null check (kind in ('income','expense','status','document')),
 unique(name,kind)
);
create table public.transactions (
 id uuid primary key default gen_random_uuid(),
 title text not null check (length(trim(title)) between 1 and 200),
 amount numeric(16,2) not null check(amount > 0),
 category_id uuid not null references public.categories(id) on delete restrict,
 date date not null default current_date,
 created_at timestamptz not null default now()
);
create table public.projects (
 id uuid primary key default gen_random_uuid(),
 title text not null check (length(trim(title)) between 1 and 200),
 status_id uuid not null references public.categories(id) on delete restrict,
 progress integer not null default 0 check(progress between 0 and 100),
 deadline date not null,
 is_mwb boolean not null default false,
 created_at timestamptz not null default now()
);
create table public.documents (
 id uuid primary key default gen_random_uuid(),
 title text not null,
 category_id uuid not null references public.categories(id) on delete restrict,
 path text unique not null,
 size bigint not null,
 created_at timestamptz not null default now()
);
create index on public.transactions(date);
create index on public.projects(deadline);
alter table public.categories enable row level security;
alter table public.transactions enable row level security;
alter table public.projects enable row level security;
alter table public.documents enable row level security;
-- No anon/authenticated policies: credentials and service-role stay server-only.
insert into public.categories(name,kind) values
 ('Gaji','income'),('Freelance','income'),('Makanan','expense'),('Transportasi','expense'),
 ('Belum dimulai','status'),('Berjalan','status'),('Selesai','status'),
 ('Sertifikasi','document'),('Pembelajaran','document');
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values ('vault','vault',false,10485760,array['application/pdf','image/jpeg','image/png','text/plain']);
