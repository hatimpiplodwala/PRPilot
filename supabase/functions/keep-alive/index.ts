// Supabase Edge Function (Deno runtime).
// Pings the database on a schedule so the free Supabase project does not pause
// after ~1 week of inactivity (which would silently break webhooks).
//
// Required function secrets:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  (provided automatically in the
//   Supabase Edge runtime as SB_URL / SB_SERVICE_ROLE_KEY — read either name)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async () => {
  const url = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("SB_URL") ?? "";
  const key =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SB_SERVICE_ROLE_KEY") ?? "";

  if (!url || !key) {
    return new Response(JSON.stringify({ error: "missing supabase env" }), { status: 500 });
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  // Cheapest possible read just to touch the DB.
  const { error } = await supabase.from("review_jobs").select("id").limit(1);

  return new Response(JSON.stringify({ ok: !error }), {
    status: error ? 500 : 200,
    headers: { "content-type": "application/json" },
  });
});
