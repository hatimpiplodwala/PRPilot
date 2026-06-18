# PRPilot

**An AI code reviewer that lives inside GitHub.** Install it on a repo, open a pull request, and a few seconds later, a structured review shows up as a comment:  a one-paragraph summary, severity-ranked potential bugs, and concrete suggestions, plus inline comments on the exact lines that need attention. No browser tab to open, no copy-pasting diffs into a chat window.

Built end-to-end on free tiers: Next.js on Vercel, Postgres on Supabase, Gemini 2.5 Flash for the LLM, and a GitHub App for the integration boundary.

## What it does

When a pull request is opened, reopened, or pushed to:

1. GitHub fires a webhook → PRPilot verifies the HMAC signature and enqueues a job.
2. A cron-driven worker claims the job, fetches the diff, ranks files by significance, and caps to the most important N to stay within token + free-tier limits.
3. Gemini returns a structured review (native JSON mode against a fixed schema).
4. The worker renders the review as Markdown, posts it as a single top-level PR comment, and adds inline review comments on the highest-severity findings.

A small dashboard lists every open PR across installed repos, shows live review status, and has a **Review now** button for manually re-running a review.

## Design decisions worth calling out

These are the choices that drove the shape of the codebase. Most of them are tradeoffs, not "best practices":

- **The queue is the database.** `review_jobs` doubles as the work queue *and* the audit log. Workers claim jobs with `UPDATE … FOR UPDATE SKIP LOCKED` so concurrent processors never grab the same row, and the same table answers the dashboard's "what's the status of this PR?" question without a second store. No Redis, no SQS, no separate scheduler.
- **Webhook returns 202 immediately.** The webhook handler does signature check → enqueue → respond, all in under a second. The slow LLM work (5–30s) runs out of band in a cron-triggered processor, so nothing ever bumps Vercel Hobby's ~10s function limit.
- **Cron lives in Supabase, not Vercel.** Supabase pg_cron + an Edge Function fires `/api/internal/process` every minute with a shared-secret bearer token. This means the same scheduler works in dev, staging, and prod, and stays within Vercel Hobby's once-per-day cron cap.
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
                                  Supabase pg_cron (every 1 min)
                                                       │
                                                       ▼
                              /api/internal/process (bearer auth)
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
| Database | Supabase Postgres |
| Background jobs | Supabase Edge Function + pg_cron |
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
  api/internal/process/        cron-driven queue drain (timing-safe bearer)
lib/
  github.ts                    Octokit wrappers: diff, comments, install tokens
  llm.ts                       Gemini call + response schema
  diff.ts                      file filtering / ranking / capping (pure)
  review.ts                    review → Markdown + inline comments (pure)
  ratelimit.ts                 fixed-window limiter
  jobs.ts / processor.ts       queue + review pipeline
  users.ts / dashboard.ts      user + installation data
supabase/
  schema.sql, schema-rpc.sql   tables + atomic RPCs
  cron.sql                     pg_cron schedules
  functions/                   process-reviews + keep-alive edge functions
tests/                         vitest unit suites
```

## Tradeoffs and known limits

- **Large PRs are sampled.** Files are ranked by `additions + deletions` and capped to `REVIEW_MAX_FILES` (default 20). The comment notes when truncation happened. A whole-repo or chunked-pass strategy was deliberately deferred.
- **Per-user/per-installation hourly rate limit, no global kill-switch.** Quota safety relies on a fixed-window counter incremented via an atomic Postgres RPC. There's no allowlist or global circuit breaker yet — sufficient for an indie/portfolio deployment, not for an open public service.
- **`maxDuration = 60` on the processor route.** Each cron tick processes `PROCESS_BATCH_SIZE` jobs (default 3). On Vercel Hobby this may be enforced lower; keep the batch size small.
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
# App
vercel              # add every env var above as a project env var

# Background jobs
supabase functions deploy process-reviews
supabase functions deploy keep-alive
supabase secrets set APP_URL=https://<your-app> CRON_SECRET=<same-as-app>
# Then run supabase/cron.sql in the SQL editor to schedule them.
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
