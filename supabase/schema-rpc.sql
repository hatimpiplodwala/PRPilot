-- Atomic rate-limit increment. Run after schema.sql.
-- Inserts the (subject, window_start) bucket if missing, otherwise increments,
-- and returns the new count — all in a single statement (no race).

create or replace function increment_rate_limit(p_subject text, p_window_start timestamptz)
returns integer as $$
  insert into rate_limits (subject, window_start, count)
  values (p_subject, p_window_start, 1)
  on conflict (subject, window_start)
  do update set count = rate_limits.count + 1
  returning count;
$$ language sql;

-- Atomically claim up to p_limit queued jobs (queued -> running) and return them.
-- FOR UPDATE SKIP LOCKED ensures concurrent processor runs never grab the same row.
create or replace function claim_review_jobs(p_limit integer)
returns setof review_jobs as $$
  update review_jobs
  set status = 'running'
  where id in (
    select id from review_jobs
    where status = 'queued'
    order by created_at
    limit p_limit
    for update skip locked
  )
  returning *;
$$ language sql;
