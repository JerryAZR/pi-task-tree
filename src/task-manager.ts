// TaskManager - Core implementation for nested-todo
// In-memory TaskStore with file persistence

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type {
  Task,
  TaskStatus,
  Progress,
  TaskManager as ITaskManager,
  TaskStore,
  TaskList,
  ParallelGroup,
  task_create_list,
  task_get,
  task_get_result,
  task_update,
  task_update_result,
  task_complete,
  task_complete_result,
  task_list,
  task_list_result,
} from "./types";
import { ROOT_INDEX } from "./types";
import { ERRORS } from "./errors";

// Persistence directory and file (relative to cwd)
const PERSISTENCE_DIR = ".pi/task_tree";
const PERSISTENCE_FILE = "state.jsonl";

// Persistence format: JSONL
// Line 1: metadata (version, lastCompletedIndex)
// Remaining lines: one task per line

interface PersistedMeta {
  version: number;
  lastCompletedIndex: string | null;
}

interface PersistedTask {
  index: string;
  parentIndex: string;
  title: string;
  description?: string;
  status: TaskStatus;
  groupIndex: number;
  groupLabel?: string;
}

const PERSISTENCE_VERSION = 1;

function getPersistencePath(): string {
  return resolve(process.cwd(), PERSISTENCE_DIR, PERSISTENCE_FILE);
}

// Parse JSONL dump string into metadata + task map
function parseDump(content: string): { meta: PersistedMeta; tasks: Map<string, PersistedTask> } {
  const lines = content.split("\n").filter(l => l.trim());

  if (lines.length === 0) {
    throw new Error("Empty file");
  }

  const meta: PersistedMeta = JSON.parse(lines[0]);
  const tasks = new Map<string, PersistedTask>();

  for (let i = 1; i < lines.length; i++) {
    const task: PersistedTask = JSON.parse(lines[i]);
    tasks.set(task.index, task);
  }

  return { meta, tasks };
}

// Serialize state to JSONL dump string
function dumpState(lastCompletedIndex: string | null, tasks: Map<string, Task>): string {
  const lines: string[] = [];

  // Line 1: metadata
  lines.push(JSON.stringify({
    version: PERSISTENCE_VERSION,
    lastCompletedIndex,
  }));

  // DFS traversal to write tasks in order
  const rootList = getRootList(tasks);
  if (rootList) {
    function dfsChildren(taskList: TaskList) {
      for (const task of taskList.tasks) {
        lines.push(JSON.stringify({
          index: task.index,
          parentIndex: task.parentIndex,
          title: task.title,
          description: task.description,
          status: task.status,
          groupIndex: task.groupIndex,
          groupLabel: task.groupLabel,
        }));
        if (task.children) {
          dfsChildren(task.children);
        }
      }
    }
    dfsChildren(rootList);
  }

  return lines.join("\n");
}

// Reconstruct groups from stored groupIndex (source of truth)
function reconstructGroups(tasks: Task[]): ParallelGroup[] {
  const groups = new Map<number, Task[]>();

  for (const task of tasks) {
    if (!groups.has(task.groupIndex)) {
      groups.set(task.groupIndex, []);
    }
    groups.get(task.groupIndex)!.push(task);
  }

  const sortedPositions = Array.from(groups.keys()).sort((a, b) => a - b);
  return sortedPositions.map(pos => {
    const groupTasks = groups.get(pos)!;
    groupTasks.sort((a, b) => a.index.localeCompare(b.index, undefined, { numeric: true }));
    return {
      position: pos,
      label: groupTasks[0]?.groupLabel,
      taskIndices: groupTasks.map(t => t.index),
      isComplete: groupTasks.every(t => t.status === "completed"),
    };
  });
}

// Factory for empty TaskList (new instance each time to avoid shared mutation)
function emptyTaskList(): TaskList {
  return { tasks: [], groups: [] };
}

// Build tree from persisted task map (discover children by index prediction)
function buildTreeFromTasks(persistedTasks: Map<string, PersistedTask>): { tasks: Map<string, Task>; rootList: TaskList } {
  const taskMap = new Map<string, Task>();

  // Recursive builder - predict next child index, try map lookup, stop on miss
  // Root children: "1", "2", "3" (no prefix)
  // Other children: "parent.1", "parent.2", "parent.3"
  function buildSubtree(parentIndex: string): TaskList {
    const result: Task[] = [];
    let childSuffix = 1;

    while (true) {
      const childIndex = parentIndex === ROOT_INDEX
        ? String(childSuffix)  // Root: "1", "2", "3"
        : `${parentIndex}.${childSuffix}`;  // Others: "parent.1", "parent.2"

      const pTask = persistedTasks.get(childIndex);
      if (!pTask) {
        break;  // No more children
      }

      const task: Task = {
        index: pTask.index,
        parentIndex: pTask.parentIndex,
        title: pTask.title,
        description: pTask.description,
        status: pTask.status,
        groupIndex: pTask.groupIndex,
        groupLabel: pTask.groupLabel,
      };

      taskMap.set(task.index, task);

      // Recursively build children
      const childList = buildSubtree(pTask.index);
      if (childList.tasks.length > 0) {
        task.children = childList;
      }

      result.push(task);
      childSuffix++;
    }

    return {
      tasks: result,
      groups: reconstructGroups(result),
    };
  }

  // Start from root - find root-level children (indices "1", "2", "3", ...)
  const rootList = buildSubtree(ROOT_INDEX);

  return { tasks: taskMap, rootList };
}

function loadFromFile(): { lastCompletedIndex: string | null; tasks: Map<string, Task>; rootList: TaskList } | null {
  const path = getPersistencePath();
  if (!existsSync(path)) {
    return null;
  }
  try {
    const content = readFileSync(path, "utf-8");
    return loadFromDump(content);
  } catch (err) {
    console.error(`[nested-todo] Failed to load state from ${path}:`, err);
    return null;
  }
}

function saveToFile(lastCompletedIndex: string | null, tasks: Map<string, Task>): void {
  const path = getPersistencePath();
  try {
    mkdirSync(resolve(process.cwd(), PERSISTENCE_DIR), { recursive: true });
    writeFileSync(path, dumpState(lastCompletedIndex, tasks), "utf-8");
  } catch (err) {
    console.error(`[nested-todo] Failed to save state to ${path}:`, err);
  }
}

// Load state from dump string (for testing without file I/O)
export function loadFromDump(content: string): { lastCompletedIndex: string | null; tasks: Map<string, Task>; rootList: TaskList } {
  const { meta, tasks: persistedTasks } = parseDump(content);
  const { tasks: taskMap, rootList } = buildTreeFromTasks(persistedTasks);

  // Ensure root task exists - it may be missing if the persistence file
  if (!taskMap.has(ROOT_INDEX)) {
    const rootTask: Task = {
      index: ROOT_INDEX,
      parentIndex: "",
      title: "Root",
      status: "ready",
      groupIndex: -1,
      children: rootList,
    };
    taskMap.set(ROOT_INDEX, rootTask);
  }

  return { lastCompletedIndex: meta.lastCompletedIndex, tasks: taskMap, rootList };
}

function segmentIntoGroups(tasks: Task[], groupOffset: number = 0): ParallelGroup[] {
  const groups: ParallelGroup[] = [];
  let currentGroup: ParallelGroup | null = null;

  for (const task of tasks) {
    const label = task.groupLabel;

    // Start new group if: no current group OR current has no label OR labels differ
    const shouldStartNewGroup = !currentGroup ||
      currentGroup.label === undefined ||
      label !== currentGroup.label;

    if (shouldStartNewGroup) {
      if (currentGroup) {
        groups.push(currentGroup);
      }
      currentGroup = {
        label,
        taskIndices: [],
        isComplete: false,
      };
    }

    // currentGroup is now guaranteed to be non-null (non-null assertion)
    const grp = currentGroup!;

    // Update task's groupIndex to match the group's position (plus offset for existing groups)
    task.groupIndex = groups.length + groupOffset;

    grp.taskIndices.push(task.index);
  }

  if (currentGroup) {
    groups.push(currentGroup);
  }

  return groups;
}

function getRootList(tasks: Map<string, Task>): TaskList {
  const rootTask = tasks.get(ROOT_INDEX);
  return rootTask?.children ?? emptyTaskList();
}

// Helper: Find a task by title (exact match). Returns Task if unique, throws if ambiguous or not found.
function findTaskByTitle(tasks: Map<string, Task>, title: string): Task {
  const matches: { index: string; title: string }[] = [];

  for (const [idx, t] of tasks) {
    if (t.title === title) {
      matches.push({ index: idx, title: t.title });
    }
  }

  if (matches.length === 0) {
    throw ERRORS.NOT_FOUND(title);
  }

  if (matches.length > 1) {
    throw ERRORS.AMBIGUOUS(title, matches);
  }

  // matches.length === 1, task must exist in map
  return tasks.get(matches[0].index)!;
}

// Helper: Validate mode and return whether starting fresh or appending
function validateModeAndPreprocess(
  mode: string,
  parentIndex: string,
  existingChildren: TaskList | undefined,
  tasks: Map<string, Task>
): boolean {
  const hasChildren = existingChildren && existingChildren.tasks.length > 0;

  if (mode === "new") {
    if (hasChildren) {
      throw ERRORS.LIST_EXISTS(parentIndex);
    }
    return false; // starting fresh
  } else if (mode === "override") {
    if (existingChildren) {
      for (const oldTask of existingChildren.tasks) {
        tasks.delete(oldTask.index);
      }
    }
    return false; // starting fresh
  }
  // "append" mode
  return hasChildren ?? false;
}

// Helper: Validate indices and build task objects
function validateAndCreateTasks(
  items: task_create_list["items"],
  scopePrefix: string,
  startIndex: number
): Task[] {
  const taskObjects: Task[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const expectedIndex = scopePrefix + String(startIndex + i);

    // Validate exact index match
    if (item.index !== expectedIndex) {
      throw ERRORS.OUT_OF_ORDER(item.index, expectedIndex);
    }

    // Build task object
    taskObjects.push({
      index: item.index,
      parentIndex: scopePrefix === "" ? ROOT_INDEX : scopePrefix.slice(0, -1),
      title: item.title,
      description: item.description,
      groupLabel: item.parallelGroup,
      groupIndex: 0,
      status: "pending",
    });
  }

  return taskObjects;
}

// Helper: Check if first new group should be ready
function firstGroupShouldBeReady(
  isAppending: boolean,
  parentIndex: string,
  existingChildren: TaskList | undefined,
  parentStatus: TaskStatus | undefined
): boolean {
  if (!isAppending) {
    // Starting fresh: ready if parent is ready (for non-root), or always ready for root
    return parentIndex === ROOT_INDEX || parentStatus === "ready";
  }

  // Appending: starting a new group. Ready only if all existing are complete.
  return !existingChildren!.tasks.some(t => t.status !== "completed");
}

// Helper: Update parent's children reference
function updateParentChildren(
  parentIndex: string,
  parentTask: Task | undefined,
  taskList: TaskList,
  tasks: Map<string, Task>,
  store: TaskStore
): void {
  if (parentIndex === ROOT_INDEX) {
    // Update both store rootList and root task's children
    store.rootList = taskList;
    tasks.get(ROOT_INDEX)!.children = taskList;
  } else {
    parentTask!.children = taskList;
  }
}

// Helper: Find virtual target - an all-"1"s index not in the map
// Used for focus mode to find the oldest leaf position
function findVirtualTarget(tasks: Map<string, Task>): string {
  let depth = 1;
  while (true) {
    const candidate = "1".repeat(depth).split("").join(".");
    if (!tasks.has(candidate)) {
      return candidate;
    }
    // Exponential growth: 1, 2, 4, 8, 16, ...
    depth *= 2;
  }
}

// Helper: Recursively unblock children when a task becomes ready/completed
// Marks first group children as ready (inheriting parent status), others stay pending
function unblockChildren(parent: Task): void {
  if (!parent.children || parent.children.tasks.length === 0) {
    return;
  }

  // Mark first group children as ready
  const children = parent.children.tasks;
  const firstGroupIndex = children.length > 0 ? children[0].groupIndex : -1;

  for (const child of children) {
    if (child.status === "pending" && child.groupIndex === firstGroupIndex) {
      child.status = "ready";
      // Recursively unblock this child's children
      unblockChildren(child);
    }
    // Other groups stay pending
  }
}

// Helper: Check if a task can be completed, throw if not
function canComplete(task: Task): void {
  if (task.status === "completed") {
    throw ERRORS.ALREADY_COMPLETED(task.index);
  }

  if (task.status !== "ready") {
    throw ERRORS.NOT_READY(task.index, "task is not in ready state");
  }

  if (task.children && task.children.tasks.length > 0) {
    const incomplete = task.children.tasks
      .filter(t => t.status !== "completed")
      .map(t => t.index);

    if (incomplete.length > 0) {
      throw ERRORS.CHILDREN_INCOMPLETE(task.index, incomplete);
    }
  }
}

// Helper: Unblock next parallel group when current group is complete
function unblockNextGroup(task: Task, store: TaskStore, tasks: Map<string, Task>): void {
  // Get parent's children (must exist - we got this task from its parent)
  const parentIndex = task.parentIndex;
  const parentChildren = parentIndex === ROOT_INDEX
    ? store.rootList
    : tasks.get(parentIndex)!.children!;

  // Check if all tasks in current group are completed
  const taskGroupIndex = task.groupIndex;
  const sameGroupTasks = parentChildren.tasks.filter(t => t.groupIndex === taskGroupIndex);

  if (!sameGroupTasks.every(t => t.status === "completed")) {
    return; // Group not complete yet
  }

  // Unblock next group's tasks
  const nextGroupIndex = taskGroupIndex + 1;
  const nextGroupTasks = parentChildren.tasks.filter(t => t.groupIndex === nextGroupIndex);

  for (const nextTask of nextGroupTasks) {
    nextTask.status = "ready";
    // Recursively unblock children
    unblockChildren(nextTask);
  }
}

export function createTaskManager(): ITaskManager {
  // Skip persistence during tests
  const isTest = process.env.NODE_ENV === "test";

  // Load persisted state (skip during tests)
  // Tree is reconstructed in DFS order during load
  const loaded = isTest ? null : loadFromFile();
  let lastCompletedIndex: string | null = loaded?.lastCompletedIndex ?? null;

  let tasks: Map<string, Task>;
  let rootList: TaskList;

  if (loaded) {
    tasks = loaded.tasks;
    rootList = loaded.rootList;
  } else {
    // Initialize with empty root
    rootList = emptyTaskList();
    const rootTask: Task = {
      index: ROOT_INDEX,
      parentIndex: "",
      title: "Root",
      status: "ready",
      groupIndex: -1,
      children: rootList,
    };
    tasks = new Map([[ROOT_INDEX, rootTask]]);
  }

  // TaskStore implementation
  const store: TaskStore = {
    rootList,
    indexMap: tasks,
    lastCompletedIndex,
    getTask(index: string): Task | undefined {
      return tasks.get(index);
    },
  };

  // Write to file on state changes (skip during tests)
  function persist(): void {
    if (isTest) return;
    saveToFile(lastCompletedIndex, tasks);
  }

  return {
    getState(): TaskStore {
      return store;
    },

    getTaskStatus(index: string): TaskStatus | undefined {
      return tasks.get(index)?.status;
    },

    createList(params: task_create_list): task_list_result {
      const { items, parent, mode = "new" } = params;

      // parent is expected to be string or undefined (root level)
      const parentIndex = parent ?? ROOT_INDEX;
      const parentTask = tasks.get(parentIndex);
      // Root task must always exist - if it doesn't, something is wrong
      if (!parentTask) {
        throw new Error(
          `INTERNAL ERROR: Parent task "${parentIndex}" not found in task map. ` +
          `This indicates a bug in task initialization or persistence loading. ` +
          `Task map size: ${tasks.size}, Has ROOT_INDEX: ${tasks.has(ROOT_INDEX)}`
        );
      }
      if (parentTask.status === "completed") {
        throw ERRORS.TASK_COMPLETED(parentIndex);
      }
      const existingChildren = parentTask.children;

      // Preprocess: validate mode, delete old children if override
      const isAppending = validateModeAndPreprocess(mode, parentIndex, existingChildren, tasks);

      // Calculate scope prefix and starting index
      const scopePrefix = parentIndex === ROOT_INDEX ? "" : parentIndex + ".";
      const existingCount = existingChildren?.tasks.length ?? 0;
      const startIndex = isAppending ? existingCount + 1 : 1;

      // Validate indices and create task objects
      const taskObjects = validateAndCreateTasks(items, scopePrefix, startIndex);

      // Add new tasks to indexMap (but don't set groupIndex yet)
      for (const task of taskObjects) {
        tasks.set(task.index, task);
      }

      // Determine group offset for new tasks
      const groupOffset = isAppending ? (existingChildren?.groups.length ?? 0) : 0;

      // Segment new tasks into groups (with offset for existing groups)
      // Note: segmentIntoGroups sets groupIndex on each task
      const newGroups = segmentIntoGroups(taskObjects, groupOffset);

      // Determine if first new group should be ready
      if (newGroups.length > 0 && firstGroupShouldBeReady(isAppending, parentIndex, existingChildren, parentTask?.status)) {
        // Mark first new group's tasks as ready
        for (const taskIndex of newGroups[0].taskIndices) {
          const task = tasks.get(taskIndex);
          if (task) {
            task.status = "ready";
          }
        }
      }

      // Build final children list
      const allChildren = isAppending
        ? [...existingChildren!.tasks, ...taskObjects]
        : taskObjects;

      // Concatenate existing groups with new groups
      const allGroups = isAppending
        ? [...existingChildren!.groups, ...newGroups]
        : newGroups;

      const taskList: TaskList = {
        tasks: allChildren,
        groups: allGroups,
      };

      // Update parent's children reference
      updateParentChildren(parentIndex, parentTask, taskList, tasks, store);

      // Persist and return
      persist();
      return this.list({ mode: "focus" });
    },

    get(params: task_get): task_get_result {
      const { query } = params;

      // Find task by index or title
      let task: Task | undefined = tasks.get(query);

      if (!task) {
        // Search by title (throws if not found or ambiguous)
        task = findTaskByTitle(tasks, query);
      }

      // Root task: return early with all root-level children
      if (task.index === ROOT_INDEX) {
        const getTasksFromIndices = (indices: string[]): Task[] =>
          indices.map(idx => tasks.get(idx)!).filter(Boolean);
        const groups = store.rootList.groups;
        return {
          task,
          parent: undefined,
          previousGroup: [],
          currentGroup: getTasksFromIndices(
            groups.flatMap(g => g.taskIndices)
          ),
          nextGroup: [],
        };
      }

      // Non-root tasks must have a valid parent
      const parent = tasks.get(task.parentIndex);
      if (!parent) {
        throw new Error(
          `INTERNAL ERROR: Parent "${task.parentIndex}" of task "${task.index}" not found. ` +
          `All non-root tasks must have a valid parent.`
        );
      }

      const parentChildren = parent.children;
      if (!parentChildren || parentChildren.groups.length === 0) {
        return { task, parent, previousGroup: [], currentGroup: [], nextGroup: [] };
      }

      const groups = parentChildren.groups;
      const taskGroupIndex = task.groupIndex;

      // Validate groupIndex is valid
      if (taskGroupIndex < 0 || taskGroupIndex >= groups.length) {
        throw new Error(`Invalid groupIndex ${taskGroupIndex} for task ${task.index}. Groups length: ${groups.length}`);
      }

      // Get tasks from indices
      const getTasksFromIndices = (indices: string[]): Task[] =>
        indices.map(idx => tasks.get(idx)!).filter(Boolean);

      // Previous group
      const previousGroup = taskGroupIndex > 0
        ? getTasksFromIndices(groups[taskGroupIndex - 1].taskIndices)
        : [];

      // Current group
      const currentGroup = getTasksFromIndices(groups[taskGroupIndex].taskIndices);

      // Next group
      const nextGroup = taskGroupIndex < groups.length - 1
        ? getTasksFromIndices(groups[taskGroupIndex + 1].taskIndices)
        : [];

      return {
        task,
        parent,
        previousGroup,
        currentGroup,
        nextGroup,
      };
    },

    update(params: task_update): task_update_result {
      const { index, title, description } = params;

      // Find task by index or title
      let task: Task | undefined = tasks.get(index);

      if (!task) {
        // Search by title (throws if not found or ambiguous)
        task = findTaskByTitle(tasks, index);
      }

      // Reject if task is completed
      if (task.status === "completed") {
        throw ERRORS.TASK_COMPLETED(task.index);
      }

      // Update fields if provided
      if (title !== undefined) {
        task.title = title;
      }

      if (description !== undefined) {
        task.description = description ?? undefined;
      }

      // Persist changes
      persist();

      return { task };
    },

    complete(params: task_complete): task_complete_result {
      const { index } = params;

      // 1. Find task by index or title
      let task: Task | undefined = tasks.get(index);

      if (!task) {
        // Search by title (throws if not found or ambiguous)
        task = findTaskByTitle(tasks, index);
      }

      // 2. Validate task can be completed
      canComplete(task);

      // 3. Mark task as completed
      task.status = "completed";

      // 4. Update lastCompletedIndex in store
      lastCompletedIndex = task.index;
      store.lastCompletedIndex = lastCompletedIndex;

      // 5. Unblock next group if current group is complete
      unblockNextGroup(task, store, tasks);

      // 6. Persist changes
      persist();

      // 7. Return result
      return this.list({ mode: "focus" });
    },

    list(params: task_list): task_list_result {
      const { mode = "focus" } = params;

      // Calculate root progress
      const rootList = store.rootList;
      const rootProgress = {
        completed: rootList.tasks.filter(t => t.status === "completed").length,
        total: rootList.tasks.length,
      };

      // Get root-level children
      if (rootList.tasks.length === 0) {
        return { tree: [], rootProgress };
      }

      // For focus mode, determine the target (last completed task or oldest leaf)
      let targetIndex: string | null = lastCompletedIndex;

      if (mode === "focus") {
        if (!targetIndex) {
          // Find virtual target: an all-"1"s index that doesn't exist
          // This represents the "oldest leaf" position
          targetIndex = findVirtualTarget(tasks);
        }
      }

      // Build the result tree
      const tree: Task[] = [];

      if (mode === "focus" && targetIndex) {
        // Focus mode: show all tasks, but only expand path to target
        function dfs(children: TaskList | undefined) {
          if (!children) return;

          for (const task of children.tasks) {
            // Task is on path if target starts with task.index + "." (task is ancestor of target)
            const isOnPath = targetIndex!.startsWith(task.index + ".");

            // Always push task, recurse only if on path
            tree.push(task);
            if (isOnPath && task.children) {
              dfs(task.children);
            }
          }
        }

        dfs(rootList);
      } else {
        // Full mode: DFS of all tasks
        function dfs(children: TaskList | undefined) {
          if (!children) return;

          for (const task of children.tasks) {
            tree.push(task);
            if (task.children) {
              dfs(task.children);
            }
          }
        }

        dfs(rootList);
      }

      return { tree, rootProgress };
    },
  };
}
