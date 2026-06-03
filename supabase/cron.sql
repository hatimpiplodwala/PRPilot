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

-- To remove later:
--   select cron.unschedule('prpilot-process-reviews');
--   select cron.unschedule('prpilot-keep-alive');
