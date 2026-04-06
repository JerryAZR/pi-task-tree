// Core types for nested-todo

export const ROOT_INDEX = "root";  // Synthetic root, parent of all top-level tasks

export type TaskStatus = "pending" | "ready" | "completed";

export interface Progress {
  completed: number;
  total: number;
}

// Task - core entity
// Hierarchy: Task owns children, references parent. Root task has index "root".
export interface Task {
  index: string;            // Unique identifier
  parentIndex: string;        // Parent task index (always defined)
  title: string;
  description?: string;
  status: TaskStatus;
  groupIndex: number;         // Which group (by position) this task belongs to
  groupLabel?: string;        // Original parallelGroup label (for reference only)
  children?: TaskList;       // Children under this task
}

// Parallel group within a TaskList
// Group identified by array position. Label is for reference only.
export interface ParallelGroup {
  label?: string;             // Original parallelGroup label (for reference only)
  taskIndices: string[];       // Task indices belonging to this group
  isComplete: boolean;        // All tasks in group are completed
}

// TaskList - all children under a parent
export interface TaskList {
  tasks: Task[];              // Tasks in creation order
  groups: ParallelGroup[];    // Pre-computed groups (ordered by position)
}

// Task storage interface
export interface TaskStore {
  indexMap: Map<string, Task>;  // All tasks including root
  rootList: TaskList;  // Reference to root's children (empty if none)
  lastCompletedIndex: string | null;  // Target for focus mode
  getTask(index: string): Task | undefined;  // Convenience lookup
}

// API input/output types
// Note: index is auto-generated, not provided by caller
export interface CreateListItem {
  title: string;
  description?: string;
  parallelGroup?: string;
}

export interface task_create_list {
  items: CreateListItem[];
  parent?: string | null;
  mode?: "new" | "append" | "override";
}

export interface task_get {
  // Called indexOrTitle externally, query internally for legacy compatibility
  query: string;
}

export interface task_get_result {
  task: Task;
  parent?: Task;
  previousGroup: Task[];
  currentGroup: Task[];
  nextGroup: Task[];
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
  getTaskStatus(index: string): TaskStatus | undefined;
  
  // Operations
  createList(params: task_create_list): task_list_result;
  get(params: task_get): task_get_result;
  update(params: task_update): task_update_result;
  complete(params: task_complete): task_complete_result;
  list(params: task_list): task_list_result;
}
