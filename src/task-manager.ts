// TaskManager - Core implementation for nested-todo
// Model: completed/deleted flags, parent completion rules, [⏳] derived display

import { mkdirSync, readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import type {
  Task,
  DisplayState,
  Progress,
  TaskManager as ITaskManager,
  TaskStore,
  TaskList,
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
  task_close,
  task_close_result,
  task_list,
  task_list_result,
} from "./types";
import { ROOT_INDEX } from "./types";
import { ERRORS } from "./errors";
import { TaskTreeError } from "./errors";

const PERSISTENCE_DIR = ".pi/task_tree";
const LISTS_DIR = "lists";
const ROOTS_FILE = "roots.jsonl";

interface PersistedMeta {
  version: number;
  lastCompletedIndex: string | null;
}

interface PersistedTask {
  index: string;
  parentIndex: string;
  title: string;
  description?: string;
  completed: boolean;
  deleted: boolean;
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

function ensurePersistenceDir(): void {
  mkdirSync(resolve(process.cwd(), PERSISTENCE_DIR), { recursive: true });
  mkdirSync(getListsDir(), { recursive: true });
}

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

function saveRootsManifest(manifest: RootsManifest): void {
  ensurePersistenceDir();
  const path = getRootsPath();
  writeFileSync(path, JSON.stringify(manifest, null, 2), "utf-8");
}

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
          completed: task.completed,
          deleted: task.deleted,
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

function saveTasksToFile(id: string, lastCompletedIndex: string | null, tasks: Map<string, Task>): void {
  ensurePersistenceDir();
  const path = getListPath(id);
  writeFileSync(path, dumpState(lastCompletedIndex, tasks), "utf-8");
}

function deleteTasksFile(id: string): void {
  const path = getListPath(id);
  if (existsSync(path)) {
    unlinkSync(path);
  }
}

function emptyTaskList(): TaskList {
  return { tasks: [] };
}

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
        completed: pTask.completed,
        deleted: pTask.deleted,
      };

      taskMap.set(task.index, task);

      const childList = buildSubtree(pTask.index);
      if (childList.tasks.length > 0) {
        task.children = childList;
      }

      result.push(task);
      childSuffix++;
    }

    return { tasks: result };
  }

  const rootList = buildSubtree(ROOT_INDEX);
  return { tasks: taskMap, rootList };
}

export function loadFromDump(content: string): { lastCompletedIndex: string | null; tasks: Map<string, Task>; rootList: TaskList } {
  const { meta, tasks: persistedTasks } = parseDump(content);
  const { tasks: taskMap, rootList } = buildTreeFromTasks(persistedTasks);
  return { lastCompletedIndex: meta.lastCompletedIndex, tasks: taskMap, rootList };
}

function getRootList(tasks: Map<string, Task>): TaskList {
  const rootTask = tasks.get(ROOT_INDEX);
  return rootTask?.children ?? emptyTaskList();
}

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

function generateRootId(): string {
  return String(Date.now());
}

function createSyntheticRootTask(rootList: TaskList): Task {
  return {
    index: ROOT_INDEX,
    parentIndex: "",
    title: "Root",
    description: "Synthetic root task - parent of all root-level tasks. Do not modify.",
    completed: false,
    deleted: false,
    children: rootList,
  };
}

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

function hasPendingChildren(task: Task): boolean {
  if (!task.children || task.children.tasks.length === 0) {
    return false;
  }
  return task.children.tasks.some(
    child => !child.completed && !child.deleted
  );
}

function deleteTaskAndDescendants(task: Task, tasks: Map<string, Task>): void {
  if (task.children) {
    for (const child of task.children.tasks) {
      deleteTaskAndDescendants(child, tasks);
    }
  }
  tasks.delete(task.index);
}

// ============================================================================
// TaskManager
// ============================================================================

export function createTaskManager(): ITaskManager {
  const isTest = process.env.NODE_ENV === "test";

  let manifest = isTest ? { roots: [], activeId: null } : loadRootsManifest();
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

  function persistTasks(): void {
    if (isTest || !activeId) return;
    saveTasksToFile(activeId, lastCompletedIndex, tasks);
  }

  function persistManifest(): void {
    if (isTest) return;
    saveRootsManifest(manifest);
  }

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

  function switchToRoot(id: string): void {
    if (activeId) {
      saveTasksToFile(activeId, lastCompletedIndex, tasks);
    }
    loadRoot(id);
    manifest.activeId = id;
    persistManifest();
  }

  function doCreateList(items: CreateListItem[], parent: string | null | undefined, mode: string): { tree: Task[]; rootProgress: Progress } {
    const parentIndex = parent ?? ROOT_INDEX;
    const parentTask = tasks.get(parentIndex);

    if (!parentTask) {
      throw new Error(`INTERNAL ERROR: Parent task "${parentIndex}" not found in task map.`);
    }

    if (parentTask.completed || parentTask.deleted) {
      throw ERRORS.TASK_COMPLETED(parentIndex);
    }

    const existingChildren = parentTask.children;
    const hasChildren = existingChildren && existingChildren.tasks.length > 0;

    if (mode === "new" && hasChildren) {
      throw ERRORS.LIST_EXISTS(parentIndex);
    } else if (mode === "override" && existingChildren) {
      for (const oldTask of existingChildren.tasks) {
        deleteTaskAndDescendants(oldTask, tasks);
      }
    }

    const scopePrefix = parentIndex === ROOT_INDEX ? "" : parentIndex + ".";
    const existingCount = existingChildren?.tasks.length ?? 0;
    const startIndex = mode === "append" ? existingCount + 1 : 1;

    const taskObjects: Task[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const index = scopePrefix + String(startIndex + i);

      const task: Task = {
        index,
        parentIndex: scopePrefix === "" ? ROOT_INDEX : scopePrefix.slice(0, -1),
        title: item.title,
        description: item.description,
        completed: false,
        deleted: false,
      };
      tasks.set(task.index, task);
      taskObjects.push(task);
    }

    const allChildren = mode === "append" && existingChildren
      ? [...existingChildren.tasks, ...taskObjects]
      : taskObjects;

    const taskList: TaskList = { tasks: allChildren };

    if (parentIndex === ROOT_INDEX) {
      store.rootList = taskList;
      tasks.get(ROOT_INDEX)!.children = taskList;
    } else {
      parentTask.children = taskList;
    }

    return doList("full");
  }

  function doList(listMode: string): { tree: Task[]; rootProgress: Progress } {
    const mode = listMode || "focus";
    const rootListLocal = store.rootList;

    // Count non-deleted tasks
    const activeTasks = rootListLocal.tasks.filter(t => !t.deleted);
    const rootProgress = {
      completed: activeTasks.filter(t => t.completed).length,
      total: activeTasks.length,
    };

    if (activeTasks.length === 0) {
      return { tree: [], rootProgress };
    }

    const tree: Task[] = [];

    function dfs(children: TaskList | undefined, includeAll: boolean) {
      if (!children) return;
      for (const task of children.tasks) {
        // Skip deleted tasks in focus mode
        if (mode === "focus" && task.deleted) continue;
        tree.push(task);
        if (task.children) {
          dfs(task.children, includeAll);
        }
      }
    }

    dfs(rootListLocal, mode === "full");

    return { tree, rootProgress };
  }

  return {
    getState(): TaskStore {
      return store;
    },

    isCompleted(index: string): boolean | undefined {
      return tasks.get(index)?.completed;
    },

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

      loadRoot(id);

      const result = doCreateList(items, undefined, "new");
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

    get(params: task_get): task_get_result {
      const { query } = params;

      let task: Task | undefined = tasks.get(query);

      if (!task) {
        task = findTaskByTitle(tasks, query);
      }

      if (task.index === ROOT_INDEX) {
        return {
          task,
          children: store.rootList.tasks.filter(t => !t.deleted),
        };
      }

      const parent = tasks.get(task.parentIndex);
      if (!parent) {
        throw new Error(`INTERNAL ERROR: Parent "${task.parentIndex}" of task "${task.index}" not found.`);
      }

      return {
        task,
        parent,
        children: task.children?.tasks.filter(t => !t.deleted) ?? [],
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

      if (task.completed || task.deleted) {
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

    close(params: task_close): { tree: Task[]; rootProgress: Progress } {
      const { index, mode } = params;

      let task: Task | undefined = tasks.get(index);

      if (!task) {
        task = findTaskByTitle(tasks, index);
      }

      if (mode === "complete") {
        if (task.completed) {
          throw ERRORS.ALREADY_COMPLETED(task.index);
        }
        if (task.deleted) {
          throw new TaskTreeError("TASK_DELETED", `Task "${task.index}" is deleted`);
        }
        // Check if has pending children
        if (hasPendingChildren(task)) {
          const pendingChildren = task.children!.tasks
            .filter(t => !t.completed && !t.deleted)
            .map(t => t.index);
          throw new TaskTreeError(
            "HAS_PENDING_CHILDREN",
            `Cannot complete task "${task.index}" - has incomplete children: ${pendingChildren.join(", ")}. Complete or delete children first.`
          );
        }
        task.completed = true;
        lastCompletedIndex = task.index;
        store.lastCompletedIndex = lastCompletedIndex;
      } else if (mode === "delete") {
        if (task.deleted) {
          throw new TaskTreeError("ALREADY_DELETED", `Task "${task.index}" is already deleted`);
        }
        task.deleted = true;
        // Remove children recursively
        if (task.children) {
          for (const child of task.children.tasks) {
            deleteTaskAndDescendants(child, tasks);
          }
          task.children = { tasks: [] };
        }
        lastCompletedIndex = task.index;
        store.lastCompletedIndex = lastCompletedIndex;
      }

      persistTasks();
      return doList("full");
    },

    list(params: task_list): { tree: Task[]; rootProgress: Progress } {
      return doList(params.mode ?? "focus");
    },
  };
}


