import NextAuth, { type NextAuthConfig } from "next-auth";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "@/server/db";
import { resolveEntraUser, validateEntraClaims } from "./tenant-gate";

export const devLoginEnabled =
  process.env.AUTH_DEV_LOGIN === "true" && process.env.NODE_ENV !== "production";

export const entraConfigured = !!(
  process.env.AUTH_MICROSOFT_ENTRA_ID_ID && process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET
);

const providers: NextAuthConfig["providers"] = [];

if (entraConfigured) {
  providers.push(
    MicrosoftEntraID({
      clientId: process.env.AUTH_MICROSOFT_ENTRA_ID_ID,
      clientSecret: process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET,
      // Multi-tenant app registration: any work/school tenant may attempt sign-in;
      // our tenant allow-list (resolveEntraUser) decides who gets in.
      issuer: process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER ?? "https://login.microsoftonline.com/organizations/v2.0",
      authorization: { params: { scope: "openid profile email", prompt: "select_account" } },
      // Skip Graph photo download — keeps the session cookie small.
      profile(profile) {
        return { id: String(profile.oid ?? profile.sub), name: profile.name, email: profile.email ?? profile.preferred_username };
      },
    }),
  );
}

if (devLoginEnabled) {
  providers.push(
    Credentials({
      id: "dev-login",
      name: "Developer login",
      credentials: { userId: { label: "User ID", type: "text" } },
      async authorize(creds) {
        const userId = typeof creds?.userId === "string" ? creds.userId : "";
        if (!userId) return null;
        const user = await prisma.user.findUnique({ where: { id: userId }, include: { tenant: true } });
        if (!user || user.status !== "ACTIVE" || user.deletedAt || !user.tenant.isActive) return null;
        if (user.accessExpiresAt && user.accessExpiresAt <= new Date()) return null;
        await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
        return { id: user.id, name: user.displayName, email: user.email };
      },
    }),
  );
}

export const authConfig: NextAuthConfig = {
  providers,
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 },
  pages: { signIn: "/login", error: "/login" },
  trustHost: true,
  callbacks: {
    async signIn({ account, profile }) {
      if (account?.provider === "microsoft-entra-id") {
        const result = await resolveEntraUser(prisma, profile ?? {});
        if (!result.ok) return `/login?error=${result.reason}`;
      }
      return true;
    },
    async jwt({ token, account, profile, user }) {
      if (account) {
        // Fresh sign-in — bind token to our internal user id + sessionVersion.
        let userId: string | null = null;
        if (account.provider === "microsoft-entra-id") {
          const v = validateEntraClaims(profile ?? {});
          if (v.ok) {
            const u = await prisma.user.findFirst({
              where: { entraObjectId: v.oid, tenant: { entraTenantId: v.tid } },
              select: { id: true },
            });
            userId = u?.id ?? null;
          }
        } else if (account.provider === "dev-login") {
          userId = user?.id ?? null;
        }
        if (!userId) return null;
        const u = await prisma.user.findUnique({ where: { id: userId }, select: { sessionVersion: true } });
        token.uid = userId;
        token.sv = u?.sessionVersion ?? 0;
        token.provider = account.provider;
        // Never keep provider tokens in the session cookie.
        delete token.picture;
      }
      return token;
    },
    async session({ session, token }) {
      session.uid = token.uid as string | undefined;
      session.sv = token.sv as number | undefined;
      return session;
    },
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
