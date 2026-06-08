import { getServiceSupabase } from "./db";

export interface AppUser {
  id: string;
  github_user_id: number;
  login: string;
  avatar_url: string | null;
}

export interface Installation {
  id: string;
  github_installation_id: number;
  account_login: string;
  user_id: string | null;
  deleted_at: string | null;
}

/** Create or update a user from their GitHub profile; returns the row. */
export async function upsertUser(profile: {
  githubUserId: number;
  login: string;
  avatarUrl?: string | null;
}): Promise<AppUser> {
  const supabase = getServiceSupabase();
  const { data, error } = await supabase
    .from("users")
    .upsert(
      {
        github_user_id: profile.githubUserId,
        login: profile.login,
        avatar_url: profile.avatarUrl ?? null,
      },
      { onConflict: "github_user_id" }
    )
    .select("*")
    .single();
  if (error) throw new Error(`upsertUser failed: ${error.message}`);
  return data as AppUser;
}

/**
 * Record a GitHub App installation, linking it to a user when known.
 *
 * The `revive` flag controls whether a soft-deleted (tombstoned) row is
 * resurrected. Real install events (`installation.created` / via the OAuth
 * setup callback) pass revive=true: the user is actively re-installing.
 * Defensive upserts from a stray `pull_request` webhook pass revive=false:
 * if the install was deleted, the PR is dropped on the floor (the webhook
 * caller logs and skips) instead of bringing back a revoked install.
 */
export async function upsertInstallation(input: {
  githubInstallationId: number;
  accountLogin: string;
  userId?: string | null;
  revive?: boolean;
}): Promise<Installation> {
  const supabase = getServiceSupabase();
  const row: Record<string, unknown> = {
    github_installation_id: input.githubInstallationId,
    account_login: input.accountLogin,
  };
  if (input.userId) row.user_id = input.userId;
  // Only clear the tombstone when the caller explicitly opts in.
  if (input.revive) row.deleted_at = null;

  const { data, error } = await supabase
    .from("installations")
    .upsert(row, { onConflict: "github_installation_id" })
    .select("*")
    .single();
  if (error) throw new Error(`upsertInstallation failed: ${error.message}`);
  return data as Installation;
}

/**
 * Soft-delete (tombstone). We DON'T hard-DELETE so a `pull_request` event
 * reordered after `installation.deleted` can't resurrect a revoked install via
 * the webhook's defensive upsert. Subsequent install events from the same
 * github_installation_id (rare — GitHub does not reuse ids, but operators can
 * recreate via the API) call upsertInstallation with revive=true to clear it.
 */
export async function removeInstallation(githubInstallationId: number): Promise<void> {
  const supabase = getServiceSupabase();
  await supabase
    .from("installations")
    .update({ deleted_at: new Date().toISOString() })
    .eq("github_installation_id", githubInstallationId);
}

/** Lookup an installation by github_installation_id (including tombstoned). */
export async function findInstallation(
  githubInstallationId: number
): Promise<Installation | null> {
  const supabase = getServiceSupabase();
  const { data } = await supabase
    .from("installations")
    .select("*")
    .eq("github_installation_id", githubInstallationId)
    .maybeSingle();
  return (data as Installation | null) ?? null;
}

/** Installations linked to a given user — excludes tombstoned. */
export async function listUserInstallations(userId: string): Promise<Installation[]> {
  const supabase = getServiceSupabase();
  const { data } = await supabase
    .from("installations")
    .select("*")
    .eq("user_id", userId)
    .is("deleted_at", null);
  return (data as Installation[]) ?? [];
}
