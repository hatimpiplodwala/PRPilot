-- Schedule the background queue drain with pg_cron + pg_net.
-- Run once in the Supabase SQL editor (replace <APP_URL> and <CRON_SECRET>).
--
-- This calls the deployed Next.js processor route directly, so you do NOT need
-- to deploy any Edge Functions or install the Supabase CLI.
--
--   <APP_URL>      e.g. https://pr-pilot-nine.vercel.app   (no trailing slash)
--   <CRON_SECRET>  the same value as the app's CRON_SECRET env var

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Drain the review queue every minute.
select cron.schedule(
  'prpilot-process-reviews',
  '* * * * *',
  $$
  select net.http_post(
    url := '<APP_URL>/api/internal/process',
    headers := '{"Authorization": "Bearer <CRON_SECRET>", "Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);

-- Keep the free project warm so it does not pause after ~1 week idle.
-- (The cron activity itself keeps the database active; a trivial query is enough.)
select cron.schedule(
  'prpilot-keep-alive',
  '0 */12 * * *',
  $$ select 1; $$
);

-- Garbage-collect old rate-limit buckets. Each (subject, hour) bucket lives
-- forever otherwise — over months the table accumulates rows that no live
-- window will ever read. 7 days is plenty for any forensics.
select cron.schedule(
  'prpilot-cleanup-rate-limits',
  '17 4 * * *',
  $$ delete from rate_limits where window_start < now() - interval '7 days'; $$
);

-- Garbage-collect old webhook delivery records. We only need recent rows to
-- catch the realistic re-delivery window (GitHub retries a webhook for up to
-- a few hours); 30 days gives a comfortable audit trail without unbounded growth.
select cron.schedule(
  'prpilot-cleanup-webhook-deliveries',
  '23 4 * * *',
  $$ delete from webhook_deliveries where received_at < now() - interval '30 days'; $$
);

-- To remove later:
--   select cron.unschedule('prpilot-process-reviews');
--   select cron.unschedule('prpilot-keep-alive');
--   select cron.unschedule('prpilot-cleanup-rate-limits');
--   select cron.unschedule('prpilot-cleanup-webhook-deliveries');
