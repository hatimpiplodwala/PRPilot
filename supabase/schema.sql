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
create table if not exists installations (
  id                      uuid primary key default gen_random_uuid(),
  github_installation_id  bigint unique not null,
  account_login           text not null,
  user_id                 uuid references users(id) on delete set null,
  created_at              timestamptz not null default now()
);

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
  error            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- Dedupe repeated webhook deliveries for the same commit.
  unique (repo_full_name, pr_number, head_sha)
);

create index if not exists review_jobs_status_idx on review_jobs (status, created_at);

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
