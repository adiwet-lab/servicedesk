import Link from "next/link";
import { getTranslations } from "next-intl/server";

export default async function NotFound() {
  const t = await getTranslations("notFound");
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
      <p className="text-5xl font-bold text-muted-foreground">404</p>
      <p className="font-medium">{t("message")}</p>
      <Link href="/dashboard" className="text-sm text-primary hover:underline">{t("back")}</Link>
    </div>
  );
}
