// TaskManager - Core implementation for nested-todo
// Multi-root support with per-root persistence

import { mkdirSync, readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import type {
  Task,
  TaskStatus,
  Progress,
  TaskManager as ITaskManager,
  TaskStore,
  TaskList,
  ParallelGroup,
  CreateListItem,
  RootsManifest,
  Root,
  task_create_root,
  task_breakdown,
  task_activate_root,
  task_delete_root,
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

// Persistence directories (relative to cwd)
const PERSISTENCE_DIR = ".pi/task_tree";
const LISTS_DIR = "lists";
const ROOTS_FILE = "roots.jsonl";

// Persistence format for roots: JSON
// Persistence format for tasks: JSONL
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

// ============================================================================
// Persistence helpers
// ============================================================================

function getRootsPath(): string {
  return resolve(process.cwd(), PERSISTENCE_DIR, ROOTS_FILE);
}

function getListPath(id: string): string {
  return resolve(process.cwd(), PERSISTENCE_DIR, LISTS_DIR, `${id}.jsonl`);
}

function getListsDir(): string {
  return resolve(process.cwd(), PERSISTENCE_DIR, LISTS_DIR);
}

// Ensure directories exist
function ensurePersistenceDir(): void {
  mkdirSync(resolve(process.cwd(), PERSISTENCE_DIR), { recursive: true });
  mkdirSync(getListsDir(), { recursive: true });
}

// Load roots manifest
function loadRootsManifest(): RootsManifest {
  const path = getRootsPath();
  if (!existsSync(path)) {
    return { roots: [], activeId: null };
  }
  try {
    const content = readFileSync(path, "utf-8");
    return JSON.parse(content);
  } catch {
    return { roots: [], activeId: null };
  }
}

// Save roots manifest
function saveRootsManifest(manifest: RootsManifest): void {
  ensurePersistenceDir();
  const path = getRootsPath();
  writeFileSync(path, JSON.stringify(manifest, null, 2), "utf-8");
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

  lines.push(JSON.stringify({
    version: PERSISTENCE_VERSION,
    lastCompletedIndex,
  }));

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

// Load task state from file
function loadTasksFromFile(id: string): { lastCompletedIndex: string | null; tasks: Map<string, Task>; rootList: TaskList } | null {
  const path = getListPath(id);
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

// Save task state to file
function saveTasksToFile(id: string, lastCompletedIndex: string | null, tasks: Map<string, Task>): void {
  ensurePersistenceDir();
  const path = getListPath(id);
  writeFileSync(path, dumpState(lastCompletedIndex, tasks), "utf-8");
}

// Delete task state file
function deleteTasksFile(id: string): void {
  const path = getListPath(id);
  if (existsSync(path)) {
    unlinkSync(path);
  }
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

  function buildSubtree(parentIndex: string): TaskList {
    const result: Task[] = [];
    let childSuffix = 1;

    while (true) {
      const childIndex = parentIndex === ROOT_INDEX
        ? String(childSuffix)
        : `${parentIndex}.${childSuffix}`;

      const pTask = persistedTasks.get(childIndex);
      if (!pTask) {
        break;
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

  const rootList = buildSubtree(ROOT_INDEX);
  return { tasks: taskMap, rootList };
}

// Load state from dump string (for testing without file I/O)
export function loadFromDump(content: string): { lastCompletedIndex: string | null; tasks: Map<string, Task>; rootList: TaskList } {
  const { meta, tasks: persistedTasks } = parseDump(content);
  const { tasks: taskMap, rootList } = buildTreeFromTasks(persistedTasks);
  return { lastCompletedIndex: meta.lastCompletedIndex, tasks: taskMap, rootList };
}

function segmentIntoGroups(tasks: Task[], groupOffset: number = 0): ParallelGroup[] {
  const groups: ParallelGroup[] = [];
  let currentGroup: ParallelGroup | null = null;

  for (const task of tasks) {
    const label = task.groupLabel;

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

    const grp = currentGroup!;
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

// Helper: Find a task by title (exact match)
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

  return tasks.get(matches[0].index)!;
}

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
    return false;
  } else if (mode === "override") {
    if (existingChildren) {
      for (const oldTask of existingChildren.tasks) {
        tasks.delete(oldTask.index);
      }
    }
    return false;
  }
  return hasChildren ?? false;
}

function generateAndCreateTasks(
  items: CreateListItem[],
  scopePrefix: string,
  startIndex: number
): Task[] {
  const taskObjects: Task[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const index = scopePrefix + String(startIndex + i);

    taskObjects.push({
      index,
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

function firstGroupShouldBeReady(
  isAppending: boolean,
  parentIndex: string,
  existingChildren: TaskList | undefined,
  parentStatus: TaskStatus | undefined
): boolean {
  if (!isAppending) {
    return parentIndex === ROOT_INDEX || parentStatus === "ready";
  }
  return !existingChildren!.tasks.some(t => t.status !== "completed");
}

function updateParentChildren(
  parentIndex: string,
  parentTask: Task | undefined,
  taskList: TaskList,
  tasks: Map<string, Task>,
  store: TaskStore
): void {
  if (parentIndex === ROOT_INDEX) {
    store.rootList = taskList;
    tasks.get(ROOT_INDEX)!.children = taskList;
  } else {
    parentTask!.children = taskList;
  }
}

function findVirtualTarget(tasks: Map<string, Task>): string {
  let depth = 1;
  while (true) {
    const candidate = "1".repeat(depth).split("").join(".");
    if (!tasks.has(candidate)) {
      return candidate;
    }
    depth *= 2;
  }
}

function unblockChildren(parent: Task): void {
  if (!parent.children || parent.children.tasks.length === 0) {
    return;
  }

  const children = parent.children.tasks;
  const firstGroupIndex = children.length > 0 ? children[0].groupIndex : -1;

  for (const child of children) {
    if (child.status === "pending" && child.groupIndex === firstGroupIndex) {
      child.status = "ready";
      unblockChildren(child);
    }
  }
}

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

function unblockNextGroup(task: Task, store: TaskStore, tasks: Map<string, Task>): void {
  const parentIndex = task.parentIndex;
  const parentChildren = parentIndex === ROOT_INDEX
    ? store.rootList
    : tasks.get(parentIndex)!.children!;

  const taskGroupIndex = task.groupIndex;
  const sameGroupTasks = parentChildren.tasks.filter(t => t.groupIndex === taskGroupIndex);

  if (!sameGroupTasks.every(t => t.status === "completed")) {
    return;
  }

  const nextGroupIndex = taskGroupIndex + 1;
  const nextGroupTasks = parentChildren.tasks.filter(t => t.groupIndex === nextGroupIndex);

  for (const nextTask of nextGroupTasks) {
    nextTask.status = "ready";
    unblockChildren(nextTask);
  }
}

function createSyntheticRootTask(rootList: TaskList): Task {
  return {
    index: ROOT_INDEX,
    parentIndex: "",
    title: "Root",
    description: "Synthetic root task - parent of all root-level tasks. Do not modify.",
    status: "ready",
    groupIndex: -1,
    children: rootList,
  };
}

// Generate timestamp-based ID
function generateRootId(): string {
  return String(Date.now());
}

// ============================================================================
// TaskManager
// ============================================================================

export function createTaskManager(): ITaskManager {
  const isTest = process.env.NODE_ENV === "test";

  // Load roots manifest
  let manifest = isTest ? { roots: [], activeId: null } : loadRootsManifest();

  // Load active root if exists
  let activeId: string | null = manifest.activeId;
  let loaded = activeId && !isTest ? loadTasksFromFile(activeId) : null;
  let lastCompletedIndex: string | null = loaded?.lastCompletedIndex ?? null;

  let tasks: Map<string, Task>;
  let rootList: TaskList;

  if (loaded) {
    tasks = loaded.tasks;
    rootList = loaded.rootList;
  } else {
    rootList = emptyTaskList();
    tasks = new Map();
  }

  const syntheticRoot = createSyntheticRootTask(rootList);
  tasks.set(ROOT_INDEX, syntheticRoot);

  const store: TaskStore = {
    rootList,
    indexMap: tasks,
    lastCompletedIndex,
    getTask(index: string): Task | undefined {
      return tasks.get(index);
    },
  };

  // Persist tasks
  function persistTasks(): void {
    if (isTest || !activeId) return;
    saveTasksToFile(activeId, lastCompletedIndex, tasks);
  }

  // Persist manifest
  function persistManifest(): void {
    if (isTest) return;
    saveRootsManifest(manifest);
  }

  // Helper to execute createList logic
  function doCreateList(items: CreateListItem[], parent: string | null | undefined, mode: string): { tree: Task[]; rootProgress: Progress } {
    const parentIndex = parent ?? ROOT_INDEX;
    const parentTask = tasks.get(parentIndex);

    if (!parentTask) {
      throw new Error(
        `INTERNAL ERROR: Parent task "${parentIndex}" not found in task map. ` +
        `This indicates a bug in task initialization.`
      );
    }

    if (parentTask.status === "completed") {
      throw ERRORS.TASK_COMPLETED(parentIndex);
    }

    const existingChildren = parentTask.children;
    const isAppending = validateModeAndPreprocess(mode, parentIndex, existingChildren, tasks);

    const scopePrefix = parentIndex === ROOT_INDEX ? "" : parentIndex + ".";
    const existingCount = existingChildren?.tasks.length ?? 0;
    const startIndex = isAppending ? existingCount + 1 : 1;

    const taskObjects = generateAndCreateTasks(items, scopePrefix, startIndex);

    for (const task of taskObjects) {
      tasks.set(task.index, task);
    }

    const groupOffset = isAppending ? (existingChildren?.groups.length ?? 0) : 0;
    const newGroups = segmentIntoGroups(taskObjects, groupOffset);

    if (newGroups.length > 0 && firstGroupShouldBeReady(isAppending, parentIndex, existingChildren, parentTask?.status)) {
      for (const taskIndex of newGroups[0].taskIndices) {
        const task = tasks.get(taskIndex);
        if (task) {
          task.status = "ready";
        }
      }
    }

    const allChildren = isAppending
      ? [...existingChildren!.tasks, ...taskObjects]
      : taskObjects;

    const allGroups = isAppending
      ? [...existingChildren!.groups, ...newGroups]
      : newGroups;

    const taskList: TaskList = {
      tasks: allChildren,
      groups: allGroups,
    };

    updateParentChildren(parentIndex, parentTask, taskList, tasks, store);

    return doList("focus");
  }

  // Helper to execute list logic
  function doList(listMode: string): { tree: Task[]; rootProgress: Progress } {
    const mode = listMode || "focus";
    const rootListLocal = store.rootList;
    const rootProgress = {
      completed: rootListLocal.tasks.filter(t => t.status === "completed").length,
      total: rootListLocal.tasks.length,
    };

    if (rootListLocal.tasks.length === 0) {
      return { tree: [], rootProgress };
    }

    let targetIndex: string | null = lastCompletedIndex;

    if (mode === "focus") {
      if (!targetIndex) {
        targetIndex = findVirtualTarget(tasks);
      }
    }

    const tree: Task[] = [];

    if (mode === "focus" && targetIndex) {
      function dfs(children: TaskList | undefined) {
        if (!children) return;

        for (const task of children.tasks) {
          const isOnPath = targetIndex!.startsWith(task.index + ".");
          tree.push(task);
          if (isOnPath && task.children) {
            dfs(task.children);
          }
        }
      }
      dfs(rootListLocal);
    } else {
      function dfs(children: TaskList | undefined) {
        if (!children) return;

        for (const task of children.tasks) {
          tree.push(task);
          if (task.children) {
            dfs(task.children);
          }
        }
      }
      dfs(rootListLocal);
    }

    return { tree, rootProgress };
  }

  // Helper to load a root
  function loadRoot(id: string): void {
    const loadedData = loadTasksFromFile(id);
    if (loadedData) {
      lastCompletedIndex = loadedData.lastCompletedIndex;
      tasks = loadedData.tasks;
      rootList = loadedData.rootList;
      const root = createSyntheticRootTask(rootList);
      tasks.set(ROOT_INDEX, root);
      store.rootList = rootList;
      store.indexMap = tasks;
      store.lastCompletedIndex = lastCompletedIndex;
    } else {
      lastCompletedIndex = null;
      rootList = emptyTaskList();
      tasks = new Map();
      const root = createSyntheticRootTask(rootList);
      tasks.set(ROOT_INDEX, root);
      store.rootList = rootList;
      store.indexMap = tasks;
      store.lastCompletedIndex = null;
    }
    activeId = id;
  }

  // Helper to switch to a different root
  function switchToRoot(id: string): void {
    // Save current root if exists
    if (activeId) {
      saveTasksToFile(activeId, lastCompletedIndex, tasks);
    }
    // Load new root
    loadRoot(id);
    manifest.activeId = id;
    persistManifest();
  }

  return {
    getState(): TaskStore {
      return store;
    },

    getTaskStatus(index: string): TaskStatus | undefined {
      return tasks.get(index)?.status;
    },

    // Root management
    createRoot(params: task_create_root): { root: Root; rootProgress: Progress } {
      const { title, description, items } = params;
      const id = generateRootId();
      const root: Root = {
        id,
        title,
        description,
        createdAt: Date.now(),
      };

      manifest.roots.push(root);
      manifest.activeId = id;
      persistManifest();

      // Initialize empty task state for this root
      loadRoot(id);

      // Create initial tasks (items is required)
      const result = doCreateList(items, undefined, "new");

      // Save after creating tasks
      persistTasks();

      return { root, rootProgress: result.rootProgress };
    },

    breakdown(params: task_breakdown): { tree: Task[]; rootProgress: Progress } {
      if (!activeId) {
        throw ERRORS.NO_ACTIVE_ROOT();
      }

      const { items, parent, mode = "new" } = params;
      return doCreateList(items, parent, mode);
    },

    // Legacy createList - requires active root
    createList(params: { items: CreateListItem[]; parent?: string | null; mode?: string }): { tree: Task[]; rootProgress: Progress } {
      if (!activeId) {
        throw ERRORS.NO_ACTIVE_ROOT();
      }
      const { items, parent, mode = "new" } = params;
      return doCreateList(items, parent, mode);
    },

    listRoots(): { roots: Root[]; activeId: string | null } {
      return { roots: manifest.roots, activeId: manifest.activeId };
    },

    activateRoot(params: task_activate_root): { roots: Root[]; activeId: string | null } {
      const { id } = params;
      const root = manifest.roots.find(r => r.id === id);
      if (!root) {
        throw ERRORS.ROOT_NOT_FOUND(id);
      }
      switchToRoot(id);
      return { roots: manifest.roots, activeId: manifest.activeId };
    },

    deleteRoot(params: task_delete_root): { roots: Root[]; activeId: string | null } {
      const { id } = params;
      const index = manifest.roots.findIndex(r => r.id === id);
      if (index === -1) {
        throw ERRORS.ROOT_NOT_FOUND(id);
      }

      // If deleting active root, switch to another or clear
      if (activeId === id) {
        deleteTasksFile(id);
        manifest.roots.splice(index, 1);
        manifest.activeId = manifest.roots.length > 0 ? manifest.roots[0].id : null;
        persistManifest();

        if (manifest.activeId) {
          loadRoot(manifest.activeId);
        } else {
          activeId = null;
          rootList = emptyTaskList();
          tasks = new Map();
          const root = createSyntheticRootTask(rootList);
          tasks.set(ROOT_INDEX, root);
          store.rootList = rootList;
          store.indexMap = tasks;
          store.lastCompletedIndex = null;
        }
      } else {
        deleteTasksFile(id);
        manifest.roots.splice(index, 1);
        persistManifest();
      }

      return { roots: manifest.roots, activeId: manifest.activeId };
    },

    // Task operations
    get(params: task_get): task_get_result {
      const { query } = params;

      let task: Task | undefined = tasks.get(query);

      if (!task) {
        task = findTaskByTitle(tasks, query);
      }

      if (task.index === ROOT_INDEX) {
        const getTasksFromIndices = (indices: string[]): Task[] =>
          indices.map(idx => tasks.get(idx)!).filter(Boolean);
        const groups = store.rootList.groups;
        return {
          task,
          parent: undefined,
          previousGroup: [],
          currentGroup: getTasksFromIndices(groups.flatMap(g => g.taskIndices)),
          nextGroup: [],
        };
      }

      const parent = tasks.get(task.parentIndex);
      if (!parent) {
        throw new Error(
          `INTERNAL ERROR: Parent "${task.parentIndex}" of task "${task.index}" not found.`
        );
      }

      const parentChildren = parent.children;
      if (!parentChildren || parentChildren.groups.length === 0) {
        throw new Error(
          `INTERNAL ERROR: Parent "${task.parentIndex}" does not own task "${task.index}".`
        );
      }

      const groups = parentChildren.groups;
      const taskGroupIndex = task.groupIndex;

      if (taskGroupIndex < 0 || taskGroupIndex >= groups.length) {
        throw new Error(`Invalid groupIndex ${taskGroupIndex} for task ${task.index}`);
      }

      const getTasksFromIndices = (indices: string[]): Task[] =>
        indices.map(idx => tasks.get(idx)!).filter(Boolean);

      const previousGroup = taskGroupIndex > 0
        ? getTasksFromIndices(groups[taskGroupIndex - 1].taskIndices)
        : [];

      const currentGroup = getTasksFromIndices(groups[taskGroupIndex].taskIndices);

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

      let task: Task | undefined = tasks.get(index);

      if (!task) {
        task = findTaskByTitle(tasks, index);
      }

      if (task.index === ROOT_INDEX) {
        throw ERRORS.ROOT_TASK();
      }

      if (task.status === "completed") {
        throw ERRORS.TASK_COMPLETED(task.index);
      }

      if (title !== undefined) {
        task.title = title;
      }

      if (description !== undefined) {
        task.description = description ?? undefined;
      }

      persistTasks();

      return { task };
    },

    complete(params: task_complete): { tree: Task[]; rootProgress: Progress } {
      const { index } = params;

      let task: Task | undefined = tasks.get(index);

      if (!task) {
        task = findTaskByTitle(tasks, index);
      }

      canComplete(task);

      task.status = "completed";
      lastCompletedIndex = task.index;
      store.lastCompletedIndex = lastCompletedIndex;

      unblockNextGroup(task, store, tasks);
      persistTasks();

      return doList("focus");
    },

    list(params: task_list): { tree: Task[]; rootProgress: Progress } {
      return doList(params.mode ?? "focus");
    },
  };
}
