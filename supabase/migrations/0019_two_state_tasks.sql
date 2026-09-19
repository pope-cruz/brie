-- Existing in-progress work becomes an unchecked to-do. Keep the enum type so
-- existing RPC signatures remain stable, but reject its retired value at the
-- table boundary (including calls from older clients).
update public.tasks set status = 'todo' where status = 'in_progress';
alter table public.tasks add constraint tasks_two_state_status
  check (status in ('todo', 'done'));
