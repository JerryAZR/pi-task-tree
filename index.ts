/**
 * Task Tree Extension - Nested task list with completed tracking
 * Model: completed/deleted flags, parent completion rules, [⏳] derived display
 */

import { StringEnum } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

import { createTaskManager, type TaskManager } from "./src/task-manager";
import type { Task, DisplayState } from "./src/types";
import { TaskTreeError } from "./src/errors";

// TypeBox schemas for LLM parameters
const CreateListItemSchema = Type.Object({
  title: Type.String({ description: "Short task title" }),
  description: Type.Optional(Type.String({ description: "Detailed task description" })),
});

const TaskCreateRootParams = Type.Object({
  title: Type.String({ description: "Title for this task list" }),
  description: Type.Optional(Type.String({ description: "Optional description for the task list" })),
  items: Type.Array(CreateListItemSchema, { description: "Initial tasks for this list (required)" }),
});

const TaskBreakdownParams = Type.Object({
  items: Type.Array(CreateListItemSchema, { description: "Tasks to add" }),
  parent: Type.String({ description: "Parent task index to add subtasks under (e.g., '1' or '1.2')" }),
  mode: Type.Optional(StringEnum(["new", "append", "override", "insert"] as const, {
    description: "new: fails if children exist. append: adds to end. override: replaces. insert: inserts before 'before'."
  })),
  before: Type.Optional(Type.String({ description: "For insert mode: task index to insert before" })),
});

const TaskAddTaskParams = Type.Object({
  items: Type.Array(CreateListItemSchema, { description: "Tasks to add" }),
  mode: Type.Optional(StringEnum(["append", "override", "insert"] as const, {
    description: "append: adds to end. override: replaces. insert: inserts before 'before'."
  })),
  before: Type.Optional(Type.String({ description: "For insert mode: task index to insert before" })),
});

const TaskGetParams = Type.Object({
  indexOrTitle: Type.String({ description: "Task index (e.g., '1.2') or title to look up" }),
});

const TaskUpdateParams = Type.Object({
  index: Type.String({ description: "Task index or title to update" }),
  title: Type.Optional(Type.String({ description: "New title - omit to leave unchanged" })),
  description: Type.Optional(Type.String({ description: "New description - empty string clears" })),
});

const TaskCloseParams = Type.Object({
  index: Type.String({ description: "Task index or title to close" }),
  mode: StringEnum(["complete", "delete"] as const, { description: "complete: marks task done (fails if has incomplete children). delete: soft-deletes task and removes children." }),
});

const TaskListParams = Type.Object({
  mode: Type.Optional(StringEnum(["focus", "full"] as const, { description: "focus (default): shows working path. full: shows all." })),
});

// ============================================================================
// Display state helpers
// ============================================================================

function getDisplayState(task: Task): DisplayState {
  if (task.deleted) return "deleted";
  if (task.completed) return "completed";

  // Check if has completed children (derived in_progress)
  if (task.children && task.children.tasks.length > 0) {
    const hasCompletedChild = task.children.tasks.some(
      child => child.completed && !child.deleted
    );
    if (hasCompletedChild) return "in_progress";
  }

  return "pending";
}

const DISPLAY_ICONS: Record<DisplayState, string> = {
  pending: "[  ]",
  in_progress: "[⏳]",
  completed: "[✅]",
  deleted: "[🗑️]",
};

// ============================================================================
// Response formatting
// ============================================================================

function formatTaskBrief(task: Task): string {
  const state = getDisplayState(task);
  return `${task.index} ${DISPLAY_ICONS[state]} ${task.title}`;
}

function formatTaskDetail(task: Task, indent = ""): string {
  const lines: string[] = [];
  const state = getDisplayState(task);
  lines.push(`${indent}# TASK ${task.index}: ${task.title}`);
  lines.push(`${indent}> status: ${DISPLAY_ICONS[state]} ${state}`);
  lines.push(``); // Extra line before detailed description
  if (task.description) {
    lines.push(`${indent}${task.description}`);
  } else {
    lines.push(`${indent}(no description)`);
  }

  // Subtask list
  if (task.children && task.children.tasks.length > 0) {
    lines.push(``);
    lines.push(`${indent}## SubTask List`);
    for (const child of task.children.tasks) {
      lines.push(`${indent}- ${formatTaskBrief(child)}`);
    }
  }

  return lines.join("\n");
}

function formatListResult(result: { tree: Task[]; rootProgress: { completed: number; total: number } }): string {
  const lines: string[] = [];
  lines.push(`Tasks: ${result.rootProgress.completed}/${result.rootProgress.total} completed`);
  lines.push("");

  if (result.tree.length === 0) {
    lines.push("  (no tasks)");
    return lines.join("\n");
  }

  // doList already flattens the tree in DFS order
  // Depth = number of dots in index (1.1.1 = depth 2)
  for (const task of result.tree) {
    const depth = (task.index.match(/\./g) || []).length;
    const indent = "  ".repeat(depth);
    lines.push(`${indent}${formatTaskBrief(task)}`);
  }

  return lines.join("\n");
}

function formatGetResult(result: { task: Task; parent?: Task; root?: { title: string; description?: string } }): string {
  const lines: string[] = [];
  const { task, parent, root } = result;
  const state = getDisplayState(task);

  // 1. The task itself
  lines.push(`# TASK ${task.index}: ${task.title}`);
  lines.push(`> status: ${DISPLAY_ICONS[state]} ${state}`);
  lines.push("");
  if (task.description) {
    lines.push(task.description);
  } else {
    lines.push("(no description)");
  }

  // 2. Subtasks
  if (task.children && task.children.tasks.length > 0) {
    lines.push("");
    lines.push("## SubTasks");
    for (const child of task.children.tasks) {
      const childState = getDisplayState(child);
      lines.push(`- ${child.index} ${DISPLAY_ICONS[childState]} ${child.title}`);
    }
  }

  // 3. Parent context (skip synthetic root)
  if (parent && parent.index !== "root") {
    lines.push("");
    lines.push("## Parent");
    lines.push(`**${parent.title}**`);
    if (parent.description) {
      lines.push(parent.description);
    }
  }

  // 4. Siblings (from parent's children)
  if (parent && parent.children && parent.children.tasks.length > 0) {
    const siblings = parent.children.tasks.filter((t: Task) => !t.deleted);
    if (siblings.length > 1) {
      lines.push("");
      lines.push("## Siblings");
      for (const sib of siblings) {
        const marker = sib.index === task.index ? "→ " : "  ";
        const sibState = getDisplayState(sib);
        lines.push(`${marker}${sib.index} ${DISPLAY_ICONS[sibState]} ${sib.title}`);
      }
    }
  }

  // 5. Root/Project context (useful for any task to understand overall goal)
  if (root) {
    lines.push("");
    lines.push("## Project");
    lines.push(`**${root.title}**`);
    if (root.description) {
      lines.push(root.description);
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

        const m = getManager();
        const result = m.createRoot({
          title: p.title.trim(),
          description: typeof p.description === "string" ? p.description.trim() : undefined,
          items: p.items as { title: string; description?: string }[],
        });

        // Use tree from result (focused on first task) instead of full list
        const text = `Created task list: ${result.root.title}\n\n${formatListResult({ tree: result.tree, rootProgress: result.rootProgress })}`;
        return { content: [{ type: "text", text }] };
      } catch (error) {
        return handleError(error);
      }
    },
  });

  // task_extend_root
  pi.registerTool({
    name: "task_extend_root",
    label: "Extend Root",
    description: "Add tasks to the root level of the active plan. Use this to extend an existing plan.",
    promptSnippet: "Add tasks to an existing plan",
    promptGuidelines: [
      "Use this tool to add new tasks to the root level of the active plan",
      "Requires an active task list (created with task_create_root)",
      "Use task_breakdown to add subtasks under specific tasks"
    ],
    parameters: TaskAddTaskParams,

    async execute(_toolCallId: string, params: unknown, _signal: unknown, _onUpdate: unknown, _ctx: unknown) {
      try {
        const p = params as { items?: unknown; mode?: unknown };

        if (!Array.isArray(p.items) || p.items.length === 0) {
          throw new TaskTreeError("INVALID_INPUT", "items array with at least one task is required");
        }

        const count = p.items.length;
        const result = getManager().addTask({
          items: p.items as { title: string; description?: string }[],
          mode: p.mode as "append" | "override" | undefined,
        });

        const text = count === 1
          ? `Added 1 task`
          : `Added ${count} tasks`;

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
          items: p.items as { title: string; description?: string }[],
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
    description: "Update task title or description. Cannot update completed or deleted tasks.",
    promptSnippet: "Update title or description of a planned task",
    promptGuidelines: [
      "Use this tool to update the description or title of a pending task",
      "Cannot update completed or deleted tasks",
      "For evolving requirements, create new tasks instead of modifying completed ones"
    ],
    parameters: TaskUpdateParams,

    async execute(_toolCallId: string, params: unknown, _signal: unknown, _onUpdate: unknown, _ctx: unknown) {
      try {
        const p = params as { index?: unknown; title?: unknown; description?: unknown };
        const index = normalizeIndexOrTitle(p.index);
        // Empty string clears description, undefined leaves unchanged
        const description = typeof p.description === 'string'
          ? (p.description === '' ? undefined : p.description)
          : undefined;
        const result = getManager().update({ index, title: p.title as string | undefined, description });
        return { content: [{ type: "text", text: `Updated ${result.task.index}: ${result.task.title}` }] };
      } catch (error) {
        return handleError(error);
      }
    },
  });

  // task_close
  pi.registerTool({
    name: "task_close",
    label: "Task Close",
    description: "Close a task by completing or deleting it. Completed tasks are locked and cannot be modified.",
    promptSnippet: "Mark a task as completed or delete it",
    promptGuidelines: [
      "Use 'complete' to mark a finished task done",
      "Use 'delete' to remove a task and all its children",
      "Cannot complete a task that has incomplete children",
      "Completed tasks are locked - use task_extend_root or task_breakdown to add new tasks for changes"
    ],
    parameters: TaskCloseParams,

    async execute(_toolCallId: string, params: unknown, _signal: unknown, _onUpdate: unknown, _ctx: unknown) {
      try {
        const p = params as { index?: unknown; mode?: unknown };
        const index = normalizeIndexOrTitle(p.index);
        const mode = p.mode as "complete" | "delete";

        if (mode !== "complete" && mode !== "delete") {
          throw new TaskTreeError("INVALID_INPUT", "mode must be 'complete' or 'delete'");
        }

        const result = mode === "complete"
          ? getManager().complete({ index })
          : getManager().delete({ index });
        const text = mode === "complete"
          ? `Completed ${index}`
          : `Deleted ${index}`;
        return { content: [{ type: "text", text: `${text}\n\n${formatListResult(result)}` }] };
      } catch (error) {
        return handleError(error);
      }
    },
  });

  // task_list
  pi.registerTool({
    name: "task_list",
    label: "Task List",
    description: "Show tasks in focus (default) or full mode. Focus shows working path, full shows all.",
    promptSnippet: "Show tasks planned for this project",
    promptGuidelines: [
      "Use this tool to understand the progress made in this project",
      "Focus (default): Shows working path (first incomplete at each level)",
      "Full: Shows all tasks"
    ],
    parameters: TaskListParams,

    async execute(_toolCallId: string, params: unknown, _signal: unknown, _onUpdate: unknown, _ctx: unknown) {
      try {
        const p = params as { mode?: string } | null;
        const m = getManager();
        const result = m.list({
          mode: p?.mode as "focus" | "full" | undefined
        });
        return { content: [{ type: "text", text: formatListResult(result) }] };
      } catch (error) {
        return handleError(error);
      }
    },
  });
}
