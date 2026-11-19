import { notFound } from "next/navigation";
import { requireAdminPortal } from "@/server/auth/get-actor";
import { canWriteKb, kbOptions } from "@/server/services/kb";
import { PageHeader } from "@/components/ui/misc";
import { ArticleEditor } from "@/components/kb/kb-client";

export const metadata = { title: "New article" };

export default async function NewArticlePage() {
  const actor = await requireAdminPortal();
  if (!canWriteKb(actor)) notFound();
  return (
    <div className="space-y-5">
      <PageHeader title="New article" description="Articles start as drafts. A publisher reviews and publishes them." />
      <ArticleEditor categories={await kbOptions()} />
    </div>
  );
}
