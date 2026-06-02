// Local queue drain — stands in for the Supabase cron in production.
// Calls the internal processor once so queued reviews actually run on your machine.
// Requires `npm run dev` to be running in another terminal.
//
// Run:  npm run process

const base = process.env.NEXTAUTH_URL || "http://localhost:3000";
const secret = process.env.CRON_SECRET;

if (!secret) {
  console.error("CRON_SECRET not set — run via `npm run process` (loads .env.local).");
  process.exit(1);
}

try {
  const res = await fetch(`${base}/api/internal/process`, {
    method: "POST",
    headers: { authorization: `Bearer ${secret}` },
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`Processor returned ${res.status}: ${text}`);
    process.exit(1);
  }
  console.log(`Processed: ${text}`);
} catch (e) {
  console.error(`Could not reach ${base} — is \`npm run dev\` running?`);
  console.error(e.message);
  process.exit(1);
}
