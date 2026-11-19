import type { TaskStatus } from "@prisma/client";
import { ColorBadge } from "@/components/ui/badge";
import { TASK_STATUS_COLOR, TASK_STATUS_LABEL } from "@/server/domain/task-workflow";

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  return <ColorBadge color={TASK_STATUS_COLOR[status]}>{TASK_STATUS_LABEL[status]}</ColorBadge>;
}

export function ProgressBar({ percent, className }: { percent: number; className?: string }) {
  return (
    <div className={`h-2 w-full overflow-hidden rounded-full bg-muted ${className ?? ""}`} role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full bg-success transition-all" style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
    </div>
  );
}
