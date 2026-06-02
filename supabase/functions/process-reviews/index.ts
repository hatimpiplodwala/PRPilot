// Supabase Edge Function (Deno runtime).
// Runs on a cron schedule and asks the Next.js app to drain a batch of queued
// review jobs. Keeping the heavy logic in the Next app keeps all business code
// in one place; this function is just the scheduler trigger.
//
// Required function secrets (supabase secrets set ...):
//   APP_URL      e.g. https://prpilot.vercel.app
//   CRON_SECRET  must match the app's CRON_SECRET

Deno.serve(async () => {
  const appUrl = Deno.env.get("APP_URL");
  const cronSecret = Deno.env.get("CRON_SECRET");

  if (!appUrl || !cronSecret) {
    return new Response(JSON.stringify({ error: "missing APP_URL or CRON_SECRET" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }

  const res = await fetch(`${appUrl}/api/internal/process`, {
    method: "POST",
    headers: { authorization: `Bearer ${cronSecret}` },
  });

  const body = await res.text();
  return new Response(body, {
    status: res.status,
    headers: { "content-type": "application/json" },
  });
});
