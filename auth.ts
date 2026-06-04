import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import { upsertUser } from "@/lib/users";

/**
 * Auth.js (NextAuth v5) configuration. GitHub OAuth for login; on first sign-in
 * we persist the user in Supabase and stash their internal id + GitHub id in the
 * JWT so server code can scope queries to the logged-in user.
 *
 * Reads AUTH_SECRET, AUTH_GITHUB_ID, AUTH_GITHUB_SECRET from the environment.
 */
// Trust the incoming Host header only where it can't be spoofed:
//   - non-production (localhost dev)
//   - Vercel (sets x-forwarded-host from its edge)
//   - explicit opt-in via AUTH_TRUST_HOST=true (self-hosting behind a trusted proxy)
// In any other production deployment, leave it false so Auth.js requires AUTH_URL,
// closing the host-header → OAuth-callback rebinding vector.
const trustHost =
  process.env.NODE_ENV !== "production" ||
  !!process.env.VERCEL ||
  process.env.AUTH_TRUST_HOST === "true";

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost,
  providers: [GitHub],
  callbacks: {
    async jwt({ token, profile }) {
      if (profile) {
        const githubUserId = Number(profile.id);
        const login = String(profile.login ?? token.name ?? "");
        const user = await upsertUser({
          githubUserId,
          login,
          avatarUrl: typeof profile.avatar_url === "string" ? profile.avatar_url : null,
        });
        token.userId = user.id;
        token.githubUserId = githubUserId;
        token.login = login;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = (token.userId as string) ?? "";
        session.user.githubUserId = token.githubUserId as number | undefined;
        session.user.login = token.login as string | undefined;
      }
      return session;
    },
  },
});
