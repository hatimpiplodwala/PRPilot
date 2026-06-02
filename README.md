# PRPilot 🚀

AI-powered GitHub PR review assistant. Installs as a **GitHub App**, automatically reviews pull requests with **Gemini**, and posts a structured review (summary · potential bugs · suggestions) back as a real PR comment. Built entirely on **free-tier** services.

See [`prd.md`](./prd.md) for the full product spec and [`progress.txt`](./progress.txt) for build status.

## Stack

| Layer | Tech |
|---|---|
| Framework | Next.js (App Router) + TypeScript |
| UI | Tailwind CSS + shadcn/ui primitives |
| Auth | NextAuth / Auth.js (GitHub) |
| Hosting | Vercel (Hobby) |
| Database | Supabase (Postgres) |
| Background jobs | Supabase Edge Functions + pg_cron |
| GitHub | GitHub App + Octokit |
| LLM | Google Gemini 2.5 Flash (native JSON mode) |

## How it works

```
PR opened/reopened ─▶ webhook (HMAC-verified) ─▶ enqueue review_job (queued)
                                                        │
Supabase cron (~1 min) ─▶ /api/internal/process ─▶ claim jobs ─▶ for each:
   fetch diff → cap files → Gemini (JSON) → render Markdown → post PR comment → done
                                                        │
Dashboard polls /api/jobs for status; "Review now" enqueues a manual job.
```

The webhook returns `202` immediately; the slow LLM work runs out-of-band in the
cron-driven processor, so no request hits Vercel's function time limit.

## Project layout

```
app/
  page.tsx                     landing + GitHub sign-in
  dashboard/page.tsx           PR list with status badges
  api/auth/[...nextauth]/      Auth.js handlers
  api/github/setup/            post-install linking
  api/reviews/                 manual "Review now" (rate-limited)
  api/jobs/                    status polling
  api/webhooks/github/         webhook receiver (verify, dedupe, enqueue)
  api/internal/process/        cron queue drain (shared-secret)
lib/
  github.ts                    Octokit: diff, comment, installation tokens
  llm.ts                       Gemini call + JSON schema (provider-isolated)
  diff.ts                      parse / cap files (pure, unit-tested)
  review.ts                    render review → collapsible Markdown (pure, tested)
  ratelimit.ts                 fixed-window limiter (pure math tested)
  jobs.ts / processor.ts       queue + review pipeline
  users.ts / dashboard.ts      user + installation data
supabase/
  schema.sql, schema-rpc.sql   tables + atomic RPCs
  cron.sql                     pg_cron schedules
  functions/                   process-reviews + keep-alive edge functions
tests/                         vitest unit tests
```

## Local setup

1. **Install deps**

   ```bash
   npm install
   ```

2. **Create the GitHub App** (Settings → Developer settings → GitHub Apps → New)
   - Permissions: Pull requests **Read & write**, Contents **Read**, Metadata **Read**
   - Subscribe to events: **Pull request**, **Installation**
   - Webhook URL: `https://<your-app>/api/webhooks/github` (use a tunnel like
     `ngrok` for local dev), set a **Webhook secret**
   - Setup URL: `https://<your-app>/api/github/setup`
   - Generate a **private key** (PEM) and note the **App ID** / slug
   - Enable OAuth (callback `https://<your-app>/api/auth/callback/github`)

3. **Create a Supabase project**, then run in the SQL editor:
   `supabase/schema.sql`, then `supabase/schema-rpc.sql`.

4. **Get a Gemini API key** from Google AI Studio.

5. **Configure env** — create `.env.local` with the variables below, then run
   `npm run doctor` to verify each credential is set and reachable.

   | Variable | Notes |
   |---|---|
   | `AUTH_SECRET` | `openssl rand -base64 32` |
   | `NEXTAUTH_URL` | `http://localhost:3000` locally |
   | `CRON_SECRET` | `openssl rand -hex 32` |
   | `GEMINI_API_KEY`, `GEMINI_MODEL` | from Google AI Studio (`gemini-2.5-flash`) |
   | `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API |
   | `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET` | GitHub App OAuth client id + secret |
   | `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_WEBHOOK_SECRET` | from the app's settings page |
   | `GITHUB_APP_PRIVATE_KEY` | the full `.pem` (multi-line in quotes, or one line with `\n`) |
   | `REVIEW_MAX_FILES`, `RATE_LIMIT_PER_HOUR`, `PROCESS_BATCH_SIZE` | optional tuning (20 / 15 / 3) |

6. **Run**

   ```bash
   npm run dev
   ```

## Deploy

- **App** → Vercel. Add every variable from the env table above as a project env var.
- **Background jobs** → deploy the edge functions and schedule them:

  ```bash
  supabase functions deploy process-reviews
  supabase functions deploy keep-alive
  supabase secrets set APP_URL=https://<your-app> CRON_SECRET=<same-as-app>
  ```

  Then run `supabase/cron.sql` (fill in your project ref + anon key) to schedule them.

## Scripts

```bash
npm run dev         # local dev server
npm run build       # production build
npm run typecheck   # tsc --noEmit
npm run test        # vitest unit tests
npm run lint        # next lint
```

## Tests

Pure logic is unit-tested with Vitest: diff filtering/ranking/capping
(`lib/diff.ts`), Markdown rendering (`lib/review.ts`), rate-limit window math
(`lib/ratelimit.ts`), and LLM output parsing (`lib/llm.ts`). GitHub/Gemini/DB
calls are I/O and verified manually against a real test repo.

## Notes & tradeoffs

- **v1 triggers** on `opened` + `reopened` only; re-review on new commits
  (`synchronize`) is future work.
- **Large PRs** are capped to the most significant files; the comment notes any
  truncation.
- **Quota safety** is a per-user/per-installation hourly rate limit. A global
  kill-switch/allowlist is deferred (see `prd.md` §12).
- The processor runs in a Next route with `maxDuration = 60`; keep
  `PROCESS_BATCH_SIZE` small so each cron tick stays within limits.
