export const PROJECT_TASK_STATUSES = ["backlog", "in_progress", "blocked", "complete"] as const;
export type ProjectTaskStatus = (typeof PROJECT_TASK_STATUSES)[number];

export const PROJECT_TASK_PRIORITIES = ["urgent", "high", "normal", "low"] as const;
export type ProjectTaskPriority = (typeof PROJECT_TASK_PRIORITIES)[number];

export const PROJECT_TASK_STATUS_LABELS: Record<ProjectTaskStatus, string> = {
  backlog: "Backlog",
  in_progress: "In progress",
  blocked: "Blocked",
  complete: "Complete",
};

export const PROJECT_TASK_PRIORITY_LABELS: Record<ProjectTaskPriority, string> = {
  urgent: "Urgent",
  high: "High",
  normal: "Normal",
  low: "Low",
};

export interface ProjectTask {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly status: ProjectTaskStatus;
  readonly priority: ProjectTaskPriority | null;
  /** Initials, e.g. "AM". */
  readonly assignees: ReadonlyArray<string>;
  readonly tags: ReadonlyArray<string>;
  /** `YYYY-MM-DD`. */
  readonly dueDate: string | null;
}

export interface ProjectBoard {
  readonly id: string;
  readonly name: string;
  readonly tasks: ReadonlyArray<ProjectTask>;
}
