import { Construction } from "lucide-react";
import { requireAdminPortal } from "@/server/auth/get-actor";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState, PageHeader } from "@/components/ui/misc";

const FEATURES: Record<string, [string, string, string]> = {
  "escalation-rules": ["Escalation Rules", "Phase 4", "Configure SLA warning/breach escalations (seeded rules are visible under SLA)."],
};

export default async function SoonPage({ params }: { params: Promise<{ slug: string }> }) {
  await requireAdminPortal();
  const { slug } = await params;
  const [title, phase, desc] = FEATURES[slug] ?? ["Coming soon", "a later phase", ""];
  return (
    <div>
      <PageHeader title={title} />
      <Card><CardContent><EmptyState icon={<Construction />} title={`Planned for ${phase}`} description={desc} /></CardContent></Card>
    </div>
  );
}
