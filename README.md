# PRPilot

**An AI code reviewer that lives inside GitHub.** Install it on a repo, open a pull request, and a few seconds later, a structured review shows up as a comment:  a one-paragraph summary, severity-ranked potential bugs, and concrete suggestions, plus inline comments on the exact lines that need attention. No browser tab to open, no copy-pasting diffs into a chat window.

Built end-to-end on free tiers: Next.js on Vercel, Postgres on Supabase, Gemini 2.5 Flash for the LLM, a GitHub App for the integration boundary, and a containerized worker on AWS Lambda for the background review pipeline.

## What it does

When a pull request is opened, reopened, or pushed to:

1. GitHub fires a webhook → PRPilot verifies the HMAC signature and enqueues a job.
2. A worker on AWS Lambda — triggered every minute by an EventBridge rule — claims the job, fetches the diff, ranks files by significance, and caps to the most important N to stay within token + free-tier limits.
3. Gemini returns a structured review (native JSON mode against a fixed schema).
4. The worker renders the review as Markdown, posts it as a single top-level PR comment, and adds inline review comments on the highest-severity findings.

A small dashboard lists every open PR across installed repos, shows live review status, and has a **Review now** button for manually re-running a review.

## Design decisions worth calling out

These are the choices that drove the shape of the codebase. Most of them are tradeoffs, not "best practices":

- **The queue is the database.** `review_jobs` doubles as the work queue *and* the audit log. Workers claim jobs with `UPDATE … FOR UPDATE SKIP LOCKED` so concurrent processors never grab the same row, and the same table answers the dashboard's "what's the status of this PR?" question without a second store. No Redis, no SQS, no separate scheduler.
- **Webhook returns 202 immediately.** The webhook handler does signature check → enqueue → respond, all in under a second. The slow LLM work (5–30s) runs out of band in a scheduled Lambda worker, so nothing ever bumps Vercel Hobby's ~10s function limit.
- **The background worker runs on AWS Lambda, not Vercel.** The review pipeline is packaged as a Docker image (pushed to ECR) and run on Lambda, invoked every minute by an EventBridge rule (IAM auth, no shared secret). This keeps the slow LLM work off Vercel Hobby — whose function limits and once-per-day cron cap drove the original design — and onto Lambda's 15-minute ceiling, all within the always-free tier. The same `drainOnce()` core still backs the manual **Review now** path on the Vercel route; `claim_review_jobs`' `SKIP LOCKED` lets both run without ever double-claiming a job.
- **Manual "Review now" kicks the processor inline.** Waiting up to a minute for the next cron tick made the dashboard feel broken. The manual route enqueues, then uses Next 15's `after()` to fire the processor in the background so the UI sees `running` in ~1s. Cron is still the safety net.
- **LLM provider is isolated to one file.** `lib/llm.ts` is the only module that imports `@google/generative-ai`. Swapping Gemini for Claude or GPT means rewriting one file, not refactoring the codebase.
- **Pure logic is unit-tested, I/O isn't.** Diff filtering, file ranking, Markdown rendering, rate-limit window math, and LLM output parsing all have Vitest suites. GitHub/Gemini/Supabase calls are exercised manually against a real repo — mocking them gives confidence in the mocks, not in the integration.
- **Service-role Supabase everywhere; auth at the route layer.** Every API route does its own ownership check before reading anything. RLS would be defense-in-depth, but the surface is small enough that auditing four routes is easier than maintaining RLS policies.

## Architecture

```
PR opened/reopened/synchronize
        │
        ▼
  Webhook (HMAC verify) ──▶ enqueueJob() ──▶ review_jobs (queued)
                                                       │
                               AWS EventBridge (every 1 min)
                                                       │
                                                       ▼
                          Lambda worker (Docker image on ECR)
                                                       │
                                          claim_review_jobs RPC
                                       (FOR UPDATE SKIP LOCKED)
                                                       │
                                                       ▼
        ┌─────────── for each claimed job ───────────┐
        │  fetch PR + files via installation token   │
        │  rank + cap files to REVIEW_MAX_FILES      │
        │  Gemini (JSON schema)                      │
        │  render Markdown + inline comments         │
        │  post / update PR comment                  │
        │  mark job done (or failed + post fallback) │
        └────────────────────────────────────────────┘

Dashboard ──▶ /api/jobs polls status by job id (scoped to user's installations)
Dashboard ──▶ /api/reviews enqueues a manual job + kicks processor via after()
```

The webhook never does heavy work. The processor is the only place an LLM call happens.

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 15 (App Router) + TypeScript |
| UI | Tailwind CSS + shadcn/ui primitives |
| Auth | Auth.js (NextAuth v5), GitHub OAuth |
| Hosting | Vercel (Hobby) |
| Container | Docker (multi-stage: Next standalone app image + bundled Lambda worker) |
| Database | Supabase Postgres |
| Background worker | AWS Lambda (Docker image via ECR), scheduled by EventBridge |
| GitHub | GitHub App + Octokit |
| LLM | Google Gemini 2.5 Flash (native JSON mode) |
| Tests | Vitest (pure logic only) |

## Project layout

```
app/
  page.tsx                     landing + GitHub sign-in
  dashboard/page.tsx           PR list + live review status
  api/auth/[...nextauth]/      Auth.js handlers
  api/github/setup/            post-install linking (ownership-checked)
  api/reviews/                 manual "Review now" (rate-limited)
  api/jobs/                    status polling (scoped to user's installs)
  api/webhooks/github/         webhook receiver
  api/internal/process/        queue-drain endpoint (manual kick; timing-safe bearer)
lib/
  github.ts                    Octokit wrappers: diff, comments, install tokens
  llm.ts                       Gemini call + response schema
  diff.ts                      file filtering / ranking / capping (pure)
  review.ts                    review → Markdown + inline comments (pure)
  ratelimit.ts                 fixed-window limiter
  jobs.ts / processor.ts       queue + review pipeline
  worker.ts                    queue-drain core (shared by route + Lambda)
  users.ts / dashboard.ts      user + installation data
worker/
  handler.ts                   AWS Lambda entry point → drainOnce()
scripts/
  build-worker.mjs             esbuild bundle for the Lambda image
Dockerfile                     Next standalone app image
Dockerfile.worker              Lambda worker image (pushed to ECR)
supabase/
  schema.sql, schema-rpc.sql   tables + atomic RPCs
  cron.sql                     pg_cron schedules (keep-alive + cleanup)
tests/                         vitest unit suites
```

## Tradeoffs and known limits

- **Large PRs are sampled.** Files are ranked by `additions + deletions` and capped to `REVIEW_MAX_FILES` (default 20). The comment notes when truncation happened. A whole-repo or chunked-pass strategy was deliberately deferred.
- **Per-user/per-installation hourly rate limit, no global kill-switch.** Quota safety relies on a fixed-window counter incremented via an atomic Postgres RPC. There's no allowlist or global circuit breaker yet — sufficient for an indie/portfolio deployment, not for an open public service.
- **Small batch per tick.** Each scheduled run processes `PROCESS_BATCH_SIZE` jobs (default 3). The Lambda worker has a 120s timeout (the Vercel route's `maxDuration = 60` still backs the manual kick); keep the batch modest so a tick finishes comfortably.
- **Personal-account installs are linked on setup; org installs are recorded but unlinked.** The setup route only links an installation to the signed-in user when the installation's `account.login` matches the user's GitHub login (so installation IDs aren't claimable). Org-install linkage is future work.

## Running it

The setup is real GitHub-App-and-Supabase plumbing, not a one-command demo. A guided `npm run doctor` script verifies every credential is set and actually reachable before you try to use the app.

1. `npm install`
2. Create a **GitHub App** with: Pull requests R/W, Contents R, Metadata R; subscribe to *Pull request* and *Installation*; set webhook URL `/api/webhooks/github` and setup URL `/api/github/setup`; generate a private key; enable OAuth (callback `/api/auth/callback/github`).
3. Create a **Supabase** project and run `supabase/schema.sql` then `supabase/schema-rpc.sql` in the SQL editor.
4. Grab a **Gemini API key** from Google AI Studio.
5. Fill in `.env.local` (see env table below) and run `npm run doctor` until it's all green.
6. `npm run dev`

### Environment

| Variable | Notes |
|---|---|
| `AUTH_SECRET` | `openssl rand -base64 32` |
| `NEXTAUTH_URL` | `http://localhost:3000` locally |
| `CRON_SECRET` | `openssl rand -hex 32` |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | `gemini-2.5-flash` |
| `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API |
| `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET` | GitHub App OAuth client id + secret |
| `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_WEBHOOK_SECRET` | from the App's settings |
| `GITHUB_APP_PRIVATE_KEY` | full PEM (multi-line in quotes, or one line with `\n`) |
| `REVIEW_MAX_FILES`, `RATE_LIMIT_PER_HOUR`, `PROCESS_BATCH_SIZE` | optional tuning (20 / 15 / 3) |
| `AUTH_TRUST_HOST` | set to `true` only when self-hosting behind a trusted reverse proxy |

### Deploy

```bash
# App (Vercel) — or build the Docker image and run it anywhere
vercel              # add every env var above as a project env var
# docker build -t prpilot . && docker run -p 3000:3000 --env-file .env.local prpilot

# Background worker (AWS Lambda, Docker image via ECR)
REG=<account>.dkr.ecr.<region>.amazonaws.com
aws ecr create-repository --repository-name prpilot-worker
docker buildx build --platform linux/amd64 --provenance=false \
  -f Dockerfile.worker -t $REG/prpilot-worker:latest --push .
# Create the Lambda from that image (execution role + the worker's env vars),
# then an EventBridge rule — rate(1 minute) — that invokes it.
# Run supabase/cron.sql for the keep-alive + cleanup schedules; the per-minute
# review drain now runs on AWS, not pg_cron.
```

### Scripts

```bash
npm run dev          # local dev server
npm run build        # production build
npm run typecheck    # tsc --noEmit
npm run test         # vitest unit tests
npm run lint         # next lint
npm run doctor       # verifies every credential is set + reachable
```
