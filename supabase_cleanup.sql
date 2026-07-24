-- Push Lab Pessoal - limpeza manual consciente
-- Remove apenas objetos criados por este projeto. Execute somente se deseja desinstalar.
-- Nao remove extensoes compartilhadas como pgcrypto, pg_net, pg_cron ou supabase_vault.

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    begin
      execute 'select cron.unschedule(jobid) from cron.job where jobname in (''push-lab-process-scheduled-every-minute'', ''push-lab-cleanup-daily'')';
    exception when others then
      raise notice 'Falha ao remover jobs cron do Push Lab: %', sqlerrm;
    end;
  end if;
end $$;

drop function if exists public.push_lab_cleanup_old_data(timestamptz, interval, interval, interval);
drop function if exists public.push_lab_claim_due_notifications(timestamptz, integer, uuid);
drop function if exists public.push_lab_recover_stuck_notifications(timestamptz, interval);
drop function if exists public.push_lab_check_rate_limit(text, text, integer, integer);
drop function if exists public.push_lab_set_updated_at();

drop table if exists public.device_events;
drop table if exists public.notification_deliveries;
drop table if exists public.notifications;
drop table if exists public.push_subscriptions;
drop table if exists public.devices;
drop table if exists public.rate_limits;

drop type if exists public.device_event_type;
drop type if exists public.delivery_status;
drop type if exists public.notification_status;
drop type if exists public.delivery_type;
drop type if exists public.push_subscription_status;
drop type if exists public.permission_status;
drop type if exists public.device_status;

