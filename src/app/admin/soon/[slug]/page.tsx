import { Construction } from "lucide-react";
import { requireAdminPortal } from "@/server/auth/get-actor";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { getTranslations } from "next-intl/server";

const FEATURES: Record<string, [string, string, string]> = {
};

export default async function SoonPage({ params }: { params: Promise<{ slug: string }> }) {
  const tcfg = await getTranslations("cfg");
  await requireAdminPortal();
  const { slug } = await params;
  const [title, phase, desc] = FEATURES[slug] ?? [tcfg("comingSoon"), tcfg("laterPhase"), ""];
  return (
    <div>
      <PageHeader title={title} />
      <Card><CardContent><EmptyState icon={<Construction />} title={tcfg("plannedFor", { phase })} description={desc} /></CardContent></Card>
    </div>
  );
}
