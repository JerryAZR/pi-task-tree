/**
 * Task Tree Extension - Nested task list with parallel groups and focus mode
 *
 * Features:
 * - task_create_list: Create tasks with indices and parallel groups
 * - task_get: Query task details with group context
 * - task_update: Update task title/description
 * - task_complete: Mark task completed (with unblocking logic)
 * - task_list: List tasks in focus or full mode
 *
 * State is persisted to `.task-tree.jsonl` in the project directory.
 */

import { StringEnum } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

import { createTaskManager, type TaskManager } from "./src/task-manager";
import type {
  task_create_list,
  task_get,
  task_get_result,
  task_update,
  task_complete,
  task_list,
  task_list_result,
  Task,
} from "./src/types";
import { TaskTreeError } from "./src/errors";

// TypeBox schemas for LLM parameters
const CreateListItemSchema = Type.Object({
  index: Type.String({
    description: "Hierarchical task identifier using dot notation (e.g., '1', '1.1', '1.2.1')"
  }),
  title: Type.String({ description: "Short task title" }),
  description: Type.Optional(Type.String({ description: "Detailed task description" })),
  parallelGroup: Type.Optional(Type.String({
    description: "Parallel group tag - Mark tasks in the list that can run together with the same tag. Omit to enforce ordering"
  })),
});

const TaskCreateListParams = Type.Object({
  items: Type.Array(CreateListItemSchema, { description: "Tasks to create. Leave empty and use the override mode to delete the old list" }),
  parent: Type.Optional(Type.String({
    description: "Parent task index to create subtasks under (e.g., '1' for the list ['1.1, '1.2', ...]). Use to breakdown an existing task. Omit for root level tasks"
  })),
  mode: Type.Optional(StringEnum(["new", "append", "override"] as const, {
    description: "Creation mode: new (default), append, or override" })),
});

const TaskGetParams = Type.Object({
  query: Type.String({ description: "Task index (e.g. '1.2') or title to look up" }),
});

const TaskUpdateParams = Type.Object({
  index: Type.String({ description: "Task index or title to update" }),
  title: Type.Optional(Type.String({ description: "New title to change to" })),
  description: Type.Optional(Type.Union([Type.String(), Type.Null()] as const, { description: "New description, or null to clear" })),
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

/**
 * Format a single task as brief line: "index - title [status]"
 */
function formatTaskBrief(task: Task): string {
  const statusIcon = task.status === "completed" ? "[x]" : task.status === "ready" ? "[ ]" : "[...]";
  const group = task.groupIndex >= 0 ? ` group:${task.groupIndex}` : "";
  return `${task.index} ${statusIcon} ${task.title}${group}`;
}

/**
 * Format a task for get result (detailed): shows all fields
 */
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

/**
 * Format list result as indented tree
 */
function formatListResult(result: task_list_result, showChildren = true): string {
  const lines: string[] = [];

  // Header with progress
  lines.push(`Tasks: ${result.rootProgress.completed}/${result.rootProgress.total} completed`);
  lines.push("");

  if (result.tree.length === 0) {
    lines.push("  (no tasks)");
    return lines.join("\n");
  }

  function formatTask(t: Task, depth: number): void {
    const indent = "  ".repeat(depth);
    lines.push(`${indent}${formatTaskBrief(t)}`);

    // Show children inline if present
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

/**
 * Format get result (detailed)
 */
function formatGetResult(result: task_get_result): string {
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

  pi.on("session_start", async (event: { reason: string }, _ctx: ExtensionContext) => {
    // reason: "startup" | "reload" | "new" | "resume" | "fork"
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

  function normalizeCreateListInput(params: { items?: unknown; parent?: unknown; mode?: unknown }): task_create_list {
    if (!params.items || !Array.isArray(params.items)) {
      throw new TaskTreeError("INVALID_INPUT", "items array is required");
    }

    const parent = params.parent === null || params.parent === "" ? undefined : params.parent as string | undefined;

    return {
      items: params.items as task_create_list["items"],
      parent,
      mode: params.mode as task_create_list["mode"],
    };
  }

  function normalizeQueryInput(query: unknown): string {
    if (query === null || query === undefined || query === "") {
      throw new TaskTreeError("INVALID_INPUT", "Query (task index or title) is required");
    }
    return String(query).trim();
  }

  // task_create_list
  pi.registerTool({
    name: "task_create_list",
    label: "Task Create List",
    description: "Create, extend, or override a hierarchical task list.",
    promptSnippet: "Manage a task list for TODO items",
    promptGuidelines: [
      "Use this tool to organize multi-step tasks before taking actions",
      "Also use this tool to breakdown a complex task into multiple subtasks",
      "Subtasks under the same parent run sequentially unless tagged with parallelGroup",
      "Use 'new' mode to create a fresh list under the selected parent task",
      "Use 'append' mode to add tasks to an existing list",
      "Use 'override' mode to replace any task list under the selected parent",
      "Use 'override' mode with an empty task list as input to delete an old list"
    ],
    parameters: TaskCreateListParams,

    async execute(_toolCallId: string, params: unknown, _signal: unknown, _onUpdate: unknown, _ctx: unknown) {
      try {
        const normalized = normalizeCreateListInput(params as { items?: unknown; parent?: unknown; mode?: unknown });
        const count = normalized.items.length;

        if (count === 0) {
          getManager().createList(normalized);
          return { content: [{ type: "text", text: `Cleared children under ${normalized.parent ?? "root"}` }] };
        }

        getManager().createList(normalized);
        const text = count === 1
          ? `Created: ${normalized.items[0].index} ${normalized.items[0].title}`
          : `Created ${count} tasks: ${normalized.items.map(i => i.index).join(", ")}`;
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
        const query = normalizeQueryInput((params as { query?: unknown }).query);
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
        const index = normalizeQueryInput(p.index);
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
        const index = normalizeQueryInput((params as { index?: unknown }).index);
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
      "Use 'focus' mode to get a partial tree view centered on recent work, surfacing upcoming tasks",
      "Use 'full' mode to get the complete tree view of all planned tasks"
    ],
    parameters: TaskListParams,

    async execute(_toolCallId: string, params: unknown, _signal: unknown, _onUpdate: unknown, _ctx: unknown) {
      try {
        const m = getManager();
        const result = m.list((params ?? { mode: "focus" }) as task_list);
        return { content: [{ type: "text", text: formatListResult(result) }] };
      } catch (error) {
        return handleError(error);
      }
    },
  });
}
