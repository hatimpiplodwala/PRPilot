// Inspect recent review jobs (status + error). Handy for debugging failures.
// Run:  npm run jobs

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Supabase env not set — run via `npm run jobs` (loads .env.local).");
  process.exit(1);
}

const sb = createClient(url, key, { auth: { persistSession: false } });
const { data, error } = await sb
  .from("review_jobs")
  .select("repo_full_name,pr_number,status,trigger,error,comment_id,created_at,updated_at")
  .order("created_at", { ascending: false })
  .limit(5);

if (error) {
  console.error(error.message);
  process.exit(1);
}

for (const j of data ?? []) {
  console.log(`\n${j.repo_full_name} #${j.pr_number}  [${j.status}]  (${j.trigger})`);
  console.log(`  updated: ${j.updated_at}`);
  if (j.comment_id) console.log(`  comment_id: ${j.comment_id}`);
  if (j.error) console.log(`  ERROR: ${j.error}`);
}
