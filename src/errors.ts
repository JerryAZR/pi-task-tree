// Error types for task-tree

export class TaskTreeError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message);
    this.name = "TaskTreeError";
  }
}

export const ERRORS = {
  LIST_EXISTS: (parent: string | null) =>
    new TaskTreeError("LIST_EXISTS", `Children already exist under parent ${parent ?? "root"}. Use mode "append" or "override"`),
  
  TASK_COMPLETED: (index: string) =>
    new TaskTreeError("TASK_COMPLETED", `Cannot modify task "${index}" - it is completed or deleted`),
  
  NOT_FOUND: (query: string) =>
    new TaskTreeError("NOT_FOUND", `No task found matching "${query}"`),
  
  AMBIGUOUS: (query: string, matches: { index: string; title: string }[]) =>
    new TaskTreeError("AMBIGUOUS", `Title "${query}" matches multiple tasks: ${matches.map(m => m.index).join(", ")}`),
  
  ALREADY_COMPLETED: (index: string) =>
    new TaskTreeError("ALREADY_COMPLETED", `Task "${index}" is already completed`),

  ROOT_TASK: () =>
    new TaskTreeError("ROOT_TASK", "Cannot modify the synthetic root task"),

  NO_ACTIVE_ROOT: () =>
    new TaskTreeError("NO_ACTIVE_ROOT", "No active task list. Use task_create_root to create one first."),

  ROOT_NOT_FOUND: (id: string) =>
    new TaskTreeError("ROOT_NOT_FOUND", `No root list found with id "${id}"`),
} as const;

export type ErrorCode = keyof typeof ERRORS;
