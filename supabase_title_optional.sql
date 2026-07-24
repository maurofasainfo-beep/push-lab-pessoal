-- Push Lab Pessoal / Avisos Pessoais
-- Atualizacao incremental: permite notificacoes sem titulo.
-- Execute no SQL Editor se voce ja executou o supabase_schema.sql antigo.

begin;

alter table public.notifications
  alter column title set default '';

update public.notifications
   set title = ''
 where title is null;

alter table public.notifications
  alter column title set not null;

alter table public.notifications
  drop constraint if exists notifications_title_check;

alter table public.notifications
  drop constraint if exists notifications_title_length_check;

alter table public.notifications
  add constraint notifications_title_length_check
  check (char_length(title) <= 120);

commit;

