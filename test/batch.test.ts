import { createTaskManager } from "../src/task-manager";
import { TaskTreeError } from "../src/errors";
import { Task, ROOT_INDEX } from "../src/types";

describe("Batch Randomized Testing", () => {
  let manager: ReturnType<typeof createTaskManager>;

  beforeEach(() => {
    manager = createTaskManager();
  });

  // Capture state snapshot for comparison
  function snapshotState() {
    const state = manager.getState();
    const { indexMap } = state;
    return {
      taskCount: indexMap.size,
      tasks: new Map(
        [...indexMap].map(([k, v]) => [
          k,
          { status: v.status, title: v.title, description: v.description },
        ])
      ),
    };
  }

  // Check invariants after each operation
  function checkInvariants() {
    const state = manager.getState();
    const { indexMap, rootList } = state;

    // 1. Root list tasks exist in indexMap
    for (const task of rootList.tasks) {
      expect(indexMap.has(task.index)).toBe(true);
    }

    // 2. Root task children synced with rootList
    const rootTask = indexMap.get(ROOT_INDEX)!;
    expect(rootTask.children).toBe(rootList);

    // 3. Every non-root task's parent references it in children
    for (const [index, task] of indexMap) {
      if (index === ROOT_INDEX) continue;
      const parent = indexMap.get(task.parentIndex);
      expect(parent).toBeDefined();
      expect(parent!.children).toBeDefined();
      const foundInParent = parent!.children!.tasks.some((t: Task) => t.index === index);
      expect(foundInParent).toBe(true);
    }

    // 4. No task is its own parent
    for (const [index, task] of indexMap) {
      expect(task.parentIndex).not.toBe(index);
    }

    // 5. Index format validation - all segments must be numbers
    for (const index of indexMap.keys()) {
      if (index === ROOT_INDEX) continue;
      for (const segment of index.split(".")) {
        expect(segment).toMatch(/^\d+$/);
      }
    }

    // 6. Focus mode shows at least one ready task when incomplete tasks remain (excluding root)
    const hasIncomplete = [...indexMap.values()].some(
      t => t.index !== ROOT_INDEX && t.status !== "completed"
    );
    if (hasIncomplete) {
      const result = manager.list({ mode: "focus" });
      const hasReady = result.tree.some(t => t.status === "ready");
      expect(hasReady).toBe(true);
    }
  }

  test("fuzzing with state comparison", () => {
    // Fixed initial state
    manager.createRoot({
      title: "Plan",
      items: [
        { title: "Root 1" },
        { title: "Root 2" },
        { title: "Root 3" },
      ],
    });

    manager.breakdown({
      items: [
        { title: "Child 1" },
        { title: "Child 2" },
      ],
      parent: "1",
    });

    manager.breakdown({
      items: [{ title: "Child" }],
      parent: "2",
    });
    checkInvariants();

    // Get a random task index from list output
    function randomTaskFromList(): string | null {
      const result = manager.list({ mode: "full" });
      if (result.tree.length === 0) return null;
      const idx = Math.floor(Math.random() * result.tree.length);
      return result.tree[idx].index;
    }

    const iterations = 500;

    for (let i = 0; i < iterations; i++) {
      const before = snapshotState();
      let threw = false;
      let wroteState = false;

      try {
        // Pick random operation
        const op = Math.floor(Math.random() * 6);
        const taskIdx = randomTaskFromList();

        switch (op) {
          case 0: { // Complete
            if (taskIdx && taskIdx !== ROOT_INDEX) {
              manager.complete({ index: taskIdx });
              wroteState = true;
            }
            break;
          }
          case 1: { // Update title
            if (taskIdx && taskIdx !== ROOT_INDEX) {
              manager.update({ index: taskIdx, title: `U${i}` });
              wroteState = true;
            }
            break;
          }
          case 2: { // Update description
            if (taskIdx && taskIdx !== ROOT_INDEX) {
              manager.update({ index: taskIdx, description: `D${i}` });
              wroteState = true;
            }
            break;
          }
          case 3: // List full
            manager.list({ mode: "full" });
            break;
          case 4: // List focus
            manager.list({ mode: "focus" });
            break;
          case 5: { // Get
            if (taskIdx && taskIdx !== ROOT_INDEX) {
              manager.get({ query: taskIdx });
            }
            break;
          }
        }
      } catch (e) {
        threw = true;
        expect(e).toBeInstanceOf(TaskTreeError);
      }

      // State comparison: failed writes shouldn't change state
      if (threw && wroteState) {
        const after = snapshotState();
        expect(after.taskCount).toBe(before.taskCount);
        expect(after.tasks).toEqual(before.tasks);
      }

      checkInvariants();
    }
  });

  test("fuzzing invalid inputs", () => {
    // Fixed initial state
    manager.createRoot({
      title: "Plan",
      items: [
        { title: "Root 1" },
        { title: "Root 2" },
      ],
    });
    checkInvariants();

    const iterations = 100;

    for (let i = 0; i < iterations; i++) {
      const before = snapshotState();
      const op = Math.floor(Math.random() * 3);

      expect(() => {
        switch (op) {
          case 0:
            manager.complete({ index: "nonexistent" });
            break;
          case 1:
            manager.update({ index: "nonexistent", title: "Bad" });
            break;
          case 2:
            manager.get({ query: "nonexistent" });
            break;
        }
      }).toThrow(TaskTreeError);

      // State must not change on error
      const after = snapshotState();
      expect(after.taskCount).toBe(before.taskCount);
      expect(after.tasks).toEqual(before.tasks);

      checkInvariants();
    }
  });
});
