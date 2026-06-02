// PRPilot setup doctor.
// Run:  npm run doctor
// Loads .env.local and verifies each credential is filled AND actually works.
// Safe to run repeatedly while you fill in .env.local.

const PLACEHOLDER = /^<.*>$/;

function val(name) {
  const v = process.env[name];
  if (!v || PLACEHOLDER.test(v)) return null;
  return v;
}

const pass = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const fail = (m) => console.log(`  \x1b[31m✗\x1b[0m ${m}`);
const skip = (m) => console.log(`  \x1b[33m–\x1b[0m ${m}`);
const head = (m) => console.log(`\n\x1b[1m${m}\x1b[0m`);

let problems = 0;

// ---- Generated secrets ----
head("Generated secrets");
for (const k of ["AUTH_SECRET", "CRON_SECRET", "NEXTAUTH_URL"]) {
  if (val(k)) pass(`${k} set`);
  else {
    fail(`${k} missing`);
    problems++;
  }
}

// ---- Gemini ----
head("Google Gemini");
const geminiKey = val("GEMINI_API_KEY");
if (!geminiKey) {
  skip("GEMINI_API_KEY not set yet — https://aistudio.google.com/apikey");
} else {
  try {
    const { GoogleGenerativeAI } = await import("@google/generative-ai");
    const model = new GoogleGenerativeAI(geminiKey).getGenerativeModel({
      model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
    });
    const r = await model.generateContent("Reply with the single word: ok");
    pass(`Gemini reachable (model replied: "${r.response.text().trim().slice(0, 20)}")`);
  } catch (e) {
    fail(`Gemini call failed: ${e.message}`);
    problems++;
  }
}

// ---- Supabase ----
head("Supabase");
const sbUrl = val("NEXT_PUBLIC_SUPABASE_URL");
const sbKey = val("SUPABASE_SERVICE_ROLE_KEY");
if (!sbUrl || !sbKey) {
  skip("Supabase URL / service-role key not set yet — Project → Settings → API");
} else {
  try {
    const { createClient } = await import("@supabase/supabase-js");
    const sb = createClient(sbUrl, sbKey, { auth: { persistSession: false } });
    for (const table of ["users", "installations", "review_jobs", "rate_limits"]) {
      const { error } = await sb.from(table).select("*").limit(1);
      if (error) {
        fail(`table "${table}" not reachable: ${error.message} — did you run schema.sql?`);
        problems++;
      } else {
        pass(`table "${table}" OK`);
      }
    }
    // RPCs
    const { error: rpcErr } = await sb.rpc("increment_rate_limit", {
      p_subject: "doctor:test",
      p_window_start: new Date().toISOString(),
    });
    if (rpcErr) {
      fail(`RPC increment_rate_limit missing: ${rpcErr.message} — run schema-rpc.sql`);
      problems++;
    } else {
      pass("RPC increment_rate_limit OK");
      await sb.from("rate_limits").delete().eq("subject", "doctor:test");
    }
  } catch (e) {
    fail(`Supabase check failed: ${e.message}`);
    problems++;
  }
}

// ---- GitHub App ----
head("GitHub App");
const appId = val("GITHUB_APP_ID");
const pk = val("GITHUB_APP_PRIVATE_KEY");
if (!appId || !pk) {
  skip("GITHUB_APP_ID / private key not set yet — see README");
} else {
  try {
    const { Octokit } = await import("@octokit/rest");
    const { createAppAuth } = await import("@octokit/auth-app");
    const octokit = new Octokit({
      authStrategy: createAppAuth,
      auth: { appId, privateKey: pk.replace(/\\n/g, "\n") },
    });
    const { data: app } = await octokit.rest.apps.getAuthenticated();
    pass(`Authenticated as GitHub App "${app.slug}" (id ${app.id})`);
    const installs = await octokit.paginate(octokit.rest.apps.listInstallations, { per_page: 100 });
    if (installs.length === 0) {
      skip("No installations yet — install the app on a repo to start reviewing");
    } else {
      pass(`${installs.length} installation(s): ${installs.map((i) => i.account?.login).join(", ")}`);
    }
  } catch (e) {
    fail(`GitHub App auth failed: ${e.message}`);
    problems++;
  }
}

// ---- OAuth (login) ----
head("GitHub OAuth (login)");
if (val("AUTH_GITHUB_ID") && val("AUTH_GITHUB_SECRET")) {
  pass("Client ID + secret set (validated at first login)");
} else {
  skip("AUTH_GITHUB_ID / AUTH_GITHUB_SECRET not set yet");
}

head(problems === 0 ? "All set credentials look good ✅" : `${problems} problem(s) found ⚠️`);
process.exit(problems === 0 ? 0 : 1);
