/**
 * Centralised, validated access to environment variables.
 * Throws a clear error at first use if a required secret is missing,
 * rather than failing deep inside an API call.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

function optionalInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

export const env = {
  // GitHub App
  get githubAppId() {
    return required("GITHUB_APP_ID");
  },
  get githubPrivateKey() {
    // Support keys stored with literal "\n" on a single line.
    return required("GITHUB_APP_PRIVATE_KEY").replace(/\\n/g, "\n");
  },
  get githubWebhookSecret() {
    return required("GITHUB_WEBHOOK_SECRET");
  },
  get githubAppSlug() {
    return optional("GITHUB_APP_SLUG", "prpilot");
  },

  // Gemini
  get geminiApiKey() {
    return required("GEMINI_API_KEY");
  },
  get geminiModel() {
    return optional("GEMINI_MODEL", "gemini-2.5-flash");
  },

  // Supabase
  get supabaseUrl() {
    return required("NEXT_PUBLIC_SUPABASE_URL");
  },
  get supabaseServiceRoleKey() {
    return required("SUPABASE_SERVICE_ROLE_KEY");
  },

  // Cron / internal
  get cronSecret() {
    return required("CRON_SECRET");
  },

  // Tuning
  get reviewMaxFiles() {
    return optionalInt("REVIEW_MAX_FILES", 20);
  },
  get rateLimitPerHour() {
    return optionalInt("RATE_LIMIT_PER_HOUR", 15);
  },
  get processBatchSize() {
    return optionalInt("PROCESS_BATCH_SIZE", 3);
  },
};
