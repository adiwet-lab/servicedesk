import type { TaskStatus } from "@prisma/client";

/** Task lifecycle (fixed per specification; ticket statuses remain admin-configurable). */
export const TASK_STATUSES: TaskStatus[] = ["OPEN", "ASSIGNED", "IN_PROGRESS", "WAITING", "COMPLETED", "CANCELLED"];
export const TASK_TERMINAL: TaskStatus[] = ["COMPLETED", "CANCELLED"];

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  OPEN: "Open", ASSIGNED: "Assigned", IN_PROGRESS: "In Progress", WAITING: "Waiting", COMPLETED: "Completed", CANCELLED: "Cancelled",
};
export const TASK_STATUS_COLOR: Record<TaskStatus, string> = {
  OPEN: "#3b82f6", ASSIGNED: "#6366f1", IN_PROGRESS: "#f59e0b", WAITING: "#a855f7", COMPLETED: "#10b981", CANCELLED: "#64748b",
};

const TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  OPEN: ["IN_PROGRESS", "CANCELLED"], // OPEN → ASSIGNED happens through assignment, not manually
  ASSIGNED: ["IN_PROGRESS", "WAITING", "CANCELLED"],
  IN_PROGRESS: ["WAITING", "COMPLETED", "CANCELLED"],
  WAITING: ["IN_PROGRESS", "CANCELLED"],
  COMPLETED: ["IN_PROGRESS"], // reopen — owner-team staff only
  CANCELLED: [],
};

export function allowedTaskTransitions(from: TaskStatus, opts: { canReopen: boolean }): TaskStatus[] {
  return from === "COMPLETED" && !opts.canReopen ? [] : TRANSITIONS[from];
}

export function taskStatusRequiresReason(to: TaskStatus) {
  return to === "WAITING" || to === "CANCELLED";
}

/** Returns an error message or null. */
export function validateTaskTransition(from: TaskStatus, to: TaskStatus, opts: { canReopen: boolean; reason?: string | null }): string | null {
  if (from === to) return "The task is already in that status.";
  if (!TRANSITIONS[from].includes(to)) return `A task cannot move from ${TASK_STATUS_LABEL[from]} to ${TASK_STATUS_LABEL[to]}.`;
  if (from === "COMPLETED" && !opts.canReopen) return "Only the owning team can reopen a completed task.";
  if (taskStatusRequiresReason(to) && !opts.reason?.trim()) return `A reason is required to set the task to ${TASK_STATUS_LABEL[to]}.`;
  return null;
}

export function isTaskOverdue(task: { dueDate: Date | null; status: TaskStatus }, now = new Date()): boolean {
  return !!task.dueDate && task.dueDate < now && !TASK_TERMINAL.includes(task.status);
}

export interface TaskProgress {
  total: number;
  completed: number;
  required: number;
  requiredCompleted: number;
  openRequired: number;
  optional: number;
  cancelled: number;
  percent: number;
}

/** Progress counts; cancelled tasks are excluded from the denominator. */
export function ticketTaskProgress(tasks: { isRequired: boolean; status: TaskStatus }[]): TaskProgress {
  const live = tasks.filter((t) => t.status !== "CANCELLED");
  const completed = live.filter((t) => t.status === "COMPLETED").length;
  const required = live.filter((t) => t.isRequired);
  const requiredCompleted = required.filter((t) => t.status === "COMPLETED").length;
  return {
    total: live.length,
    completed,
    required: required.length,
    requiredCompleted,
    openRequired: required.length - requiredCompleted,
    optional: live.length - required.length,
    cancelled: tasks.length - live.length,
    percent: live.length ? Math.round((completed / live.length) * 100) : 0,
  };
}
