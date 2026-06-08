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

-- Record a GitHub webhook delivery if we haven't seen it before. Returns true
-- on first sight, false if it was already recorded. Used by the webhook route
-- to short-circuit duplicate deliveries.
create or replace function record_webhook_delivery(p_id text, p_event text)
returns boolean as $$
declare
  v_inserted integer;
begin
  insert into webhook_deliveries (id, event)
  values (p_id, p_event)
  on conflict (id) do nothing;
  get diagnostics v_inserted = row_count;
  return v_inserted > 0;
end;
$$ language plpgsql;

-- One-round-trip enqueue:
--   * Webhook trigger: insert if no row exists for (repo, pr, head_sha);
--     otherwise no-op and return existing.
--   * Manual trigger: same insert path; if a row exists AND it's finished
--     (done/failed), re-queue it in place (preserve comment_id so the processor
--     updates the existing comment instead of posting a duplicate).
--
-- Returns a jsonb object `{ job: {...review_jobs row...}, created: bool }`:
--   created=true  → a fresh row was inserted, OR an existing finished row was re-queued
--   created=false → no-op (webhook repeat, or a job already queued/running)
--
-- jsonb (rather than `RETURNS TABLE(job review_jobs, created boolean)`) so the
-- supabase-js / PostgREST representation is deterministic: a single jsonb
-- column deserializes to a nested JS object on every version. Composite-typed
-- RETURNS-TABLE columns can flatten or stringify depending on PostgREST
-- version, breaking the caller's `row.job.id` access pattern.
--
-- The retry loop handles the race where two callers insert concurrently; the
-- unique constraint on (repo, pr, head_sha) catches the loser, which then loops
-- to read the row that won.
create or replace function enqueue_review_job(
  p_installation_id bigint,
  p_repo_full_name text,
  p_pr_number     integer,
  p_head_sha      text,
  p_trigger       text
) returns jsonb as $$
declare
  v_row review_jobs;
begin
  loop
    select * into v_row from review_jobs r
      where r.repo_full_name = p_repo_full_name
        and r.pr_number      = p_pr_number
        and r.head_sha       = p_head_sha;

    if v_row.id is not null then
      if p_trigger = 'manual' and v_row.status in ('done', 'failed') then
        update review_jobs
        set status      = 'queued',
            trigger     = 'manual',
            result_json = null,
            error       = null
        where id = v_row.id
        returning * into v_row;
        return jsonb_build_object('job', to_jsonb(v_row), 'created', true);
      end if;
      return jsonb_build_object('job', to_jsonb(v_row), 'created', false);
    end if;

    begin
      insert into review_jobs (installation_id, repo_full_name, pr_number, head_sha, trigger, status)
      values (p_installation_id, p_repo_full_name, p_pr_number, p_head_sha, p_trigger, 'queued')
      returning * into v_row;
      return jsonb_build_object('job', to_jsonb(v_row), 'created', true);
    exception when unique_violation then
      -- Someone else inserted between our select and insert; loop and re-read.
    end;
  end loop;
end;
$$ language plpgsql;
