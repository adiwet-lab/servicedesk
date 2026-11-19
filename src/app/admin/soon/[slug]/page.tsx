import { Construction } from "lucide-react";
import { requireAdminPortal } from "@/server/auth/get-actor";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState, PageHeader } from "@/components/ui/misc";

const FEATURES: Record<string, [string, string, string]> = {
  "all-tasks": ["All Tasks", "Phase 2", "Admin view of every sub-task across tickets and teams."],
  "my-tasks": ["My Tasks", "Phase 2", "Tasks assigned to you, with due dates and overdue highlighting."],
  "team-tasks": ["Team Tasks", "Phase 2", "Team lead view of tasks owned by your teams."],
  "overdue-tasks": ["Overdue Tasks", "Phase 2", "Tasks past their due date."],
  "escalation-rules": ["Escalation Rules", "Phase 4", "Configure SLA warning/breach escalations (seeded rules are visible under SLA)."],
  "notification-settings": ["Notification Settings", "Phase 3", "Per-event channel configuration (in-app, email, Microsoft Teams)."],
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
