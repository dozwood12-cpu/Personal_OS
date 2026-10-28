-- Optional demo dataset in its own schema; never inserts into production public tables.
begin;
create schema if not exists orbit_demo;
create table if not exists orbit_demo.accounts(id uuid primary key default gen_random_uuid(),name text,opening_balance numeric);
create table if not exists orbit_demo.transactions(id uuid primary key default gen_random_uuid(),title text,kind text,amount numeric,date date);
insert into orbit_demo.accounts(name,opening_balance) select 'Demo kas',1000000 where not exists(select 1 from orbit_demo.accounts);
insert into orbit_demo.transactions(title,kind,amount,date) select 'Demo pemasukan','income',5000000,current_date where not exists(select 1 from orbit_demo.transactions);
revoke all on schema orbit_demo from public,anon,authenticated;
commit;
