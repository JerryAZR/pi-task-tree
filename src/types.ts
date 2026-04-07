// Core types for nested-todo
// Simplified model: only completed/not-completed states

export const ROOT_INDEX = "root";  // Synthetic root, parent of all root-level tasks (same for all roots)

export interface Progress {
  completed: number;
  total: number;
}

// Task - core entity
// Hierarchy: Task owns children, references parent. Root task has index "root".
export interface Task {
  index: string;            // Unique identifier
  parentIndex: string;      // Parent task index (always defined)
  title: string;
  description?: string;
  completed: boolean;        // Simple completed flag
  children?: TaskList;      // Children under this task
}

// TaskList - all children under a parent
export interface TaskList {
  tasks: Task[];            // Tasks in creation order
}

// Task storage interface
export interface TaskStore {
  indexMap: Map<string, Task>;  // All tasks including root
  rootList: TaskList;  // Reference to root's children (empty if none)
  lastCompletedIndex: string | null;  // Last completed for reference
  getTask(index: string): Task | undefined;  // Convenience lookup
}

// Root list management types
export interface Root {
  id: string;           // Unique identifier (timestamp-based)
  title: string;        // Display name
  description?: string; // Optional description
  createdAt: number;    // Unix timestamp
}

export interface RootsManifest {
  roots: Root[];
  activeId: string | null;  // ID of active root, null if none
}

// API input/output types
export interface CreateListItem {
  title: string;
  description?: string;
}

export interface task_create_root {
  title: string;
  description?: string;
  items: CreateListItem[];  // Required - initial tasks for the root list
}

export interface task_create_root_result {
  root: Root;
  rootProgress: Progress;
}

export interface task_breakdown {
  items: CreateListItem[];
  parent: string;  // Required - parent task index
  mode?: "new" | "append" | "override";
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
  children: Task[];  // Direct children of the task
}

export interface task_update {
  index: string;
  title?: string;
  description?: string | null;
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

export interface task_list {
  mode?: "focus" | "full";
}

export interface task_list_result {
  tree: Task[];
  rootProgress: Progress;
}

export type CreateMode = "new" | "append" | "override";
export type ListMode = "focus" | "full";

export interface TaskManager {
  // State access (for testing)
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
  list(params: task_list): task_list_result;
}
