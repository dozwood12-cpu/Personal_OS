begin;
-- Single-owner workspace. Server API exclusively accesses tables and private storage.
create table if not exists public.categories (
 id uuid primary key default gen_random_uuid(),
 name text not null check (length(trim(name)) between 1 and 80),
 kind text not null check (kind in ('income','expense','status','document')),
 unique(name,kind)
);
create table if not exists public.transactions (
 id uuid primary key default gen_random_uuid(),
 title text not null check (length(trim(title)) between 1 and 200),
 amount numeric(16,2) not null check(amount > 0),
 category_id uuid not null references public.categories(id) on delete restrict,
 date date not null default current_date,
 created_at timestamptz not null default now()
);
create table if not exists public.projects (
 id uuid primary key default gen_random_uuid(),
 title text not null check (length(trim(title)) between 1 and 200),
 status_id uuid not null references public.categories(id) on delete restrict,
 progress integer not null default 0 check(progress between 0 and 100),
 deadline date not null,
 is_mwb boolean not null default false,
 created_at timestamptz not null default now()
);
create table if not exists public.documents (
 id uuid primary key default gen_random_uuid(),
 title text not null,
 category_id uuid not null references public.categories(id) on delete restrict,
 path text unique not null,
 size bigint not null,
 created_at timestamptz not null default now()
);
create index if not exists transactions_date_idx on public.transactions(date);
create index if not exists projects_deadline_idx on public.projects(deadline);
alter table public.categories enable row level security;
alter table public.transactions enable row level security;
alter table public.projects enable row level security;
alter table public.documents enable row level security;
-- No anon/authenticated policies: credentials and service-role stay server-only.
insert into public.categories(name,kind) values
 ('Gaji','income'),('Freelance','income'),('Makanan','expense'),('Transportasi','expense'),
 ('Belum dimulai','status'),('Berjalan','status'),('Selesai','status'),
 ('Sertifikasi','document'),('Pembelajaran','document') on conflict(name,kind) do nothing;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values ('vault','vault',false,10485760,array['application/pdf','image/jpeg','image/png','text/plain']) on conflict(id) do nothing;
create table if not exists public.theme_presets(id uuid primary key default gen_random_uuid(),name text not null check(length(name) between 1 and 80),is_active boolean not null default false,created_at timestamptz not null default now());
create unique index if not exists one_active_theme on public.theme_presets(is_active) where is_active;
create table if not exists public.personalization(
 id uuid primary key default gen_random_uuid(),preset uuid not null references public.theme_presets(id) on delete cascade,
 slot text not null check(slot in ('login','dashboard','journal','projects','documents','avatar','sidebar')),
 sort_order int not null check(sort_order between 0 and 4),path text not null,
 overlay real not null default .5 check(overlay between 0 and .95),blur real not null default 0 check(blur between 0 and 20),
 x real not null default 50 check(x between 0 and 100),y real not null default 50 check(y between 0 and 100),zoom real not null default 1 check(zoom between 1 and 2.5),
 opacity real not null default 1 check(opacity between 0 and 1),animation text not null default 'none' check(animation in ('none','kenburns','crossfade','parallax','drift','glow','entrance')),
 speed real not null default 8 check(speed between 3 and 30),intensity real not null default .3 check(intensity between 0 and 1),is_active boolean not null default false,
 unique(preset,slot,sort_order)
);
alter table public.theme_presets enable row level security;
alter table public.personalization enable row level security;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('personalize','personalize',false,5242880,array['image/webp','image/jpeg','image/png']) on conflict(id) do nothing;
create or replace function public.save_theme(p_id uuid,p_name text,p_theme jsonb,p_activate boolean default false) returns uuid language plpgsql as $$
declare v_id uuid;v_active boolean;v_slot text;v_config jsonb;v_image jsonb;v_n int;
begin
 perform pg_advisory_xact_lock(hashtext('orbit-themes'));
 if p_id is null then insert into public.theme_presets(name) values(p_name) returning id into v_id;
 else update public.theme_presets set name=p_name where id=p_id returning id into v_id; if v_id is null then raise exception 'Preset tidak ditemukan'; end if;end if;
 select is_active into v_active from public.theme_presets where id=v_id;
 delete from public.personalization where preset=v_id;
 for v_slot,v_config in select key,value from jsonb_each(p_theme) loop
 v_n:=0;
 for v_image in select value from jsonb_array_elements(v_config->'images') loop
 insert into public.personalization(preset,slot,sort_order,path,overlay,blur,x,y,zoom,opacity,animation,speed,intensity,is_active)
 values(v_id,v_slot,v_n,v_image->>'path',(v_config->>'overlay')::real,(v_config->>'blur')::real,(v_config->>'x')::real,(v_config->>'y')::real,(v_config->>'zoom')::real,(v_config->>'opacity')::real,v_config->>'animation',(v_config->>'speed')::real,(v_config->>'intensity')::real,v_active);v_n:=v_n+1;
 end loop;end loop;
 if p_activate then perform public.activate_theme(v_id);end if;
 return v_id;
end $$;
create or replace function public.activate_theme(p_id uuid) returns void language plpgsql as $$
begin
 perform pg_advisory_xact_lock(hashtext('orbit-themes'));
 if p_id is not null and not exists(select 1 from public.theme_presets where id=p_id) then raise exception 'Preset tidak ditemukan';end if;
 update public.theme_presets set is_active=false where is_active;
 update public.personalization set is_active=false where is_active;
 update public.theme_presets set is_active=true where id=p_id;
 update public.personalization set is_active=true where preset=p_id;
end $$;
revoke all on function public.save_theme(uuid,text,jsonb,boolean),public.activate_theme(uuid) from public;
grant execute on function public.save_theme(uuid,text,jsonb,boolean),public.activate_theme(uuid) to service_role;
create table if not exists public.accounts(id uuid primary key default gen_random_uuid(),name text not null,kind text not null default 'cash' check(kind in ('cash','bank','ewallet')),opening_balance numeric(16,2) not null default 0,created_at timestamptz not null default now());
insert into public.accounts(id,name,kind) values('00000000-0000-4000-8000-000000000001','Akun utama','cash') on conflict(id) do nothing;
alter table public.transactions add column if not exists account_id uuid references public.accounts(id) on delete restrict;
update public.transactions set account_id='00000000-0000-4000-8000-000000000001' where account_id is null;
alter table public.transactions alter column account_id set default '00000000-0000-4000-8000-000000000001';
alter table public.transactions alter column account_id set not null;
alter table public.categories add column if not exists color text not null default '#a1a1aa';
alter table public.categories add column if not exists icon text not null default 'Tag';
alter table public.documents add column if not exists tags text[] not null default '{}';
alter table public.documents add column if not exists expires_on date;
alter table public.documents add column if not exists deletion_state text not null default 'active' check(deletion_state in ('active','pending'));
create table if not exists public.app_settings(key text primary key,value jsonb not null);
insert into public.app_settings(key,value) values('auto_complete','false'),('widgets','["summary","cashflow","deadlines","journal"]'),('mode','"dark"') on conflict(key) do nothing;
create table if not exists public.transfers(id uuid primary key default gen_random_uuid(),from_account uuid not null references public.accounts(id) on delete restrict,to_account uuid not null references public.accounts(id) on delete restrict,amount numeric(16,2) not null check(amount>0),date date not null,title text not null default 'Transfer',created_at timestamptz not null default now(),check(from_account<>to_account));
create table if not exists public.budgets(id uuid primary key default gen_random_uuid(),category_id uuid not null references public.categories(id) on delete restrict,month date not null check(extract(day from month)=1),amount numeric(16,2) not null check(amount>0),unique(category_id,month));
create table if not exists public.savings_goals(id uuid primary key default gen_random_uuid(),title text not null,target numeric(16,2) not null check(target>0),saved numeric(16,2) not null default 0 check(saved>=0),deadline date not null);
create table if not exists public.recurring_rules(id uuid primary key default gen_random_uuid(),title text not null,amount numeric(16,2) not null check(amount>0),category_id uuid not null references public.categories(id) on delete restrict,account_id uuid not null references public.accounts(id) on delete restrict,next_due date not null,frequency text not null check(frequency in ('daily','weekly','monthly','yearly')),anchor_day int not null default 1 check(anchor_day between 1 and 31),active boolean not null default true);
alter table public.transactions add column if not exists recurring_id uuid references public.recurring_rules(id) on delete set null;
create unique index if not exists recurring_occurrence_unique on public.transactions(recurring_id,date) where recurring_id is not null;
create table if not exists public.mwbs(id uuid primary key default gen_random_uuid(),project_id uuid references public.projects(id) on delete set null,title text not null,deadline date not null,done boolean not null default false);
create table if not exists public.subtasks(id uuid primary key default gen_random_uuid(),mwb_id uuid not null references public.mwbs(id) on delete cascade,title text not null,done boolean not null default false);
create table if not exists public.focus_sessions(id uuid primary key default gen_random_uuid(),mwb_id uuid not null references public.mwbs(id) on delete cascade,started_at timestamptz not null default now(),ended_at timestamptz,seconds int not null default 0 check(seconds>=0),check(ended_at is null or ended_at>=started_at));
create unique index if not exists one_running_focus on public.focus_sessions((true)) where ended_at is null;
create table if not exists public.activity_log(id uuid primary key default gen_random_uuid(),entity text not null,action text not null,title text,created_at timestamptz not null default now());
create or replace function public.log_orbit_activity() returns trigger language plpgsql as $$
declare j jsonb;
begin
 j:=case when TG_OP='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 insert into public.activity_log(entity,action,title) values(TG_TABLE_NAME,TG_OP,coalesce(j->>'title',j->>'name',j->>'key',j->>'id'));
 return null;
end $$;
do $$ declare t text;begin foreach t in array array['accounts','transfers','budgets','savings_goals','recurring_rules','mwbs','subtasks','focus_sessions','app_settings','theme_presets','personalization','transactions','projects','categories','documents'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('drop trigger if exists orbit_activity on public.%I',t);
 execute format('create trigger orbit_activity after insert or update or delete on public.%I for each row execute function public.log_orbit_activity()',t);
end loop;end $$;
alter table public.activity_log enable row level security;
create index if not exists activity_created_idx on public.activity_log(created_at desc);
create or replace function public.sync_project_progress() returns trigger language plpgsql as $$
begin
 if coalesce((select value='true'::jsonb from public.app_settings where key='auto_complete'),false) and exists(select 1 from public.categories where id=new.status_id and lower(trim(name))='selesai') then new.progress:=100;end if;
 return new;
end $$;
drop trigger if exists sync_progress on public.projects;
create trigger sync_progress before insert or update on public.projects for each row execute function public.sync_project_progress();
-- Preserve original MWB project markers; backfill separate MWB entities once.
alter table public.mwbs add column if not exists legacy_project_id uuid unique references public.projects(id) on delete set null;
insert into public.mwbs(project_id,legacy_project_id,title,deadline,done) select id,id,title,deadline,progress=100 from public.projects where is_mwb on conflict(legacy_project_id) do nothing;
create or replace function public.move_category(p_from uuid,p_to uuid) returns void language plpgsql as $$
declare k text;
begin
 if p_from=p_to then raise exception 'Kategori asal dan tujuan harus berbeda';end if;
 select kind into k from public.categories where id=p_from for update;
 if k is null or not exists(select 1 from public.categories where id=p_to and kind=k) then raise exception 'Jenis kategori harus sama';end if;
 update public.transactions set category_id=p_to where category_id=p_from;
 update public.projects set status_id=p_to where status_id=p_from;
 update public.documents set category_id=p_to where category_id=p_from;
 update public.recurring_rules set category_id=p_to where category_id=p_from;
 insert into public.budgets(category_id,month,amount) select p_to,month,amount from public.budgets where category_id=p_from on conflict(category_id,month) do update set amount=public.budgets.amount+excluded.amount;
 delete from public.budgets where category_id=p_from;
 delete from public.categories where id=p_from;
end $$;
create or replace function public.run_recurring(p_today date) returns int language plpgsql as $$
declare r public.recurring_rules;v_count int:=0;v_n int;v_base date;
begin
 for r in select * from public.recurring_rules where active and next_due<=p_today for update loop
 v_n:=0;
 while r.next_due<=p_today and v_n<240 loop
 insert into public.transactions(title,amount,category_id,account_id,date,recurring_id) values(r.title,r.amount,r.category_id,r.account_id,r.next_due,r.id) on conflict(recurring_id,date) where recurring_id is not null do nothing;
 if found then v_count:=v_count+1;end if;
 if r.frequency='daily' then r.next_due:=r.next_due+1;
 elsif r.frequency='weekly' then r.next_due:=r.next_due+7;
 else
 v_base:=case when r.frequency='yearly' then (date_trunc('month',r.next_due)+interval '1 year')::date else (date_trunc('month',r.next_due)+interval '1 month')::date end;
 r.next_due:=v_base+(least(r.anchor_day,extract(day from (v_base+interval '1 month - 1 day'))::int)-1);
 end if;v_n:=v_n+1;
 end loop;
 update public.recurring_rules set next_due=r.next_due where id=r.id;
 end loop;return v_count;
end $$;
create or replace function public.import_transactions(p_rows jsonb) returns jsonb language plpgsql as $$
declare r jsonb;v_inserted int:=0;v_skipped int:=0;
begin
 perform pg_advisory_xact_lock(hashtext('orbit-bank-import'));
 for r in select value from jsonb_array_elements(p_rows) loop
 if not exists(select 1 from public.categories where id=(r->>'category_id')::uuid and kind in ('income','expense')) then raise exception 'Kategori keuangan tidak valid';end if;
 if exists(select 1 from public.transactions where account_id=(r->>'account_id')::uuid and category_id=(r->>'category_id')::uuid and date=(r->>'date')::date and amount=(r->>'amount')::numeric and lower(trim(title))=lower(trim(r->>'title'))) then v_skipped:=v_skipped+1;
 else insert into public.transactions(title,amount,category_id,account_id,date) values(r->>'title',(r->>'amount')::numeric,(r->>'category_id')::uuid,(r->>'account_id')::uuid,(r->>'date')::date);v_inserted:=v_inserted+1;end if;
 end loop;return jsonb_build_object('inserted',v_inserted,'skipped',v_skipped);
end $$;
create or replace function public.stop_focus(p_id uuid) returns void language plpgsql as $$
begin update public.focus_sessions set ended_at=now(),seconds=greatest(0,extract(epoch from now()-started_at)::int) where id=p_id and ended_at is null;end $$;
revoke all on function public.move_category(uuid,uuid),public.run_recurring(date),public.import_transactions(jsonb),public.stop_focus(uuid) from public;
grant execute on function public.move_category(uuid,uuid),public.run_recurring(date),public.import_transactions(jsonb),public.stop_focus(uuid) to service_role;
update storage.buckets set allowed_mime_types=array['application/pdf','image/jpeg','image/png','text/plain','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'] where id='vault';
create or replace function public.ensure_project_mwb() returns trigger language plpgsql as $$
begin
 if new.is_mwb then
 insert into public.mwbs(project_id,legacy_project_id,title,deadline,done) values(new.id,new.id,new.title,new.deadline,new.progress=100) on conflict(legacy_project_id) do nothing;
 end if;
 return null;
end $$;
drop trigger if exists ensure_mwb on public.projects;
create trigger ensure_mwb after insert or update of is_mwb on public.projects for each row execute function public.ensure_project_mwb();
create table if not exists public.orbit_migrations(version text primary key,applied_at timestamptz not null default now());
alter table public.orbit_migrations enable row level security;
insert into public.orbit_migrations(version) values('202610290001') on conflict do nothing;
commit;
