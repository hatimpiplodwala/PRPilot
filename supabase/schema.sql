-- PRPilot schema
-- Run in the Supabase SQL editor (or via the CLI) before first use.

create extension if not exists "pgcrypto";

-- A person who logged in via GitHub (NextAuth).
create table if not exists users (
  id              uuid primary key default gen_random_uuid(),
  github_user_id  bigint unique not null,
  login           text not null,
  avatar_url      text,
  created_at      timestamptz not null default now()
);

-- A GitHub App installation (the grant of repo access).
--
-- Uninstalls are RECORDED as a tombstone (deleted_at IS NOT NULL) rather than
-- deleted: a `pull_request` event reordered to arrive after `installation.deleted`
-- could otherwise resurrect a now-revoked install via the webhook's defensive
-- upsert. Soft-deleted rows are filtered out by `listUserInstallations` and the
-- upsert path checks deleted_at before resurrecting.
create table if not exists installations (
  id                      uuid primary key default gen_random_uuid(),
  github_installation_id  bigint unique not null,
  account_login           text not null,
  user_id                 uuid references users(id) on delete set null,
  created_at              timestamptz not null default now(),
  deleted_at              timestamptz
);

-- Idempotent backfill for databases created before deleted_at existed.
alter table installations add column if not exists deleted_at timestamptz;

-- One row per review attempt; doubles as the work queue + audit log.
create table if not exists review_jobs (
  id               uuid primary key default gen_random_uuid(),
  installation_id  bigint not null,
  repo_full_name   text not null,
  pr_number        integer not null,
  head_sha         text not null,
  status           text not null default 'queued'
                     check (status in ('queued','running','done','failed')),
  trigger          text not null default 'webhook'
                     check (trigger in ('webhook','manual')),
  result_json      jsonb,
  comment_id       bigint,
  -- Which GitHub API the comment_id refers to. Drives deep-linking from the
  -- dashboard to the right anchor on the PR page.
  --   review        -> #pullrequestreview-<id>  (pulls.createReview)
  --   issue_comment -> #issuecomment-<id>       (issues.createComment)
  comment_kind     text check (comment_kind in ('review','issue_comment')),
  error            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- Dedupe repeated webhook deliveries for the same commit.
  unique (repo_full_name, pr_number, head_sha)
);

-- Idempotent backfill for databases created before comment_kind existed.
alter table review_jobs add column if not exists comment_kind text
  check (comment_kind in ('review','issue_comment'));

create index if not exists review_jobs_status_idx on review_jobs (status, created_at);

-- Dashboard reads the latest jobs per installation (WHERE installation_id IN (…)
-- ORDER BY created_at DESC LIMIT 200). The status,created_at index above doesn't
-- help that query — add a covering index on (installation_id, created_at DESC).
create index if not exists review_jobs_installation_idx
  on review_jobs (installation_id, created_at desc);

-- FK from review_jobs.installation_id to installations.github_installation_id
-- with ON DELETE CASCADE: when a user uninstalls (handled by the webhook), all
-- of that installation's jobs are removed in one shot.
--
-- Wrapped in a DO block because Postgres has no `add constraint if not exists`.
--
-- Orphan-job handling: a previous version of this migration DELETED orphan
-- review_jobs (rows whose installation_id had no matching installations row).
-- That silently destroyed legitimate data — historically the webhook handler
-- didn't upsert installations before enqueueing, so a missed `installation`
-- event left jobs with no matching install row even though the work itself
-- was real and (in the case of `done` jobs) held the comment_id used for
-- in-place updates.
--
-- Now we BACKFILL: insert a placeholder installations row for each orphan
-- installation_id so the FK can be added without touching review_jobs. The
-- placeholder account_login is "unknown"; subsequent webhook deliveries for
-- that installation will overwrite it via the upsert path.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'review_jobs_installation_fkey'
  ) then
    insert into installations (github_installation_id, account_login)
    select distinct r.installation_id, 'unknown'
    from review_jobs r
    where not exists (
      select 1 from installations i where i.github_installation_id = r.installation_id
    )
    on conflict (github_installation_id) do nothing;

    alter table review_jobs
      add constraint review_jobs_installation_fkey
      foreign key (installation_id)
      references installations(github_installation_id)
      on delete cascade;
  end if;
end $$;

-- One row per GitHub webhook delivery we've successfully signature-verified.
-- Keyed on the X-GitHub-Delivery UUID so a re-delivered event (GitHub retries
-- on non-2xx, and some events arrive multiple times legitimately) is a no-op.
-- Buys us replay safety and an audit trail of "did we see this delivery?".
create table if not exists webhook_deliveries (
  id           text primary key,
  event        text not null,
  received_at  timestamptz not null default now()
);

-- Fixed-window rate-limit counter (per user, per hour bucket).
create table if not exists rate_limits (
  id            uuid primary key default gen_random_uuid(),
  subject       text not null,            -- e.g. "user:<id>" or "install:<id>"
  window_start  timestamptz not null,     -- start of the hour bucket
  count         integer not null default 0,
  unique (subject, window_start)
);

-- Keep updated_at fresh on review_jobs.
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists review_jobs_set_updated_at on review_jobs;
create trigger review_jobs_set_updated_at
  before update on review_jobs
  for each row execute function set_updated_at();

-- Row-Level Security: deny-by-default.
--
-- The app talks to Supabase only via the service-role key, which has the
-- `bypassrls` attribute — enabling RLS does NOT change any current request.
-- What it DOES do:
--   * If a future change accidentally swaps the service key for the anon /
--     authenticated key, queries fail loudly instead of silently returning
--     other users' data.
--   * If the `NEXT_PUBLIC_SUPABASE_URL` is ever paired with the anon key on
--     the client (the standard Supabase pattern), that client has no access
--     to any of these tables without an explicit policy. Today the app does
--     not do this, and we want to keep it that way; RLS enforces it.
--   * Direct PostgREST traffic with the anon role is rejected without a JWT.
--
-- No policies are added — with RLS on and no policy, non-bypass roles get
-- zero rows on SELECT and zero rows affected on writes.
alter table users              enable row level security;
alter table installations      enable row level security;
alter table review_jobs        enable row level security;
alter table rate_limits        enable row level security;
alter table webhook_deliveries enable row level security;

-- Belt-and-suspenders: revoke explicit grants the anon/authenticated roles
-- may have inherited from `public` defaults. (Supabase grants SELECT on new
-- tables to anon/authenticated by default in some project templates.)
revoke all on users              from anon, authenticated;
revoke all on installations      from anon, authenticated;
revoke all on review_jobs        from anon, authenticated;
revoke all on rate_limits        from anon, authenticated;
revoke all on webhook_deliveries from anon, authenticated;
