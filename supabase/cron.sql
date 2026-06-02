-- Schedule the Edge Functions with pg_cron + pg_net.
-- Run once in the Supabase SQL editor after deploying the functions.
-- Replace <PROJECT_REF> and <ANON_KEY> with your values.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Drain the review queue every minute.
select cron.schedule(
  'prpilot-process-reviews',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/process-reviews',
    headers := '{"Authorization": "Bearer <ANON_KEY>", "Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);

-- Keep the project warm twice a day.
select cron.schedule(
  'prpilot-keep-alive',
  '0 */12 * * *',
  $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/keep-alive',
    headers := '{"Authorization": "Bearer <ANON_KEY>", "Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);

-- To remove later: select cron.unschedule('prpilot-process-reviews');
