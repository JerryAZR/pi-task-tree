/**
 * Task Tree Extension - Nested task list with parallel groups and focus mode
 *
 * Features:
 * - task_create_root: Create a new named task list (root)
 * - task_breakdown: Add tasks under an existing parent
 * - task_update: Update task title/description
 * - task_complete: Mark task completed (with unblocking logic)
 * - task_list: List tasks in focus or full mode
 * - task_get: Query task details with group context
 *
 * State is persisted to .pi/task_tree/ in the project directory.
 */

import { StringEnum } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

import { createTaskManager, type TaskManager } from "./src/task-manager";
import type {
  Task,
} from "./src/types";
import { TaskTreeError } from "./src/errors";

// TypeBox schemas for LLM parameters
const CreateListItemSchema = Type.Object({
  title: Type.String({ description: "Short task title" }),
  description: Type.Optional(Type.String({ description: "Detailed task description" })),
  parallelGroup: Type.Optional(Type.String({
    description: "Tag for parallel execution - tasks with the same tag can be worked on simultaneously. Sequential tasks have no tag (default)."
  })),
});

const TaskCreateRootParams = Type.Object({
  title: Type.String({ description: "Title for this task list" }),
  description: Type.Optional(Type.String({ description: "Optional description for the task list" })),
  items: Type.Array(CreateListItemSchema, { description: "Initial tasks for this list (required)" }),
});

const TaskBreakdownParams = Type.Object({
  items: Type.Array(CreateListItemSchema, { description: "Tasks to add" }),
  parent: Type.String({ description: "Parent task index to add subtasks under (e.g., '1' or '1.2')" }),
  mode: Type.Optional(StringEnum(["new", "append", "override"] as const, {
    description: "Mode: new (fails if children exist), append (adds), override (replaces)"
  })),
});

const TaskGetParams = Type.Object({
  indexOrTitle: Type.String({ description: "Task index (e.g., '1.2') or title to look up" }),
});

const TaskUpdateParams = Type.Object({
  index: Type.String({ description: "Task index or title to update" }),
  title: Type.Optional(Type.String({ description: "New title - omit to leave unchanged" })),
  description: Type.Optional(Type.Union([Type.String(), Type.Null()] as const, { description: "New description - omit to leave unchanged, null to clear" })),
});

const TaskCompleteParams = Type.Object({
  index: Type.String({ description: "Task index or title to complete" }),
});

const TaskListParams = Type.Object({
  mode: Type.Optional(StringEnum(["focus", "full"] as const, { description: "List mode: focus (default, shows recent work) or full (shows all tasks)" })),
});

// ============================================================================
// Response formatting (LLM-friendly plain text)
// ============================================================================

function formatTaskBrief(task: Task): string {
  const statusIcon = task.status === "completed" ? "[x]" : task.status === "ready" ? "[ ]" : "[...]";
  const group = task.groupIndex >= 0 ? ` group:${task.groupIndex}` : "";
  return `${task.index} ${statusIcon} ${task.title}${group}`;
}

function formatTaskDetail(task: Task, indent = ""): string {
  const lines: string[] = [];
  lines.push(`${indent}index:    ${task.index}`);
  lines.push(`${indent}title:    ${task.title}`);
  lines.push(`${indent}status:   ${task.status}`);
  if (task.description) {
    lines.push(`${indent}desc:     ${task.description}`);
  }
  if (task.groupLabel) {
    lines.push(`${indent}group:    ${task.groupLabel} (position ${task.groupIndex})`);
  }
  return lines.join("\n");
}

function formatListResult(result: { tree: Task[]; rootProgress: { completed: number; total: number } }, showChildren = true): string {
  const lines: string[] = [];
  lines.push(`Tasks: ${result.rootProgress.completed}/${result.rootProgress.total} completed`);
  lines.push("");

  if (result.tree.length === 0) {
    lines.push("  (no tasks)");
    return lines.join("\n");
  }

  function formatTask(t: Task, depth: number): void {
    const indent = "  ".repeat(depth);
    lines.push(`${indent}${formatTaskBrief(t)}`);

    if (showChildren && t.children && t.children.tasks.length > 0) {
      for (const child of t.children.tasks) {
        formatTask(child, depth + 1);
      }
    }
  }

  for (const task of result.tree) {
    formatTask(task, 0);
  }

  return lines.join("\n");
}

function formatGetResult(result: { task: Task; parent?: Task; previousGroup: Task[]; currentGroup: Task[]; nextGroup: Task[] }): string {
  const lines: string[] = [];

  lines.push("Task:");
  lines.push(formatTaskDetail(result.task, "  "));

  if (result.parent) {
    lines.push("");
    lines.push("Parent:");
    lines.push(formatTaskDetail(result.parent, "  "));
  }

  if (result.previousGroup.length > 0) {
    lines.push("");
    lines.push("Previous group:");
    for (const t of result.previousGroup) {
      lines.push(`  ${formatTaskBrief(t)}`);
    }
  }

  if (result.currentGroup.length > 0) {
    lines.push("");
    lines.push("Current group:");
    for (const t of result.currentGroup) {
      lines.push(`  ${formatTaskBrief(t)}`);
    }
  }

  if (result.nextGroup.length > 0) {
    lines.push("");
    lines.push("Next group:");
    for (const t of result.nextGroup) {
      lines.push(`  ${formatTaskBrief(t)}`);
    }
  }

  return lines.join("\n");
}

// ============================================================================
// Adapter
// ============================================================================

export default function (pi: ExtensionAPI) {
  let manager: TaskManager | null = null;

  function getManager(): TaskManager {
    if (!manager) {
      manager = createTaskManager();
    }
    return manager;
  }

  pi.on("session_start", async (_event: { reason: string }, _ctx: ExtensionContext) => {
    manager = createTaskManager();
  });
  pi.on("session_tree", async (_event: unknown, _ctx: ExtensionContext) => {
    manager = createTaskManager();
  });

  function handleError(error: unknown): { content: { type: "text"; text: string }[] } {
    if (error instanceof TaskTreeError) {
      return {
        content: [{ type: "text", text: `Error: ${error.code} - ${error.message}` }],
      };
    }
    throw error;
  }

  function normalizeIndexOrTitle(input: unknown): string {
    if (input === null || input === undefined || input === "") {
      throw new TaskTreeError("INVALID_INPUT", "Task index or title is required");
    }
    return String(input).trim();
  }

  // task_create_root
  pi.registerTool({
    name: "task_create_root",
    label: "Task Create Root",
    description: "Create a new named task list (root). Each root is a separate workspace.",
    promptSnippet: "Create a new task list for planning",
    promptGuidelines: [
      "Use this tool to start a new planning session",
      "Provide a descriptive title for the plan",
      "Include initial tasks to break down the work"
    ],
    parameters: TaskCreateRootParams,

    async execute(_toolCallId: string, params: unknown, _signal: unknown, _onUpdate: unknown, _ctx: unknown) {
      try {
        const p = params as { title?: unknown; description?: unknown; items?: unknown };
        
        if (!p.title || typeof p.title !== "string") {
          throw new TaskTreeError("INVALID_INPUT", "title is required");
        }
        
        if (!Array.isArray(p.items) || p.items.length === 0) {
          throw new TaskTreeError("INVALID_INPUT", "items array with at least one task is required");
        }
        
        const result = getManager().createRoot({
          title: p.title.trim(),
          description: typeof p.description === "string" ? p.description.trim() : undefined,
          items: p.items as { title: string; description?: string; parallelGroup?: string }[],
        });

        const text = `Created task list: ${result.root.title}\n\n${formatListResult(result)}`;
        return { content: [{ type: "text", text }] };
      } catch (error) {
        return handleError(error);
      }
    },
  });

  // task_breakdown
  pi.registerTool({
    name: "task_breakdown",
    label: "Task Breakdown",
    description: "Add subtasks under an existing parent task. Requires an active task list.",
    promptSnippet: "Break down tasks into subtasks",
    promptGuidelines: [
      "Use this tool to break down complex tasks into smaller steps",
      "Specify the parent task index to add subtasks under",
      "Tasks are auto-indexed based on position"
    ],
    parameters: TaskBreakdownParams,

    async execute(_toolCallId: string, params: unknown, _signal: unknown, _onUpdate: unknown, _ctx: unknown) {
      try {
        const p = params as { items?: unknown; parent?: unknown; mode?: unknown };
        
        if (!Array.isArray(p.items)) {
          throw new TaskTreeError("INVALID_INPUT", "items array is required");
        }
        
        if (!p.parent || typeof p.parent !== "string") {
          throw new TaskTreeError("INVALID_INPUT", "parent (task index) is required");
        }
        
        const count = p.items.length;
        const result = getManager().breakdown({
          items: p.items as { title: string; description?: string; parallelGroup?: string }[],
          parent: p.parent.trim(),
          mode: p.mode as "new" | "append" | "override" | undefined,
        });

        const text = count === 1
          ? `Added 1 task under ${p.parent}`
          : `Added ${count} tasks under ${p.parent}`;
        
        return { content: [{ type: "text", text }] };
      } catch (error) {
        return handleError(error);
      }
    },
  });

  // task_get
  pi.registerTool({
    name: "task_get",
    label: "Task Get",
    description: "Get task details by index or title",
    promptSnippet: "Get the details of a planned task",
    promptGuidelines: [
      "Use this tool to retrieve details of a planned task for execution or review"
    ],
    parameters: TaskGetParams,

    async execute(_toolCallId: string, params: unknown, _signal: unknown, _onUpdate: unknown, _ctx: unknown) {
      try {
        const query = normalizeIndexOrTitle((params as { indexOrTitle?: unknown }).indexOrTitle);
        const result = getManager().get({ query });
        return { content: [{ type: "text", text: formatGetResult(result) }] };
      } catch (error) {
        return handleError(error);
      }
    },
  });

  // task_update
  pi.registerTool({
    name: "task_update",
    label: "Task Update",
    description: "Update task title or description",
    promptSnippet: "Update title or description of a planned task",
    promptGuidelines: [
      "Use this tool to update the description or title of a planned task"
    ],
    parameters: TaskUpdateParams,

    async execute(_toolCallId: string, params: unknown, _signal: unknown, _onUpdate: unknown, _ctx: unknown) {
      try {
        const p = params as { index?: unknown; title?: unknown; description?: unknown };
        const index = normalizeIndexOrTitle(p.index);
        const description = p.description === null ? null : p.description as string | undefined;
        const result = getManager().update({ index, title: p.title as string | undefined, description });
        return { content: [{ type: "text", text: `Updated ${result.task.index}: ${result.task.title}` }] };
      } catch (error) {
        return handleError(error);
      }
    },
  });

  // task_complete
  pi.registerTool({
    name: "task_complete",
    label: "Task Complete",
    description: "Mark a task as completed",
    promptSnippet: "Mark the completion of a planned task",
    promptGuidelines: [
      "Use this tool to mark a finished task as 'completed' in the task list"
    ],
    parameters: TaskCompleteParams,

    async execute(_toolCallId: string, params: unknown, _signal: unknown, _onUpdate: unknown, _ctx: unknown) {
      try {
        const index = normalizeIndexOrTitle((params as { index?: unknown }).index);
        const result = getManager().complete({ index });
        const text = `Completed ${index}\n\n${formatListResult(result, false)}`;
        return { content: [{ type: "text", text }] };
      } catch (error) {
        return handleError(error);
      }
    },
  });

  // task_list
  pi.registerTool({
    name: "task_list",
    label: "Task List",
    description: "Show an overview of recent tasks or all tasks",
    promptSnippet: "Show tasks planned for this project",
    promptGuidelines: [
      "Use this tool to understand the progress made in this project",
      "Use 'focus' mode to view the recently completed or unblocked tasks",
      "Use 'full' mode to view the complete tree of all planned tasks"
    ],
    parameters: TaskListParams,

    async execute(_toolCallId: string, params: unknown, _signal: unknown, _onUpdate: unknown, _ctx: unknown) {
      try {
        const m = getManager();
        const result = m.list((params ?? { mode: "focus" }) as { mode?: string });
        return { content: [{ type: "text", text: formatListResult(result) }] };
      } catch (error) {
        return handleError(error);
      }
    },
  });
}
