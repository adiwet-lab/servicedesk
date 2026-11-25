import { redirect } from "next/navigation";
import { ShieldCheck, Headset } from "lucide-react";
import { auth, signIn, devLoginEnabled, entraConfigured } from "@/server/auth/auth";
import { getActor } from "@/server/auth/get-actor";
import { GATE_MESSAGES } from "@/server/auth/tenant-gate";
import { prisma } from "@/server/db";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert } from "@/components/ui/misc";
import { NativeSelect } from "@/components/ui/input";
import { getTranslations } from "next-intl/server";
import { LanguageSwitcher } from "@/components/layout/language-switcher";

export async function generateMetadata() {
  return { title: (await getTranslations("auth"))("pageTitle") };
}

function safeCallback(url: string | undefined) {
  return url && url.startsWith("/") && !url.startsWith("//") ? url : "/dashboard";
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; callbackUrl?: string }> }) {
  const sp = await searchParams;
  const session = await auth();
  if (session?.uid && (await getActor())) redirect(safeCallback(sp.callbackUrl));
  const callbackUrl = safeCallback(sp.callbackUrl);
  const t = await getTranslations("auth");
  const tr = await getTranslations("roles");
  const gate = sp.error && sp.error in GATE_MESSAGES ? (sp.error as keyof typeof GATE_MESSAGES) : null;
  const errorMsg = sp.error ? (gate ? t(`gate.${gate}`) : sp.error === "CredentialsSignin" ? t("devFailed") : t("gate.Default")) : null;

  const devUsers = devLoginEnabled
    ? await prisma.user.findMany({
        where: { deletedAt: null },
        include: { roles: { include: { role: true } }, tenant: true },
        orderBy: [{ tenant: { name: "asc" } }, { displayName: "asc" }],
      })
    : [];

  async function microsoftSignIn() {
    "use server";
    await signIn("microsoft-entra-id", { redirectTo: callbackUrl });
  }
  async function devSignIn(fd: FormData) {
    "use server";
    if (!devLoginEnabled) return;
    await signIn("dev-login", { userId: String(fd.get("userId") ?? ""), redirectTo: callbackUrl });
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-sidebar via-sidebar to-primary/60 p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="flex justify-end"><LanguageSwitcher className="border-white/30 bg-white/90" /></div>
        <div className="flex items-center justify-center gap-3 text-white">
          <div className="flex size-11 items-center justify-center rounded-xl bg-white/10"><Headset className="size-6" /></div>
          <div>
            <p className="text-xl font-semibold">IT Service Desk</p>
            <p className="text-sm text-white/70">{t("tagline")}</p>
          </div>
        </div>
        <Card className="shadow-xl">
          <CardHeader>
            <CardTitle className="text-lg">{t("signIn")}</CardTitle>
            <CardDescription>{t("intro")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {errorMsg && <Alert variant="destructive">{errorMsg}</Alert>}
            {entraConfigured ? (
              <form action={microsoftSignIn}>
                <Button type="submit" size="lg" className="w-full bg-[#2f2f2f] hover:bg-[#1f1f1f] text-white">
                  <svg viewBox="0 0 21 21" className="size-4" aria-hidden><path fill="#f25022" d="M1 1h9v9H1z" /><path fill="#00a4ef" d="M1 11h9v9H1z" /><path fill="#7fba00" d="M11 1h9v9h-9z" /><path fill="#ffb900" d="M11 11h9v9h-9z" /></svg>
                  {t("signInMicrosoft")}
                </Button>
              </form>
            ) : (
              <Alert variant="warning">{t("notConfigured")} <code>AUTH_MICROSOFT_ENTRA_ID_ID</code>, <code>AUTH_MICROSOFT_ENTRA_ID_SECRET</code></Alert>
            )}
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <ShieldCheck className="size-3.5" /> {t("restricted")}
            </p>

            {devLoginEnabled && (
              <div className="space-y-2 rounded-lg border border-dashed border-warning/60 bg-warning/5 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">{t("devLogin")}</p>
                <form action={devSignIn} className="flex gap-2">
                  <NativeSelect name="userId" aria-label={t("demoUser")} data-testid="dev-user-select" className="flex-1">
                    {devUsers.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.displayName} — {u.roles.map((r) => (tr.has(r.role.code as never) ? tr(r.role.code as never) : r.role.name)).join(", ") || t("noRole")} [{u.tenant.type === "VENDOR" ? t("vendor") : t("internal")}{u.status !== "ACTIVE" ? `, ${u.status.toLowerCase()}` : ""}]
                      </option>
                    ))}
                  </NativeSelect>
                  <Button type="submit" variant="outline" data-testid="dev-login-submit">{t("signIn")}</Button>
                </form>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
