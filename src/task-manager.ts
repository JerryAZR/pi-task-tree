// ============================================================================
// TaskManager - Core implementation for nested-todo
// ============================================================================
// 
// MODEL OVERVIEW:
// - Tasks have two boolean flags: completed, deleted
// - [⏳] is a DERIVED display state (not stored): pending + has completed children
// - Siblings can be completed in any order
// - Parents require explicit close when all children are done/deleted
// - Deleted tasks are soft-deleted (remain in tree, excluded from counts)
// 
// WHY THIS MODEL:
// - Agents naturally follow order, so strict sequential enforcement isn't needed
// - [⏳] helps agents understand progress without complex state machine
// - Parent completion rules prevent accidental "done before subtasks"
// - Soft delete preserves context without cluttering active views
// ============================================================================

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
  task_complete,
  task_complete_result,
  task_delete,
  task_delete_result,
  task_list,
  task_list_result,
} from "./types";
import { ROOT_INDEX } from "./types";
import { ERRORS } from "./errors";
import { TaskTreeError } from "./errors";

// ============================================================================
// Persistence Configuration
// ============================================================================
// WHAT: File paths for multi-root storage
// WHY: Each root has its own file (.pi/task_tree/lists/{id}.jsonl)
//      Roots registry in .pi/task_tree/roots.jsonl
const PERSISTENCE_DIR = ".pi/task_tree";
const LISTS_DIR = "lists";
const ROOTS_FILE = "roots.jsonl";

// Version for future migration support
const PERSISTENCE_VERSION = 1;

// ============================================================================
// Persistence Types
// ============================================================================
// WHAT: Flattened task representation for JSONL storage
// WHY: JSONL is simple to append/read, children are reconstructed from index pattern
interface PersistedMeta {
  version: number;
  lastCompletedIndex: string | null;  // For focus mode reference
}

interface PersistedTask {
  index: string;       // e.g., "1", "1.2", "1.2.1"
  parentIndex: string; // Parent's index (empty for root)
  title: string;
  description?: string;
  completed: boolean;
  deleted: boolean;
}

// ============================================================================
// Persistence Helpers
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

// WHAT: Ensures persistence directories exist
// WHY: Must create directories before writing files
function ensurePersistenceDir(): void {
  mkdirSync(resolve(process.cwd(), PERSISTENCE_DIR), { recursive: true });
  mkdirSync(getListsDir(), { recursive: true });
}

// WHAT: Load roots registry from roots.jsonl
// WHY: Global registry tracks all roots and which is active
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

// WHAT: Parse JSONL content into metadata and task map
// WHY: JSONL format: line 1 = metadata, remaining lines = one task per line
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

// WHAT: Serialize state to JSONL
// WHY: DFS traversal flattens tree into sequential lines
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

// ============================================================================
// Tree Reconstruction
// ============================================================================
// WHAT: Rebuild tree structure from flattened task map
// WHY: Indices follow predictable pattern (1, 1.1, 1.1.1) so we can
//      reconstruct hierarchy without storing parent references in TaskList

function emptyTaskList(): TaskList {
  return { tasks: [] };
}

// WHAT: Recursively build task tree by scanning for expected index patterns
// WHY: Child indices are predictable: parent 1 has children 1.1, 1.2, ...
//      This lets us discover children without explicit parent list storage
function buildTreeFromTasks(persistedTasks: Map<string, PersistedTask>): { tasks: Map<string, Task>; rootList: TaskList } {
  const taskMap = new Map<string, Task>();

  function buildSubtree(parentIndex: string): TaskList {
    const result: Task[] = [];
    let childSuffix = 1;

    // WHAT: Keep scanning until we find a gap in the sequence
    // WHY: 1, 2, 3, _gap_, 5 means only 1, 2, 3 are children
    while (true) {
      const childIndex = parentIndex === ROOT_INDEX
        ? String(childSuffix)
        : `${parentIndex}.${childSuffix}`;

      const pTask = persistedTasks.get(childIndex);
      if (!pTask) {
        break;
      }

      // WHAT: Convert persisted task to runtime task
      const task: Task = {
        index: pTask.index,
        parentIndex: pTask.parentIndex,
        title: pTask.title,
        description: pTask.description,
        completed: pTask.completed,
        deleted: pTask.deleted,
      };

      taskMap.set(task.index, task);

      // WHAT: Recursively build children
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

// WHAT: Load state from JSONL string (for testing)
// WHY: Enables tests to inject state without file I/O
export function loadFromDump(content: string): { lastCompletedIndex: string | null; tasks: Map<string, Task>; rootList: TaskList } {
  const { meta, tasks: persistedTasks } = parseDump(content);
  const { tasks: taskMap, rootList } = buildTreeFromTasks(persistedTasks);
  return { lastCompletedIndex: meta.lastCompletedIndex, tasks: taskMap, rootList };
}

// ============================================================================
// Utility Functions
// ============================================================================

function getRootList(tasks: Map<string, Task>): TaskList {
  const rootTask = tasks.get(ROOT_INDEX);
  return rootTask?.children ?? emptyTaskList();
}

// WHAT: Find task by exact title match
// WHY: Allows users to reference tasks by name instead of index
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

// WHAT: Generate unique root ID
// WHY: Timestamp-based is simple and sufficient (creation is infrequent)
function generateRootId(): string {
  return String(Date.now());
}

// WHAT: Create synthetic root task
// WHY: All root-level tasks have a common parent for uniform tree structure
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
// Display State Helpers
// ============================================================================
// WHAT: Derive display state from stored flags
// WHY: [⏳] is computed, not stored - agents see "in progress" naturally

function getDisplayState(task: Task): DisplayState {
  if (task.deleted) return "deleted";
  if (task.completed) return "completed";
  
  // WHAT: Check if any child is completed (and not deleted)
  // WHY: This signals "work has started but not finished"
  if (task.children && task.children.tasks.length > 0) {
    const hasCompletedChild = task.children.tasks.some(
      child => child.completed && !child.deleted
    );
    if (hasCompletedChild) return "in_progress";
  }
  
  return "pending";
}

// WHAT: Check if task has any pending children
// WHY: Used to enforce parent completion rules
function hasPendingChildren(task: Task): boolean {
  if (!task.children || task.children.tasks.length === 0) {
    return false;
  }
  return task.children.tasks.some(
    child => !child.completed && !child.deleted
  );
}

// WHAT: Recursively delete task and all descendants
// WHY: Deleting a parent should clean up children from the index map
function deleteTaskAndDescendants(task: Task, tasks: Map<string, Task>): void {
  if (task.children) {
    for (const child of task.children.tasks) {
      deleteTaskAndDescendants(child, tasks);
    }
  }
  tasks.delete(task.index);
}

// ============================================================================
// TaskManager Factory
// ============================================================================
// WHAT: Creates isolated task manager instances
// WHY: Each session gets its own manager; state persists to disk between sessions

export function createTaskManager(): ITaskManager {
  // WHAT: Skip file I/O during tests for speed and isolation
  const isTest = process.env.NODE_ENV === "test";

  // Load or initialize roots manifest
  let manifest = isTest ? { roots: [], activeId: null } : loadRootsManifest();
  let activeId: string | null = manifest.activeId;
  
  // Load active root's tasks (if any)
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

  // Always create synthetic root task (parent of all root-level tasks)
  const syntheticRoot = createSyntheticRootTask(rootList);
  tasks.set(ROOT_INDEX, syntheticRoot);

  // Shared state store (returned to callers for inspection)
  const store: TaskStore = {
    rootList,
    indexMap: tasks,
    lastCompletedIndex,
    getTask(index: string): Task | undefined {
      return tasks.get(index);
    },
  };

  // WHAT: Only persist in production (not during tests)
  // WHY: Tests run in memory for speed and isolation
  function persistTasks(): void {
    if (isTest || !activeId) return;
    saveTasksToFile(activeId, lastCompletedIndex, tasks);
  }

  function persistManifest(): void {
    if (isTest) return;
    saveRootsManifest(manifest);
  }

  // ============================================================================
  // Root Loading/Switching
  // ============================================================================

  function loadRoot(id: string): void {
    const loadedData = loadTasksFromFile(id);
    if (loadedData) {
      lastCompletedIndex = loadedData.lastCompletedIndex;
      tasks = loadedData.tasks;
      rootList = loadedData.rootList;
      // Recreate synthetic root with loaded children
      const root = createSyntheticRootTask(rootList);
      tasks.set(ROOT_INDEX, root);
      store.rootList = rootList;
      store.indexMap = tasks;
      store.lastCompletedIndex = lastCompletedIndex;
    } else {
      // New empty root
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
    // Save current root before switching
    if (activeId) {
      saveTasksToFile(activeId, lastCompletedIndex, tasks);
    }
    loadRoot(id);
    manifest.activeId = id;
    persistManifest();
  }

  // ============================================================================
  // Task Creation (Internal)
  // ============================================================================
  // WHAT: Core logic for creating tasks under any parent
  // WHY: Shared by createRoot, addTask, and breakdown with different parameters

  function doCreateList(items: CreateListItem[], parent: string | null | undefined, mode: string): { tree: Task[]; rootProgress: Progress } {
    const parentIndex = parent ?? ROOT_INDEX;
    const parentTask = tasks.get(parentIndex);

    if (!parentTask) {
      throw new Error(`INTERNAL ERROR: Parent task "${parentIndex}" not found in task map.`);
    }

    // WHAT: Can't add children to completed or deleted tasks
    // WHY: Completing a parent means "all work done"
    if (parentTask.completed || parentTask.deleted) {
      throw ERRORS.TASK_COMPLETED(parentIndex);
    }

    const existingChildren = parentTask.children;
    const hasChildren = existingChildren && existingChildren.tasks.length > 0;

    // WHAT: Mode handling
    // WHY: new=error if exists, append=add to end, override=replace all
    if (mode === "new" && hasChildren) {
      throw ERRORS.LIST_EXISTS(parentIndex);
    } else if (mode === "override" && existingChildren) {
      for (const oldTask of existingChildren.tasks) {
        deleteTaskAndDescendants(oldTask, tasks);
      }
    }

    // WHAT: Calculate task indices based on parent scope
    // WHY: Index pattern: root tasks are 1,2,3; children of 1 are 1.1,1.2,1.3
    const scopePrefix = parentIndex === ROOT_INDEX ? "" : parentIndex + ".";
    const existingCount = existingChildren?.tasks.length ?? 0;
    const startIndex = mode === "append" ? existingCount + 1 : 1;

    // WHAT: Create task objects with sequential indices
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

    // WHAT: Merge or replace children based on mode
    const allChildren = mode === "append" && existingChildren
      ? [...existingChildren.tasks, ...taskObjects]
      : taskObjects;

    const taskList: TaskList = { tasks: allChildren };

    // WHAT: Update parent's children reference
    if (parentIndex === ROOT_INDEX) {
      store.rootList = taskList;
      tasks.get(ROOT_INDEX)!.children = taskList;
    } else {
      parentTask.children = taskList;
    }

    return doList("full");
  }

  // ============================================================================
  // List (Internal)
  // ============================================================================

  function doList(listMode: string): { tree: Task[]; rootProgress: Progress } {
    const mode = listMode || "focus";
    const rootListLocal = store.rootList;

    // WHAT: Progress counts only non-deleted tasks
    // WHY: Deleted tasks are excluded from progress
    const activeTasks = rootListLocal.tasks.filter(t => !t.deleted);
    const rootProgress = {
      completed: activeTasks.filter(t => t.completed).length,
      total: activeTasks.length,
    };

    if (activeTasks.length === 0) {
      return { tree: [], rootProgress };
    }

    const tree: Task[] = [];

    // WHAT: DFS traversal of tree
    // WHY: Preserves hierarchy while flattening for display
    function dfs(children: TaskList | undefined) {
      if (!children) return;
      for (const task of children.tasks) {
        // WHAT: Skip deleted tasks in focus mode
        // WHY: Focus should show only actionable items
        if (mode === "focus" && task.deleted) continue;
        tree.push(task);
        if (task.children) {
          dfs(task.children);
        }
      }
    }

    dfs(rootListLocal);

    return { tree, rootProgress };
  }

  // ============================================================================
  // Public API
  // ============================================================================

  return {
    // WHAT: Expose internal state for testing
    getState(): TaskStore {
      return store;
    },

    isCompleted(index: string): boolean | undefined {
      return tasks.get(index)?.completed;
    },

    // WHAT: Create new root with initial tasks
    // WHY: Starts a new planning session, becomes active root
    createRoot(params: task_create_root): { root: Root; rootProgress: Progress } {
      const { title, description, items } = params;
      const id = generateRootId();
      const root: Root = {
        id,
        title,
        description,
        createdAt: Date.now(),
      };

      // Register in manifest
      manifest.roots.push(root);
      manifest.activeId = id;
      persistManifest();

      // Load empty state for new root
      loadRoot(id);

      // Create initial tasks
      const result = doCreateList(items, undefined, "new");
      persistTasks();

      return { root, rootProgress: result.rootProgress };
    },

    // WHAT: Add tasks under specific parent
    // WHY: Core breakdown operation for planning
    breakdown(params: task_breakdown): { tree: Task[]; rootProgress: Progress } {
      if (!activeId) {
        throw ERRORS.NO_ACTIVE_ROOT();
      }
      const { items, parent, mode = "new" } = params;
      return doCreateList(items, parent, mode);
    },

    // WHAT: List all roots and indicate active
    // WHY: For root management UI/tools
    listRoots(): { roots: Root[]; activeId: string | null } {
      return { roots: manifest.roots, activeId: manifest.activeId };
    },

    // WHAT: Switch active root
    // WHY: Allows working on different plans
    activateRoot(params: task_activate_root): { roots: Root[]; activeId: string | null } {
      const { id } = params;
      const root = manifest.roots.find(r => r.id === id);
      if (!root) {
        throw ERRORS.ROOT_NOT_FOUND(id);
      }
      switchToRoot(id);
      return { roots: manifest.roots, activeId: manifest.activeId };
    },

    // WHAT: Delete entire root
    // WHY: Clean up old plans
    deleteRoot(params: task_delete_root): { roots: Root[]; activeId: string | null } {
      const { id } = params;
      const index = manifest.roots.findIndex(r => r.id === id);
      if (index === -1) {
        throw ERRORS.ROOT_NOT_FOUND(id);
      }

      if (activeId === id) {
        // WHAT: If deleting active root, switch to another or clear state
        deleteTasksFile(id);
        manifest.roots.splice(index, 1);
        manifest.activeId = manifest.roots.length > 0 ? manifest.roots[0].id : null;
        persistManifest();

        if (manifest.activeId) {
          loadRoot(manifest.activeId);
        } else {
          // Clear to empty state
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
        // Just remove from registry
        deleteTasksFile(id);
        manifest.roots.splice(index, 1);
        persistManifest();
      }

      return { roots: manifest.roots, activeId: manifest.activeId };
    },

    // WHAT: Get task details by index or title
    // WHY: Provides context for task execution
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

    // WHAT: Update task title or description
    // WHY: Allows refinement of plans
    update(params: task_update): task_update_result {
      const { index, title, description } = params;

      let task: Task | undefined = tasks.get(index);
      if (!task) {
        task = findTaskByTitle(tasks, index);
      }

      if (task.index === ROOT_INDEX) {
        throw ERRORS.ROOT_TASK();
      }

      // WHAT: Can't update completed or deleted tasks
      // WHY: Preserves integrity of closed tasks
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

    // WHAT: Mark task as completed
    // WHY: Signals task is done
    complete(params: task_complete): { tree: Task[]; rootProgress: Progress } {
      const { index } = params;

      let task: Task | undefined = tasks.get(index);
      if (!task) {
        task = findTaskByTitle(tasks, index);
      }

      if (task.completed) {
        throw ERRORS.ALREADY_COMPLETED(task.index);
      }
      if (task.deleted) {
        throw new TaskTreeError("TASK_DELETED", `Task "${task.index}" is deleted`);
      }

      // WHAT: Parent can't complete if it has pending children
      // WHY: Ensures intentional review before closing parent tasks
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

      persistTasks();
      return doList("full");
    },

    // WHAT: Soft delete task and remove children
    // WHY: Allows removing unwanted tasks without losing context
    delete(params: task_delete): { tree: Task[]; rootProgress: Progress } {
      const { index } = params;

      let task: Task | undefined = tasks.get(index);
      if (!task) {
        task = findTaskByTitle(tasks, index);
      }

      if (task.deleted) {
        throw new TaskTreeError("ALREADY_DELETED", `Task "${task.index}" is already deleted`);
      }

      task.deleted = true;
      
      // WHAT: Remove children recursively
      // WHY: Deleted tasks shouldn't have visible children
      if (task.children) {
        for (const child of task.children.tasks) {
          deleteTaskAndDescendants(child, tasks);
        }
        task.children = { tasks: [] };
      }
      
      lastCompletedIndex = task.index;
      store.lastCompletedIndex = lastCompletedIndex;

      persistTasks();
      return doList("full");
    },

    // WHAT: List tasks with optional filtering
    // WHY: Main view for understanding current state
    list(params: task_list): { tree: Task[]; rootProgress: Progress } {
      return doList(params.mode ?? "focus");
    },

    // WHAT: Add tasks to root level of active plan
    // WHY: Convenience wrapper for extending existing plans
    addTask(params: { items: CreateListItem[]; mode?: string }): { tree: Task[]; rootProgress: Progress } {
      if (!activeId) {
        throw ERRORS.NO_ACTIVE_ROOT();
      }
      // WHAT: Default to append mode
      // WHY: Natural behavior for "add more tasks"
      return doCreateList(params.items, ROOT_INDEX, params.mode ?? "append");
    },
  };
}

// ============================================================================
// File I/O Functions (defined outside createTaskManager)
// ============================================================================
// WHY: These don't need closure state, defined at module level

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
