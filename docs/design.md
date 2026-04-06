# Nested Todo - Core Design

## Data Structures

### Task (Core Entity)

```typescript
interface Task {
  index: string;            // Unique identifier
  parentIndex: string;       // Parent task index (always defined)
  title: string;
  description?: string;
  status: TaskStatus;
  groupIndex: number;        // Which group (by position) this task belongs to
  groupLabel?: string;       // Original parallelGroup label (for reference only)
  children?: TaskList;       // Children under this task
}
```

**Hierarchy:** Task owns children, references parent. Root task has index `"root"`. Top-level tasks have parentIndex `"root"`.

### TaskList (Child Collection)

```typescript
interface TaskList {
  tasks: Task[];                 // Task objects in creation order
  groups: ParallelGroup[];       // Pre-computed groups (ordered by position)
}

interface ParallelGroup {
  position: number;             // Group index (0, 1, 2, ...)
  label?: string;                // Original parallelGroup label (for reference only)
  taskIndices: string[];         // Task indices belonging to this group
  isComplete: boolean;           // All tasks in group are completed
}
```

### TaskStore

```typescript
const ROOT_INDEX = "root";  // Synthetic root, parent of all top-level tasks

interface TaskStore {
  indexMap: Map<string, Task>;      // All tasks including root
  rootList: TaskList | undefined;   // Reference to root's children (avoids lookup)
  lastCompletedIndex: string | null; // Target for focus mode
  getTask(index: string): Task | undefined;  // Convenience lookup
}

interface Progress {
  completed: number;  // Number of completed top-level tasks
  total: number;     // Total number of top-level tasks
}
```

---

## Key Concepts

### Root and Top-Level Tasks

- **Root** (index `"root"`): Single synthetic root task, parent of all top-level tasks
- **Top-level tasks**: Tasks with parentIndex = `"root"` (e.g., "1", "2", "3")

**Important:** Top-level tasks follow the same rules as any other tasks. The root's TaskList is processed identically to any other parent's children list. There is no special "sequential behavior" at the root level - only the index validation and parallel group rules apply.

### Parallel Groups

Within a `TaskList`, tasks are segmented into parallel groups:
- Sequential tasks (no `parallelGroup` label) = each is its own group
- Adjacent tasks with same `parallelGroup` label = same group
- Groups are ordered by their position in the task list (0, 1, 2, ...)

Group is identified by **position**, not label. Label is for reference only.

### Status Rules

| Condition | Result |
|-----------|--------|
| Task is completed | `completed` |
| Parent is pending | `pending` |
| Parent is ready AND first group | `ready` |
| Parent is ready AND all older groups complete | `ready` |
| Otherwise | `pending` |

Status is calculated on task creation, updated on task completion.

---

## Operations

### Create Task List

1. Validate indices and mode
2. If `override`: delete old list's tasks from indexMap, then create new
3. If `new`/`append`: add new tasks to indexMap
4. Create `Task` objects with initial status
5. Segment into `ParallelGroup`s:
   - Iterate over tasks
   - New label OR null label → close current group, start new group
   - Same label as current → add to current group
   - Appended lists start fresh (do not continue existing groups)
6. Store as `TaskList` under parent

### Complete Task

1. Look up task via indexMap
2. Mark task as `completed`
3. Update group's `isComplete` flag (set to true only if all tasks in group are completed)
4. If group complete:
   a. Check if next group exists (if current is last group, nothing to do)
   b. For each task in next group, mark ready recursively (children in first group also become ready)

### Get Task

1. Look up by indexMap (or search by title)
2. Return task with group context (previousGroup, currentGroup, nextGroup)

### List Tasks

**Full mode**: DFS traversal starting from root task

**Focus mode (Partial DFS)**:
1. DFS traversal, expand child only if: `target_index.startswith(child_index + ".")`
2. Include node in result if it matches (ancestors match by expansion rule)
3. Example:
   - Target: `"1.10.2"`
   - At `"1"`: starts with "1." → expand, include
   - At `"1.10"`: starts with "1.10." → expand, include
   - At `"1.10.2"`: doesn't start with "1.10.2." → don't expand, include as leaf
   - At `"1.10.3"`: "1.10.2" doesn't start with "1.10.3." → skip

---

## Persistence

State is persisted to a JSONL file after each write operation.

### File Location

- File: `.nested-todo.jsonl` in the current working directory
- Created on first write operation if not exists

### Format

**Line 1 - Metadata:**
```json
{"version": 1, "lastCompletedIndex": "1.2"}
```

**Remaining lines - One task per line:**
```json
{"index": "1", "parentIndex": "root", "title": "Task 1", "status": "ready", "groupIndex": 0, "groupLabel": null}
{"index": "1.1", "parentIndex": "1", "title": "Subtask", "status": "pending", "groupIndex": 0, "groupLabel": null}
```

### Reconstruction

1. Parse line 1 as metadata
2. Parse remaining lines as task objects
3. Find root tasks: filter where `parentIndex === "root"`
4. Build tree: for each task, discover children by scanning for `parentIndex === task.index`
5. Reconstruct groups from `groupIndex` (source of truth)

### Operations

- **Save**: DFS traversal after each create/update/complete operation
- **Load**: On session start, reconstruct tree from JSONL
- **Error handling**: If file corrupted or missing, log error and start fresh

---

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Hierarchy | TaskList by parent | Groups children naturally, pre-computes groups |
| Task structure | Minimal (index, title, status, group) | Index is identifier only |
| Groups | Pre-computed in TaskList | Computed once on creation |
| Status | Cached in Task | Avoid recalculating on every access |
| Focus path | Rebuild from parent chain | Simple, correct |
| Persistence | File-based (always on) | Survives restarts, simple to implement |

---
