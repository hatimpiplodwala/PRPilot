-- pg_cron schedules for PRPilot's Supabase project.
--
-- The per-minute review-queue drain now runs on AWS Lambda, triggered by an
-- EventBridge rule (see Dockerfile.worker and worker/handler.ts). pg_cron only
-- handles keep-alive + cleanup below. The manual "Review now" path still kicks
-- the Vercel /api/internal/process route directly.

create extension if not exists pg_cron;

-- If this database was provisioned before the worker moved to AWS, drop the old
-- per-minute pg_cron drain. Idempotent — no error if it was never scheduled.
do $$
begin
  perform cron.unschedule('prpilot-process-reviews');
exception when others then
  null;
end $$;

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
