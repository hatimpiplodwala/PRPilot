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

/** Record a GitHub App installation, linking it to a user when known. */
export async function upsertInstallation(input: {
  githubInstallationId: number;
  accountLogin: string;
  userId?: string | null;
}): Promise<Installation> {
  const supabase = getServiceSupabase();
  const row: Record<string, unknown> = {
    github_installation_id: input.githubInstallationId,
    account_login: input.accountLogin,
  };
  if (input.userId) row.user_id = input.userId;

  const { data, error } = await supabase
    .from("installations")
    .upsert(row, { onConflict: "github_installation_id" })
    .select("*")
    .single();
  if (error) throw new Error(`upsertInstallation failed: ${error.message}`);
  return data as Installation;
}

export async function removeInstallation(githubInstallationId: number): Promise<void> {
  const supabase = getServiceSupabase();
  await supabase
    .from("installations")
    .delete()
    .eq("github_installation_id", githubInstallationId);
}

/** Installations linked to a given user. */
export async function listUserInstallations(userId: string): Promise<Installation[]> {
  const supabase = getServiceSupabase();
  const { data } = await supabase.from("installations").select("*").eq("user_id", userId);
  return (data as Installation[]) ?? [];
}
