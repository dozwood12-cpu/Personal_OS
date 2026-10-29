-- Optional dates preserve existing subtasks; each dated subtask appears in the calendar.
begin;
alter table public.subtasks add column if not exists deadline date;
create index if not exists subtasks_deadline_idx on public.subtasks(deadline) where deadline is not null;
notify pgrst, 'reload schema';
commit;
