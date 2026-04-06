# Nested Todo API Specification

## Types

```typescript
type TaskStatus = "pending" | "ready" | "completed";

interface Progress {
  completed: number;
  total: number;
}

interface Task {
  index: string;            // Unique identifier, e.g. "1", "1.1", "1.2.3"
  title: string;
  description?: string;
  status: TaskStatus;
  parallelGroup?: string;   // Optional. Tasks with same group run in parallel.
}
```

## Task States

```
pending ──► ready ──► completed
```

| State | Description |
|-------|-------------|
| `pending` | Task is waiting for prerequisites. Blocked from execution. |
| `ready` | Prerequisites satisfied. Available for execution. |
| `completed` | Task is done. |

### State Transitions

| From | To | Trigger |
|------|----|---------|
| `pending` | `ready` | All tasks in older parallel groups are completed |
| `ready` | `completed` | Agent calls `task_complete` |
| `completed` | — | Terminal state |

### Invariant

There is always at least one `ready` task unless all tasks are `completed`.

### Blocking Semantics

- A task is **blocked** if any task in an **older** parallel group is not completed
- Within the same parallel group, tasks do **not** block each other
- **Parallel group completion**: A group is completed when all its tasks are completed
- Completing a parallel group **unblocks** the next group (pending → ready)

### Parent-Child Status Rules

Status inheritance is **top-down** at task list creation:

- When a task is expanded (child list created under it), the **first parallel group** inherits the parent's status
- All **younger parallel groups** start as `pending`

```
Task (pending) expanded:
  ├─ Group 1 → pending (inherits parent)
  ├─ Group 2 → pending
  └─ Group 3 → pending

Task (ready) expanded:
  ├─ Group 1 → ready (inherits parent)
  ├─ Group 2 → pending
  └─ Group 3 → pending
```

**A child cannot be `ready` or `completed` while its parent is `pending`.**

### Parallel Group Terminology

Groups are ordered by their position: first group to appear is the **oldest**, last to appear is the **youngest**.

- **Older/previous groups**: Groups that appear before the current group in the list
- **Younger/next groups**: Groups that appear after the current group in the list
- A task is blocked if any older group has incomplete tasks

---

## task_create_list

Create a flat list of tasks under a parent. The agent assigns indices and parallel groups.

```typescript
interface task_create_list {
  items: {
    index: string;           // e.g. "1", "1.1", "1.2.1"
    title: string;
    description?: string;
    parallelGroup?: string;  // Optional group ID
  }[];
  parent?: string | null;   // null = root level (only one root allowed)
  mode?: "new" | "append" | "override"; // default: "new"
}
```

### Index Rules

| Rule | Description |
|------|-------------|
| **Depth** | Can nest one level deeper than parent: `1` → `1.1` → `1.1.1` |
| **Scope** | All indices must start with parent's index + "." |
| **Root indices** | No dots, e.g. `"1"`, `"2"`, `"3"` |
| **Append ordering** | Indices must continue sequentially (no gaps) |
| **One root** | Only one root-level list can exist |

### Modes

| Mode | Behavior |
|------|----------|
| `new` (default) | Only succeeds if parent has no existing children |
| `append` | Adds to parent's children, enforces sequential ordering |
| `override` | Replaces existing children (cleanup/recovery) |

### Parallel Groups

- Tasks without `parallelGroup` are **sequential** (eligible for parallel execution only if assigned a group)
- Tasks with the same `parallelGroup` run together
- A group completes when **all its tasks complete**
- Completing a group unblocks the next group

```typescript
[
  { index: "1", title: "Setup" },
  { index: "2", title: "Frontend", parallelGroup: "A" },
  { index: "3", title: "Backend", parallelGroup: "A" },
  { index: "4", title: "Integration tests" }
]
// Flow: 1 (sequential) → (2, 3 parallel) → 4
```

### Errors

| Error | Condition |
|-------|-----------|
| `INVALID_INDEX_SCOPE` | Indices don't match parent scope |
| `DEPTH_VIOLATION` | Depth exceeds one level from parent |
| `OUT_OF_ORDER` | Append mode has gaps in sequence |
| `LIST_EXISTS` | `new` mode but list already exists |
| `TASK_COMPLETED` | Cannot expand an already completed task |

---

## task_get

Query a task by index or title. Index uniquely identifies a task.

```typescript
interface task_get {
  query: string; // Index (e.g. "1.2") or title
}
```

### Return

```typescript
interface task_get_result {
  task: Task;                    // Full task detail
  parent?: Task;                 // Parent task (simplified)
  previousGroup: Task[];         // Older parallel groups
  currentGroup: Task[];          // This task's parallel group
  nextGroup: Task[];             // Younger parallel groups
}
```

### Errors

| Error | Condition |
|-------|-----------|
| `NOT_FOUND` | Query matches no task |
| `AMBIGUOUS` | Title matches multiple tasks. Returns `{ matches: { index: string, title: string }[] }` |

---

## task_update

Update a task's title or description.

```typescript
interface task_update {
  index: string;                // Index or title
  title?: string;
  description?: string | null; // null to clear
}
```

### Return

```typescript
interface task_update_result {
  task: Task;  // The updated task
}
```

### Errors

| Error | Condition |
|-------|-----------|
| `NOT_FOUND` | Index matches no task |
| `AMBIGUOUS` | Title matches multiple tasks |

---

## task_complete

Mark a task as completed.

```typescript
interface task_complete {
  index: string; // Index or title
}
```

### Completion Rules

A task can be completed **if and only if**:
1. It is in `ready` state, **AND**
2. If it has children, all children are `completed`

Completing a parallel group (all its tasks done) unblocks the next group.

### Return

```typescript
interface task_complete_result {
  tree: Task[];            // Same focused view as task_list
  rootProgress: Progress;   // Always shown
}
```

### Errors

| Error | Condition |
|-------|-----------|
| `NOT_FOUND` | Index matches no task |
| `NOT_READY` | Task has incomplete prerequisites |
| `CHILDREN_INCOMPLETE` | Task has incomplete children |
| `ALREADY_COMPLETED` | Task is already completed |

---

## task_list

List tasks as a DFS traversal.

```typescript
interface task_list {
  mode?: "focus" | "full"; // default: "focus"
}

interface task_list_result {
  tree: Task[];            // DFS traversal
  rootProgress: Progress;   // Root-level progress: completed/total
}
```

### Modes

| Mode | Description |
|------|-------------|
| `full` | Full DFS of all tasks |
| `focus` (default) | Partial DFS focused on previously completed task |

### Focus Mode

Focus mode shows a **partial DFS** of the task tree:

1. **Target**: The **last completed task** (or virtual target "1.1.1..." if just started)
2. **Expansion rule**: A node is expanded only if `target.startsWith(nodeIndex + ".")`
3. **Derived behavior**: Completed and pending nodes appear collapsed because they are not on the path to the target

```
Focus on "2.1.1" means expand: 2 → 2.1 → 2.1.1
All other branches are collapsed.
```

### Edge Cases

| Scenario | Action |
|---------|--------|
| Just started | Virtual target: all "1"s index (e.g., "1.1.1.1") not in map |
| After completion | Focus on the completed task |

### Examples

```typescript
// Full mode - root "1" ready, "2" pending
// "1.1" is first group, inherits ready from parent
{
  tree: [
    { index: "1", title: "Build app", status: "ready" },
    { index: "1.1", title: "Setup", status: "ready" },
    { index: "1.2", title: "Frontend", status: "pending" },
    { index: "1.3", title: "Backend", status: "pending" },
    { index: "2", title: "Write docs", status: "pending" },
    { index: "2.1", title: "Write contribution guide", status: "pending" },
    { index: "2.2", title: "Write API usage", status: "pending" }
  ],
  rootProgress: { completed: 0, total: 2 }
}

// Focus mode - last completed was "1.1"
// 1.2 and 1.3 in same parallel group, both now ready
{
  tree: [
    { index: "1", title: "Build app", status: "ready" },
    { index: "1.1", title: "Setup", status: "completed" },
    { index: "1.2", title: "Frontend", status: "ready" },
    { index: "1.3", title: "Backend", status: "ready" },
    { index: "2", title: "Write docs", status: "pending" }
  ],
  rootProgress: { completed: 0, total: 2 }
}

// Focus mode - root "1" completed, root "2" now ready
{
  tree: [
    { index: "1", title: "Build app", status: "completed" },
    { index: "2", title: "Write docs", status: "ready" }
  ],
  rootProgress: { completed: 1, total: 2 }
}
```
