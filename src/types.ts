// Core types for nested-todo
// Model: completed/deleted flags, parent completion rules, [⏳] derived display

export const ROOT_INDEX = "root";  // Synthetic root, parent of all root-level tasks

export interface Progress {
  completed: number;
  total: number;
}

// Task - core entity
// [⏳] is derived display: pending + hasCompletedChildren
export interface Task {
  index: string;            // Unique identifier
  parentIndex: string;      // Parent task index
  title: string;
  description?: string;
  completed: boolean;        // Terminal state
  deleted: boolean;          // Soft-deleted terminal state
  children?: TaskList;       // Children under this task
}

// Display state (derived, not stored)
export type DisplayState = "pending" | "in_progress" | "completed" | "deleted";

// TaskList - all children under a parent
export interface TaskList {
  tasks: Task[];            // Tasks in creation order
}

// Task storage interface
export interface TaskStore {
  indexMap: Map<string, Task>;
  rootList: TaskList;
  getTask(index: string): Task | undefined;
}

// Root list management types
export interface Root {
  id: string;
  title: string;
  description?: string;
  createdAt: number;
}

export interface RootsManifest {
  roots: Root[];
  activeId: string | null;
}

// API input/output types
export interface CreateListItem {
  title: string;
  description?: string;
}

export interface task_create_root {
  title: string;
  description?: string;
  items: CreateListItem[];
}

export interface task_create_root_result {
  root: Root;
  tree: Task[];
  rootProgress: Progress;
}

export interface task_breakdown {
  items: CreateListItem[];
  parent: string;
  mode?: "new" | "append" | "override" | "insert";
  before?: string;  // For insert mode: task index to insert before
}

// Add tasks to root of active plan
// This is a convenience wrapper around breakdown with parent=root
export interface task_add_task {
  items: CreateListItem[];
  mode?: "new" | "append" | "override" | "insert";
  before?: string;  // For insert mode: task index to insert before
}

export interface task_list_roots_result {
  roots: Root[];
  activeId: string | null;
}

export interface task_activate_root {
  id: string;
}

export interface task_delete_root {
  id: string;
}

export interface task_get {
  query: string;
}

export interface task_get_result {
  task: Task;
  parent?: Task;
  root?: { title: string; description?: string };
}

export interface task_update {
  index: string;
  title?: string;
  description?: string;  // undefined = leave unchanged, empty string = clear
}

export interface task_update_result {
  task: Task;
}

export interface task_complete {
  index: string;
}

export interface task_complete_result {
  tree: Task[];
  rootProgress: Progress;
}

export interface task_delete {
  index: string;
}

export interface task_delete_result {
  tree: Task[];
  rootProgress: Progress;
}

// list modes:
// - focus (default): DFS recurses into first incomplete task at each level
// - path: DFS recurses into first incomplete AND shows path to target task
// - full: DFS includes all tasks
export interface task_list {
  mode?: "focus" | "path" | "full";
  target?: string;  // For path mode: show path to this task
}

export interface task_list_result {
  tree: Task[];
  rootProgress: Progress;
}

export type CreateMode = "new" | "append" | "override";
export type ListMode = "focus" | "full";

export interface TaskManager {
  // State access
  getState(): TaskStore;
  isCompleted(index: string): boolean | undefined;
  
  // Root management
  createRoot(params: task_create_root): task_create_root_result;
  breakdown(params: task_breakdown): task_list_result;
  listRoots(): task_list_roots_result;
  activateRoot(params: task_activate_root): task_list_roots_result;
  deleteRoot(params: task_delete_root): task_list_roots_result;
  
  // Task operations
  get(params: task_get): task_get_result;
  update(params: task_update): task_update_result;
  complete(params: task_complete): task_complete_result;
  delete(params: task_delete): task_delete_result;
  list(params: task_list): task_list_result;
  addTask(params: task_add_task): task_list_result;
}
