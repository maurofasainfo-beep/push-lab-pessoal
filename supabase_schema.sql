-- Push Lab Pessoal - schema Supabase autocontido
-- Execute no SQL Editor do Supabase uma vez.
-- Nao contem VAPID private key, service role key nem INTERNAL_CRON_SECRET.
-- Observacao: extensoes pg_cron, pg_net e Vault dependem da disponibilidade do projeto/plano.

create schema if not exists extensions;

create extension if not exists pgcrypto with schema extensions;

do $$
begin
  begin
    execute 'create extension if not exists pg_net with schema extensions';
  exception when others then
    raise notice 'pg_net nao foi habilitado automaticamente: %', sqlerrm;
  end;

  begin
    execute 'create extension if not exists pg_cron';
  exception when others then
    raise notice 'pg_cron nao foi habilitado automaticamente: %', sqlerrm;
  end;

  begin
    execute 'create schema if not exists vault';
    execute 'create extension if not exists supabase_vault with schema vault';
  exception when others then
    raise notice 'Supabase Vault nao foi habilitado automaticamente: %', sqlerrm;
  end;
end $$;

do $$
begin
  create type public.device_status as enum ('active', 'revoked');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.permission_status as enum ('default', 'granted', 'denied');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.push_subscription_status as enum ('active', 'expired', 'revoked', 'failed');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.delivery_type as enum ('immediate', 'scheduled');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.notification_status as enum ('draft', 'scheduled', 'processing', 'sent', 'partially_failed', 'failed', 'cancelled');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.delivery_status as enum ('processing', 'sent', 'retry_scheduled', 'permanent_failed', 'failed', 'unknown');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.device_event_type as enum (
    'installation',
    'permission_granted',
    'permission_denied',
    'subscription_created',
    'subscription_updated',
    'subscription_removed',
    'test_sent',
    'device_revoked'
  );
exception when duplicate_object then null;
end $$;

create table if not exists public.devices (
  id uuid primary key default extensions.gen_random_uuid(),
  public_id text not null unique default ('dev_' || replace(extensions.gen_random_uuid()::text, '-', '')),
  secret_hash text not null check (secret_hash ~ '^[a-f0-9]{64}$'),
  name text not null check (char_length(name) between 1 and 80),
  timezone text not null check (char_length(timezone) between 1 and 80),
  locale text not null check (char_length(locale) between 2 and 35),
  user_agent text null check (user_agent is null or char_length(user_agent) <= 500),
  app_version text not null check (char_length(app_version) between 1 and 40),
  status public.device_status not null default 'active',
  notifications_permission public.permission_status not null default 'default',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz null,
  revoked_at timestamptz null,
  constraint devices_revoked_status_check check ((status = 'revoked') = (revoked_at is not null))
);

comment on table public.devices is 'Instalacoes anonimas do PWA. secret_hash e hash SHA-256 do segredo local; o segredo puro nunca deve ser armazenado.';

create table if not exists public.push_subscriptions (
  id uuid primary key default extensions.gen_random_uuid(),
  device_id uuid not null references public.devices(id) on delete cascade,
  endpoint text not null check (char_length(endpoint) <= 2048),
  endpoint_hash text not null unique check (endpoint_hash ~ '^[a-f0-9]{64}$'),
  p256dh text not null check (char_length(p256dh) between 20 and 500),
  auth text not null check (char_length(auth) between 10 and 200),
  status public.push_subscription_status not null default 'active',
  failure_count integer not null default 0 check (failure_count >= 0),
  last_success_at timestamptz null,
  last_failure_at timestamptz null,
  expires_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz null
);

comment on table public.push_subscriptions is 'Assinaturas Web Push. endpoint, p256dh e auth sao tratados como sensiveis e nao devem ser expostos ao frontend.';

create table if not exists public.notifications (
  id uuid primary key default extensions.gen_random_uuid(),
  device_id uuid not null references public.devices(id) on delete cascade,
  title text not null default '' check (char_length(title) <= 120),
  body text not null check (char_length(body) between 1 and 600),
  image_url text null check (image_url is null or (char_length(image_url) <= 1000 and image_url ~* '^https://')),
  icon_url text null check (icon_url is null or (char_length(icon_url) <= 1000 and icon_url ~* '^https://')),
  badge_url text null check (badge_url is null or (char_length(badge_url) <= 1000 and badge_url ~* '^https://')),
  target_url text null check (
    target_url is null
    or (
      char_length(target_url) <= 1000
      and (
        (target_url like '/%' and target_url not like '//%')
        or target_url ~* '^https?://'
      )
    )
  ),
  tag text null check (tag is null or char_length(tag) <= 80),
  custom_data jsonb not null default '{}'::jsonb check (jsonb_typeof(custom_data) = 'object' and pg_column_size(custom_data) <= 4096),
  delivery_type public.delivery_type not null,
  scheduled_at timestamptz not null,
  status public.notification_status not null default 'draft',
  idempotency_key uuid not null default extensions.gen_random_uuid(),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 3 check (max_attempts between 1 and 5),
  processing_started_at timestamptz null,
  next_retry_at timestamptz null,
  last_error_code text null check (last_error_code is null or char_length(last_error_code) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  cancelled_at timestamptz null,
  sent_at timestamptz null,
  constraint notifications_schedule_status_check check (
    (status <> 'cancelled' or cancelled_at is not null)
    and (status <> 'sent' or sent_at is not null)
  ),
  constraint notifications_idempotency_unique unique (idempotency_key)
);

comment on table public.notifications is 'Notificacoes criadas pelo dispositivo. scheduled_at e timestamptz e deve ser gravado em UTC pela API.';

create table if not exists public.notification_deliveries (
  id uuid primary key default extensions.gen_random_uuid(),
  notification_id uuid not null references public.notifications(id) on delete cascade,
  push_subscription_id uuid null references public.push_subscriptions(id) on delete set null,
  attempt_number integer not null check (attempt_number >= 1),
  status public.delivery_status not null,
  provider_status_code integer null check (provider_status_code is null or provider_status_code between 100 and 599),
  error_code text null check (error_code is null or char_length(error_code) <= 120),
  error_message text null check (error_message is null or char_length(error_message) <= 500),
  attempted_at timestamptz not null default now(),
  delivered_at timestamptz null,
  next_retry_at timestamptz null,
  created_at timestamptz not null default now(),
  constraint notification_deliveries_unique_attempt unique (notification_id, push_subscription_id, attempt_number)
);

comment on table public.notification_deliveries is 'Tentativas de envio. delivered_at fica nulo porque Web Push confirma aceitacao pelo push service, nao entrega final ao usuario.';

create table if not exists public.device_events (
  id uuid primary key default extensions.gen_random_uuid(),
  device_id uuid null references public.devices(id) on delete cascade,
  event_type public.device_event_type not null,
  event_data jsonb not null default '{}'::jsonb check (jsonb_typeof(event_data) = 'object' and pg_column_size(event_data) <= 2048),
  created_at timestamptz not null default now()
);

create table if not exists public.rate_limits (
  id uuid primary key default extensions.gen_random_uuid(),
  key_hash text not null check (key_hash ~ '^[a-f0-9]{64}$'),
  action text not null check (char_length(action) between 1 and 80),
  bucket_start timestamptz not null,
  request_count integer not null default 1 check (request_count > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rate_limits_unique_bucket unique (key_hash, action, bucket_start)
);

create index if not exists devices_public_id_idx on public.devices (public_id);
create index if not exists devices_active_idx on public.devices (status, last_seen_at) where status = 'active';
create index if not exists push_subscriptions_device_active_idx on public.push_subscriptions (device_id, status) where status = 'active';
create index if not exists push_subscriptions_endpoint_hash_idx on public.push_subscriptions (endpoint_hash);
create index if not exists notifications_device_status_idx on public.notifications (device_id, status, scheduled_at desc);
create index if not exists notifications_due_idx on public.notifications (scheduled_at, status, next_retry_at) where status in ('scheduled', 'failed', 'partially_failed');
create index if not exists notifications_processing_idx on public.notifications (processing_started_at) where status = 'processing';
create index if not exists notification_deliveries_notification_idx on public.notification_deliveries (notification_id, attempted_at desc);
create index if not exists notification_deliveries_retry_idx on public.notification_deliveries (next_retry_at) where status = 'retry_scheduled';
create index if not exists device_events_device_idx on public.device_events (device_id, created_at desc);
create index if not exists rate_limits_cleanup_idx on public.rate_limits (bucket_start);

create or replace function public.push_lab_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists devices_set_updated_at on public.devices;
create trigger devices_set_updated_at
before update on public.devices
for each row execute function public.push_lab_set_updated_at();

drop trigger if exists push_subscriptions_set_updated_at on public.push_subscriptions;
create trigger push_subscriptions_set_updated_at
before update on public.push_subscriptions
for each row execute function public.push_lab_set_updated_at();

drop trigger if exists notifications_set_updated_at on public.notifications;
create trigger notifications_set_updated_at
before update on public.notifications
for each row execute function public.push_lab_set_updated_at();

drop trigger if exists rate_limits_set_updated_at on public.rate_limits;
create trigger rate_limits_set_updated_at
before update on public.rate_limits
for each row execute function public.push_lab_set_updated_at();

alter table public.devices enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.notifications enable row level security;
alter table public.notification_deliveries enable row level security;
alter table public.device_events enable row level security;
alter table public.rate_limits enable row level security;

revoke all on table public.devices from anon, authenticated;
revoke all on table public.push_subscriptions from anon, authenticated;
revoke all on table public.notifications from anon, authenticated;
revoke all on table public.notification_deliveries from anon, authenticated;
revoke all on table public.device_events from anon, authenticated;
revoke all on table public.rate_limits from anon, authenticated;

grant select, insert, update, delete on table public.devices to service_role;
grant select, insert, update, delete on table public.push_subscriptions to service_role;
grant select, insert, update, delete on table public.notifications to service_role;
grant select, insert, update, delete on table public.notification_deliveries to service_role;
grant select, insert, update, delete on table public.device_events to service_role;
grant select, insert, update, delete on table public.rate_limits to service_role;

drop policy if exists "deny anon devices" on public.devices;
create policy "deny anon devices" on public.devices for all to anon using (false) with check (false);
drop policy if exists "deny authenticated devices" on public.devices;
create policy "deny authenticated devices" on public.devices for all to authenticated using (false) with check (false);

drop policy if exists "deny anon push_subscriptions" on public.push_subscriptions;
create policy "deny anon push_subscriptions" on public.push_subscriptions for all to anon using (false) with check (false);
drop policy if exists "deny authenticated push_subscriptions" on public.push_subscriptions;
create policy "deny authenticated push_subscriptions" on public.push_subscriptions for all to authenticated using (false) with check (false);

drop policy if exists "deny anon notifications" on public.notifications;
create policy "deny anon notifications" on public.notifications for all to anon using (false) with check (false);
drop policy if exists "deny authenticated notifications" on public.notifications;
create policy "deny authenticated notifications" on public.notifications for all to authenticated using (false) with check (false);

drop policy if exists "deny anon notification_deliveries" on public.notification_deliveries;
create policy "deny anon notification_deliveries" on public.notification_deliveries for all to anon using (false) with check (false);
drop policy if exists "deny authenticated notification_deliveries" on public.notification_deliveries;
create policy "deny authenticated notification_deliveries" on public.notification_deliveries for all to authenticated using (false) with check (false);

drop policy if exists "deny anon device_events" on public.device_events;
create policy "deny anon device_events" on public.device_events for all to anon using (false) with check (false);
drop policy if exists "deny authenticated device_events" on public.device_events;
create policy "deny authenticated device_events" on public.device_events for all to authenticated using (false) with check (false);

drop policy if exists "deny anon rate_limits" on public.rate_limits;
create policy "deny anon rate_limits" on public.rate_limits for all to anon using (false) with check (false);
drop policy if exists "deny authenticated rate_limits" on public.rate_limits;
create policy "deny authenticated rate_limits" on public.rate_limits for all to authenticated using (false) with check (false);

create or replace function public.push_lab_check_rate_limit(
  p_key_hash text,
  p_action text,
  p_max_requests integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_bucket timestamptz;
  v_count integer;
begin
  if p_key_hash !~ '^[a-f0-9]{64}$' then
    return false;
  end if;

  v_bucket := to_timestamp(floor(extract(epoch from now()) / greatest(p_window_seconds, 1)) * greatest(p_window_seconds, 1));

  insert into public.rate_limits (key_hash, action, bucket_start, request_count)
  values (p_key_hash, p_action, v_bucket, 1)
  on conflict (key_hash, action, bucket_start)
  do update set request_count = public.rate_limits.request_count + 1, updated_at = now()
  returning request_count into v_count;

  return v_count <= p_max_requests;
end;
$$;

create or replace function public.push_lab_recover_stuck_notifications(
  p_now timestamptz default now(),
  p_timeout interval default interval '10 minutes'
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  update public.notifications
     set status = case
       when attempt_count >= max_attempts then 'failed'::public.notification_status
       else 'scheduled'::public.notification_status
     end,
     processing_started_at = null,
     next_retry_at = case
       when attempt_count >= max_attempts then null
       else p_now
     end,
     last_error_code = 'PROCESSING_TIMEOUT',
     updated_at = p_now
   where status = 'processing'
     and processing_started_at is not null
     and processing_started_at < p_now - p_timeout;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.push_lab_claim_due_notifications(
  p_now timestamptz default now(),
  p_limit integer default 10,
  p_notification_id uuid default null
)
returns setof public.notifications
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.push_lab_recover_stuck_notifications(p_now);

  return query
  with candidates as (
    select n.id
      from public.notifications n
      join public.devices d on d.id = n.device_id
     where d.status = 'active'
       and (p_notification_id is null or n.id = p_notification_id)
       and n.status in ('scheduled', 'failed', 'partially_failed')
       and n.cancelled_at is null
       and n.scheduled_at <= p_now
       and coalesce(n.next_retry_at, '-infinity'::timestamptz) <= p_now
       and n.attempt_count < n.max_attempts
     order by n.scheduled_at asc, n.created_at asc
     for update of n skip locked
     limit greatest(1, least(p_limit, 50))
  ),
  claimed as (
    update public.notifications n
       set status = 'processing',
           processing_started_at = p_now,
           attempt_count = attempt_count + 1,
           updated_at = p_now
      from candidates c
     where n.id = c.id
     returning n.*
  )
  select * from claimed;
end;
$$;

create or replace function public.push_lab_cleanup_old_data(
  p_now timestamptz default now(),
  p_delivery_retention interval default interval '90 days',
  p_notification_retention interval default interval '180 days',
  p_rate_limit_retention interval default interval '2 days'
)
returns table(deleted_deliveries integer, deleted_notifications integer, deleted_rate_limits integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.notification_deliveries
   where created_at < p_now - p_delivery_retention;
  get diagnostics deleted_deliveries = row_count;

  delete from public.notifications
   where created_at < p_now - p_notification_retention
     and status in ('sent', 'failed', 'cancelled');
  get diagnostics deleted_notifications = row_count;

  delete from public.rate_limits
   where bucket_start < p_now - p_rate_limit_retention;
  get diagnostics deleted_rate_limits = row_count;

  return next;
end;
$$;

revoke all on function public.push_lab_set_updated_at() from public, anon, authenticated;
revoke all on function public.push_lab_check_rate_limit(text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.push_lab_recover_stuck_notifications(timestamptz, interval) from public, anon, authenticated;
revoke all on function public.push_lab_claim_due_notifications(timestamptz, integer, uuid) from public, anon, authenticated;
revoke all on function public.push_lab_cleanup_old_data(timestamptz, interval, interval, interval) from public, anon, authenticated;

grant execute on function public.push_lab_check_rate_limit(text, text, integer, integer) to service_role;
grant execute on function public.push_lab_recover_stuck_notifications(timestamptz, interval) to service_role;
grant execute on function public.push_lab_claim_due_notifications(timestamptz, integer, uuid) to service_role;
grant execute on function public.push_lab_cleanup_old_data(timestamptz, interval, interval, interval) to service_role;

-- Configuracao segura do Cron com pg_cron + pg_net.
-- Antes de depender do job, crie os secrets no Vault do Supabase:
-- select vault.create_secret('https://SEU-PROJETO.supabase.co', 'push_lab_supabase_url');
-- select vault.create_secret('SUA_SUPABASE_ANON_KEY', 'push_lab_anon_key');
-- select vault.create_secret('SEU_INTERNAL_CRON_SECRET', 'push_lab_internal_cron_secret');
--
-- Se Vault/pg_cron/pg_net nao estiverem disponiveis, use a alternativa documentada:
-- um cron externo gratuito chamando POST /functions/v1/process-scheduled-notifications
-- com Authorization: Bearer INTERNAL_CRON_SECRET.

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron')
     and exists (select 1 from pg_namespace where nspname = 'net')
     and exists (select 1 from pg_namespace where nspname = 'vault') then
    begin
      execute 'select cron.unschedule(jobid) from cron.job where jobname in (''push-lab-process-scheduled-every-minute'', ''push-lab-cleanup-daily'')';
    exception when others then
      raise notice 'Nao foi possivel remover jobs antigos do Push Lab: %', sqlerrm;
    end;

    execute $schedule$
      select cron.schedule(
        'push-lab-process-scheduled-every-minute',
        '* * * * *',
        $job$
          select net.http_post(
            url := (select decrypted_secret from vault.decrypted_secrets where name = 'push_lab_supabase_url') || '/functions/v1/process-scheduled-notifications',
            headers := jsonb_build_object(
              'Content-Type', 'application/json',
              'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'push_lab_internal_cron_secret'),
              'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'push_lab_anon_key')
            ),
            body := jsonb_build_object('source', 'pg_cron', 'job', 'process-scheduled-notifications', 'queued_at', now()),
            timeout_milliseconds := 25000
          );
        $job$
      )
    $schedule$;

    execute $schedule$
      select cron.schedule(
        'push-lab-cleanup-daily',
        '17 4 * * *',
        $job$
          select public.push_lab_cleanup_old_data();
        $job$
      )
    $schedule$;
  else
    raise notice 'Cron HTTP nao configurado automaticamente: verifique pg_cron, pg_net e Vault.';
  end if;
exception when others then
  raise notice 'Configuracao opcional do cron nao foi concluida: %', sqlerrm;
end $$;
