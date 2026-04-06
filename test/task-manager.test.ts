/**
 * Nested Todo - TaskManager Tests
 * Based on: extensions/nested-todo/docs/test-plan.md
 */

import { createTaskManager } from "../src/task-manager";
import { TaskTreeError, ERRORS } from "../src/errors";
import { unlinkSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// Use an absolute path for the persistence file in the project directory
const PROJECT_ROOT = resolve(__dirname, "..");
const PERSISTENCE_FILE = resolve(PROJECT_ROOT, ".nested-todo.json");

function cleanupPersistence() {
  try {
    if (existsSync(PERSISTENCE_FILE)) {
      unlinkSync(PERSISTENCE_FILE);
    }
  } catch {
    // Ignore errors during cleanup
  }
}

beforeEach(() => {
  cleanupPersistence();
});

// Helper to check specific error code
function expectError(fn: () => void, code: string) {
  try {
    fn();
    throw new Error(`Expected ${code} but no error thrown`);
  } catch (e) {
    if (!(e instanceof TaskTreeError) || e.code !== code) {
      throw new Error(`Expected ${code} but got: ${e instanceof TaskTreeError ? e.code : e}`);
    }
  }
}

describe("Task Creation", () => {
  let manager: ReturnType<typeof createTaskManager>;

  beforeEach(() => {
    manager = createTaskManager();
  });

  describe("create root list", () => {
    test("creates root list with 3 items, first ready, rest pending", () => {
      const result = manager.createList({
        items: [
          { index: "1", title: "Task 1" },
          { index: "2", title: "Task 2" },
          { index: "3", title: "Task 3" },
        ],
        parent: null,
      });

      // Task "1" is ready (first in sequential chain)
      // Tasks "2", "3" are pending (blocked by "1")
      expect(manager.getTaskStatus("1")).toBe("ready");
      expect(manager.getTaskStatus("2")).toBe("pending");
      expect(manager.getTaskStatus("3")).toBe("pending");
    });

    test("second root creation with duplicate index is rejected", () => {
      manager.createList({
        items: [{ index: "1", title: "Task 1" }],
        parent: null,
      });

      expectError(() =>
        manager.createList({
          items: [{ index: "1", title: "Duplicate" }],
          parent: null,
        }),
        "LIST_EXISTS"
      );
    });

    test("duplicate indices in same call are rejected", () => {
      expectError(() =>
        manager.createList({
          items: [
            { index: "1", title: "Task 1" },
            { index: "1", title: "Duplicate" },
          ],
          parent: null,
        }),
        "OUT_OF_ORDER"
      );
    });

    test("create under non-existent parent throws internal error", () => {
      // Non-existent parent should throw an explicit internal error,
      // not a generic NOT_FOUND - this helps expose bugs in initialization
      expect(() =>
        manager.createList({
          items: [{ index: "99.1", title: "Child" }],
          parent: "99",
        })
      ).toThrow(/INTERNAL ERROR.*Parent task "99" not found/);
    });
  });

  describe("nested list status inheritance", () => {
    test("inherits parent status (ready)", () => {
      manager.createList({
        items: [{ index: "1", title: "Root" }],
        parent: null,
      });

      const result = manager.createList({
        items: [
          { index: "1.1", title: "Child 1" },
          { index: "1.2", title: "Child 2" },
        ],
        parent: "1",
      });

      // First child inherits parent's ready status
      expect(manager.getTaskStatus("1.1")).toBe("ready");
      // Second child blocked by first
      expect(manager.getTaskStatus("1.2")).toBe("pending");
    });

    test("inherits parent status (pending)", () => {
      // Create "1" (ready) and "2" (pending by being second)
      manager.createList({
        items: [{ index: "1", title: "Root 1" }],
        parent: null,
      });
      manager.createList({
        items: [{ index: "2", title: "Root 2" }],
        parent: null,
        mode: "append",
      });

      // Create children under "2" (pending parent)
      manager.createList({
        items: [
          { index: "2.1", title: "Child 1" },
          { index: "2.2", title: "Child 2" },
        ],
        parent: "2",
      });

      // Both children inherit pending from parent "2"
      expect(manager.getTaskStatus("2.1")).toBe("pending");
      expect(manager.getTaskStatus("2.2")).toBe("pending");
    });

    test("parallel group inheritance", () => {
      manager.createList({
        items: [{ index: "1", title: "Root" }],
        parent: null,
      });

      manager.createList({
        items: [
          { index: "1.1", title: "A1", parallelGroup: "A" },
          { index: "1.2", title: "A2", parallelGroup: "A" },
          { index: "1.3", title: "B1", parallelGroup: "B" },
          { index: "1.4", title: "B2", parallelGroup: "B" },
        ],
        parent: "1",
      });

      // Group A is ready (first group inherits parent)
      expect(manager.getTaskStatus("1.1")).toBe("ready");
      expect(manager.getTaskStatus("1.2")).toBe("ready");
      // Group B is pending (blocked by incomplete A)
      expect(manager.getTaskStatus("1.3")).toBe("pending");
      expect(manager.getTaskStatus("1.4")).toBe("pending");
    });

    test("deep expansion", () => {
      manager.createList({
        items: [{ index: "1", title: "Root" }],
        parent: null,
      });
      manager.createList({
        items: [{ index: "1.1", title: "Level 2" }],
        parent: "1",
      });

      manager.createList({
        items: [
          { index: "1.1.1", title: "Deep 1" },
          { index: "1.1.2", title: "Deep 2" },
          { index: "1.1.3", title: "Deep 3" },
        ],
        parent: "1.1",
      });

      expect(manager.getTaskStatus("1.1.1")).toBe("ready");
      expect(manager.getTaskStatus("1.1.2")).toBe("pending");
      expect(manager.getTaskStatus("1.1.3")).toBe("pending");
    });
  });

  describe("index validation", () => {
    test("invalid index scope rejected", () => {
      manager.createList({
        items: [{ index: "1", title: "Root" }],
        parent: null,
      });

      expect(() =>
        manager.createList({
          items: [{ index: "2", title: "Wrong scope" }],
          parent: "1",
        })
      ).toThrow(TaskTreeError);
    });

    test("depth violation rejected", () => {
      manager.createList({
        items: [{ index: "1", title: "Root" }],
        parent: null,
      });

      expect(() =>
        manager.createList({
          items: [
            { index: "1.1", title: "Child" },
            { index: "1.1.1", title: "Grandchild" },
          ],
          parent: "1",
        })
      ).toThrow(TaskTreeError);
    });

    test("gap in sequence rejected (create)", () => {
      manager.createList({
        items: [{ index: "1", title: "Root" }],
        parent: null,
      });

      expect(() =>
        manager.createList({
          items: [
            { index: "1.1", title: "Child 1" },
            { index: "1.3", title: "Child 3" },
          ],
          parent: "1",
        })
      ).toThrow(TaskTreeError);
    });

    test("append with gap rejected", () => {
      manager.createList({
        items: [{ index: "1", title: "Root" }],
        parent: null,
      });
      manager.createList({
        items: [{ index: "1.1", title: "Child 1" }],
        parent: "1",
      });

      expect(() =>
        manager.createList({
          items: [{ index: "1.3", title: "Child 3" }],
          parent: "1",
          mode: "append",
        })
      ).toThrow(TaskTreeError);
    });

    test("append with same group label creates new group, pending until previous complete", () => {
      // Create root with one parallel group
      manager.createList({
        items: [{ index: "1", title: "Root" }],
        parent: null,
      });
      manager.createList({
        items: [
          { index: "1.1", title: "Group1 Task 1", parallelGroup: "group-a" },
          { index: "1.2", title: "Group1 Task 2", parallelGroup: "group-a" },
        ],
        parent: "1",
      });

      // Check there are 2 groups
      const state = manager.getState();
      expect(state.indexMap.get("1")?.children?.groups.length).toBe(1);

      // Append with same group label - should create NEW group, not extend group-a
      manager.createList({
        items: [{ index: "1.3", title: "Group2 Task 1", parallelGroup: "group-a" }],
        parent: "1",
        mode: "append",
      });

      // Now there should be 2 groups
      const state2 = manager.getState();
      expect(state2.indexMap.get("1")?.children?.groups.length).toBe(2);

      // New group should be pending (previous group is not complete)
      expect(manager.getTaskStatus("1.3")).toBe("pending");

      // Complete group-a
      manager.complete({ index: "1.1" });
      manager.complete({ index: "1.2" });

      // Now group-b should be ready
      expect(manager.getTaskStatus("1.3")).toBe("ready");
    });

    test("append new parallel group after second group completes", () => {
      // Create root with two parallel groups
      manager.createList({
        items: [{ index: "1", title: "Root" }],
        parent: null,
      });
      manager.createList({
        items: [
          { index: "1.1", title: "Group1 Task 1", parallelGroup: "group-a" },
          { index: "1.2", title: "Group1 Task 2", parallelGroup: "group-a" },
          { index: "1.3", title: "Group2 Task 1", parallelGroup: "group-b" },
        ],
        parent: "1",
      });

      // First group (group-a) should be ready, second group pending
      expect(manager.getTaskStatus("1.1")).toBe("ready");
      expect(manager.getTaskStatus("1.2")).toBe("ready");
      expect(manager.getTaskStatus("1.3")).toBe("pending");

      // Complete first group
      manager.complete({ index: "1.1" });
      manager.complete({ index: "1.2" });

      // Second group should now be ready
      expect(manager.getTaskStatus("1.3")).toBe("ready");

      // Complete second group
      manager.complete({ index: "1.3" });

      // Append a new third group
      manager.createList({
        items: [
          { index: "1.4", title: "Group3 Task 1", parallelGroup: "group-c" },
        ],
        parent: "1",
        mode: "append",
      });

      // Third group should be ready (second group is complete)
      expect(manager.getTaskStatus("1.4")).toBe("ready");
    });
  });

  describe("mode behaviors", () => {
    test("expand completed task rejected", () => {
      manager.createList({
        items: [{ index: "1", title: "Root" }],
        parent: null,
      });
      manager.complete({ index: "1" });

      expect(() =>
        manager.createList({
          items: [{ index: "1.1", title: "Child" }],
          parent: "1",
        })
      ).toThrow(TaskTreeError);
    });

    test("new mode when children exist rejected", () => {
      manager.createList({
        items: [{ index: "1", title: "Root" }],
        parent: null,
      });
      manager.createList({
        items: [{ index: "1.1", title: "Child" }],
        parent: "1",
      });

      expect(() =>
        manager.createList({
          items: [{ index: "1.1", title: "New child" }],
          parent: "1",
          mode: "new",
        })
      ).toThrow(TaskTreeError);
    });

    test("append after siblings complete shows new task ready", () => {
      manager.createList({
        items: [{ index: "1", title: "Root" }],
        parent: null,
      });
      manager.createList({
        items: [
          { index: "1.1", title: "Child 1" },
          { index: "1.2", title: "Child 2" },
        ],
        parent: "1",
      });
      manager.complete({ index: "1.1" });
      manager.complete({ index: "1.2" });

      const result = manager.createList({
        items: [{ index: "1.3", title: "Child 3" }],
        parent: "1",
        mode: "append",
      });

      expect(manager.getTaskStatus("1.3")).toBe("ready");
    });

    test("append with incomplete siblings shows new task pending", () => {
      manager.createList({
        items: [{ index: "1", title: "Root" }],
        parent: null,
      });
      manager.createList({
        items: [{ index: "1.1", title: "Child 1" }],
        parent: "1",
      });

      const result = manager.createList({
        items: [{ index: "1.2", title: "Child 2" }],
        parent: "1",
        mode: "append",
      });

      expect(manager.getTaskStatus("1.2")).toBe("pending");
    });

    test("override mode at root level clears all tasks", () => {
      // Create some root-level tasks
      manager.createList({
        items: [
          { index: "1", title: "Task 1" },
          { index: "2", title: "Task 2" },
          { index: "3", title: "Task 3" },
        ],
        parent: null,
      });

      expect(manager.getTaskStatus("1")).toBe("ready");
      expect(manager.getTaskStatus("2")).toBe("pending");
      expect(manager.getTaskStatus("3")).toBe("pending");

      // Override with empty list - clears all root tasks
      const result = manager.createList({
        items: [],
        mode: "override",
      });

      const state = manager.getState();
      expect(state.indexMap.has("1")).toBe(false);
      expect(state.indexMap.has("2")).toBe(false);
      expect(state.indexMap.has("3")).toBe(false);
      expect(state.indexMap.size).toBe(1); // only root
      expect(state.rootList.tasks.length).toBe(0);
    });

    test("override mode at root level replaces all tasks", () => {
      // Create initial root tasks
      manager.createList({
        items: [
          { index: "1", title: "Old 1" },
          { index: "2", title: "Old 2" },
        ],
        parent: null,
      });

      // Override with new root tasks
      const result = manager.createList({
        items: [
          { index: "1", title: "New 1" },
          { index: "2", title: "New 2" },
          { index: "3", title: "New 3" },
        ],
        mode: "override",
      });

      const state = manager.getState();
      expect(state.indexMap.get("1")?.title).toBe("New 1");
      expect(state.indexMap.get("2")?.title).toBe("New 2");
      expect(state.indexMap.get("3")?.title).toBe("New 3");
      expect(state.rootList.tasks.length).toBe(3);
    });

    test("override mode replaces existing children", () => {
      manager.createList({
        items: [{ index: "1", title: "Root" }],
        parent: null,
      });
      manager.createList({
        items: [
          { index: "1.1", title: "Old 1" },
          { index: "1.2", title: "Old 2" },
        ],
        parent: "1",
      });

      manager.createList({
        items: [
          { index: "1.1", title: "New 1" },
          { index: "1.2", title: "New 2" },
          { index: "1.3", title: "New 3" },
        ],
        parent: "1",
        mode: "override",
      });

      // Old children should be replaced
      const state = manager.getState();
      expect(state.indexMap.get("1.1")?.title).toBe("New 1");
      expect(state.indexMap.get("1.2")?.title).toBe("New 2");
      expect(state.indexMap.get("1.3")?.title).toBe("New 3");
      expect(state.indexMap.size).toBe(5); // root, 1, 1.1, 1.2, 1.3
    });

    test("override mode removes old children when new list is shorter", () => {
      manager.createList({
        items: [{ index: "1", title: "Root" }],
        parent: null,
      });
      manager.createList({
        items: [
          { index: "1.1", title: "Old 1" },
          { index: "1.2", title: "Old 2" },
          { index: "1.3", title: "Old 3" },
        ],
        parent: "1",
      });

      // Override with only one child
      manager.createList({
        items: [{ index: "1.1", title: "New 1" }],
        parent: "1",
        mode: "override",
      });

      // Old children should be deleted
      const state = manager.getState();
      expect(state.indexMap.has("1.2")).toBe(false);
      expect(state.indexMap.has("1.3")).toBe(false);
      expect(state.indexMap.get("1.1")?.title).toBe("New 1");
      expect(state.indexMap.size).toBe(3); // root, 1, 1.1
    });

    test("override mode with empty items clears children", () => {
      manager.createList({
        items: [{ index: "1", title: "Root" }],
        parent: null,
      });
      manager.createList({
        items: [
          { index: "1.1", title: "Child 1" },
          { index: "1.2", title: "Child 2" },
        ],
        parent: "1",
      });

      // Clear children with empty items
      manager.createList({
        items: [],
        parent: "1",
        mode: "override",
      });

      const state = manager.getState();
      expect(state.indexMap.has("1.1")).toBe(false);
      expect(state.indexMap.has("1.2")).toBe(false);
      expect(state.indexMap.get("1")?.title).toBe("Root");
      expect(state.indexMap.size).toBe(2); // root, 1
      // Parent's children should be empty
      const root1 = state.indexMap.get("1");
      expect(root1?.children?.tasks.length).toBe(0);
      expect(root1?.children?.groups.length).toBe(0);
    });
  });
});

describe("Task Completion", () => {
  let manager: ReturnType<typeof createTaskManager>;

  beforeEach(() => {
    manager = createTaskManager();
  });

  test("complete non-existent rejected", () => {
    expectError(() => manager.complete({ index: "99" }), "NOT_FOUND");
  });

  test("complete ready task marks it completed", () => {
    manager.createList({
      items: [{ index: "1", title: "Task" }],
      parent: null,
    });

    const result = manager.complete({ index: "1" });
    expect(manager.getTaskStatus("1")).toBe("completed");
  });

  test("pending task is rejected", () => {
    manager.createList({
      items: [{ index: "1", title: "Task 1" }],
      parent: null,
    });
    manager.createList({
      items: [{ index: "2", title: "Task 2" }],
      parent: null,
      mode: "append",
    });

    expect(() => manager.complete({ index: "2" })).toThrow(TaskTreeError);
  });

  test("task with incomplete children rejected", () => {
    manager.createList({
      items: [{ index: "1", title: "Parent" }],
      parent: null,
    });
    manager.createList({
      items: [{ index: "1.1", title: "Child" }],
      parent: "1",
    });

    expect(() => manager.complete({ index: "1" })).toThrow(TaskTreeError);
  });

  test("already completed task rejected", () => {
    manager.createList({
      items: [{ index: "1", title: "Task" }],
      parent: null,
    });
    manager.complete({ index: "1" });

    expect(() => manager.complete({ index: "1" })).toThrow(TaskTreeError);
  });

  test("completing first group unblocks second", () => {
    manager.createList({
      items: [{ index: "1", title: "Root" }],
      parent: null,
    });
    manager.createList({
      items: [
        { index: "1.1", title: "Group A", parallelGroup: "A" },
        { index: "1.2", title: "Group B", parallelGroup: "B" },
      ],
      parent: "1",
    });

    manager.complete({ index: "1.1" });
    expect(manager.getTaskStatus("1.2")).toBe("ready");
  });

  test("completing one in parallel group doesn't unblock next group", () => {
    manager.createList({
      items: [{ index: "1", title: "Root" }],
      parent: null,
    });
    manager.createList({
      items: [
        { index: "1.1", title: "A1", parallelGroup: "A" },
        { index: "1.2", title: "A2", parallelGroup: "A" },
        { index: "1.3", title: "B1", parallelGroup: "B" },
      ],
      parent: "1",
    });

    manager.complete({ index: "1.2" });
    expect(manager.getTaskStatus("1.1")).toBe("ready"); // still ready (same group)
    expect(manager.getTaskStatus("1.3")).toBe("pending"); // still blocked by incomplete A
  });

  test("completing parallel group unblocks next", () => {
    manager.createList({
      items: [{ index: "1", title: "Root" }],
      parent: null,
    });
    manager.createList({
      items: [
        { index: "1.1", title: "A1", parallelGroup: "A" },
        { index: "1.2", title: "A2", parallelGroup: "A" },
        { index: "1.3", title: "B1", parallelGroup: "B" },
      ],
      parent: "1",
    });

    manager.complete({ index: "1.1" });
    manager.complete({ index: "1.2" });
    expect(manager.getTaskStatus("1.3")).toBe("ready");
  });

  test("completing child requires parent ready", () => {
    manager.createList({
      items: [{ index: "1", title: "Parent" }],
      parent: null,
    });
    manager.createList({
      items: [{ index: "1.1", title: "Child" }],
      parent: "1",
    });

    manager.complete({ index: "1.1" });
    expect(manager.getTaskStatus("1")).toBe("ready");
  });

  test("completing root unblocks next root", () => {
    manager.createList({
      items: [{ index: "1", title: "Root 1" }],
      parent: null,
    });
    manager.createList({
      items: [{ index: "2", title: "Root 2" }],
      parent: null,
      mode: "append",
    });

    manager.complete({ index: "1" });
    expect(manager.getTaskStatus("2")).toBe("ready");
  });

  test("completing parent marks completed", () => {
    manager.createList({
      items: [{ index: "1", title: "Parent" }],
      parent: null,
    });
    manager.createList({
      items: [{ index: "1.1", title: "Child" }],
      parent: "1",
    });
    manager.complete({ index: "1.1" });
    manager.complete({ index: "1" });

    expect(manager.getTaskStatus("1")).toBe("completed");
  });

  test("complete via ambiguous title rejected", () => {
    manager.createList({
      items: [
        { index: "1", title: "Task" },
        { index: "2", title: "Task" },
      ],
      parent: null,
    });

    expect(() => manager.complete({ index: "Task" })).toThrow(TaskTreeError);
  });

  test("complete result includes accurate rootProgress", () => {
    manager.createList({
      items: [
        { index: "1", title: "Root 1" },
        { index: "2", title: "Root 2" },
      ],
      parent: null,
    });

    const result = manager.complete({ index: "1" });
    expect(result.rootProgress).toEqual({ completed: 1, total: 2 });
  });
});

describe("Task Query", () => {
  let manager: ReturnType<typeof createTaskManager>;

  beforeEach(() => {
    manager = createTaskManager();
  });

  test("get by index returns detail", () => {
    manager.createList({
      items: [{ index: "1", title: "Task", description: "Description" }],
      parent: null,
    });

    const result = manager.get({ query: "1" });
    expect(result.task.index).toBe("1");
    expect(result.task.title).toBe("Task");
    expect(result.task.description).toBe("Description");
  });

  test("get by unique title returns task", () => {
    manager.createList({
      items: [
        { index: "1", title: "Unique" },
        { index: "2", title: "Also Unique" },
      ],
      parent: null,
    });

    const result = manager.get({ query: "Unique" });
    expect(result.task.index).toBe("1");
  });

  test("get returns correct group context", () => {
    manager.createList({
      items: [{ index: "1", title: "Parent" }],
      parent: null,
    });
    manager.createList({
      items: [
        { index: "1.1", title: "A1", parallelGroup: "A" },
        { index: "1.2", title: "A2", parallelGroup: "A" },
        { index: "1.3", title: "B1", parallelGroup: "B" },
      ],
      parent: "1",
    });

    const result = manager.get({ query: "1.2" });
    // Task 1 is the parent, not a sibling, so previousGroup should be empty
    expect(result.parent?.index).toBe("1");
    expect(result.previousGroup.map(t => t.index)).toEqual([]);
    expect(result.currentGroup.map(t => t.index)).toEqual(["1.1", "1.2"]);
    expect(result.nextGroup.map(t => t.index)).toEqual(["1.3"]);
  });

  test("ambiguous title rejected", () => {
    manager.createList({
      items: [
        { index: "1", title: "Task" },
        { index: "2", title: "Task" },
      ],
      parent: null,
    });

    expect(() => manager.get({ query: "Task" })).toThrow(TaskTreeError);
  });

  test("get non-existent rejected", () => {
    expect(() => manager.get({ query: "99" })).toThrow(TaskTreeError);
  });

  test("get root task returns root with children", () => {
    manager.createList({
      items: [
        { index: "1", title: "Task 1" },
        { index: "2", title: "Task 2" },
      ],
      parent: null,
    });

    const result = manager.get({ query: "root" });
    expect(result.task.index).toBe("root");
    expect(result.task.title).toBe("Root");
    expect(result.parent).toBeUndefined();
    // Root's children should be the root-level tasks
    expect(result.currentGroup.map(t => t.index)).toEqual(["1", "2"]);
    expect(result.previousGroup).toEqual([]);
    expect(result.nextGroup).toEqual([]);
  });
});

describe("Task Update", () => {
  let manager: ReturnType<typeof createTaskManager>;

  beforeEach(() => {
    manager = createTaskManager();
  });

  test("update non-existent rejected", () => {
    expectError(() => manager.update({ index: "99", title: "New" }), "NOT_FOUND");
  });

  test("update root task rejected", () => {
    expectError(() => manager.update({ index: "root", title: "New" }), "ROOT_TASK");
  });

  test("update completed task rejected", () => {
    manager.createList({
      items: [{ index: "1", title: "Task" }],
      parent: null,
    });
    manager.complete({ index: "1" });

    expectError(() => manager.update({ index: "1", title: "New" }), "TASK_COMPLETED");
  });

  test("update title", () => {
    manager.createList({
      items: [{ index: "1", title: "Old Title" }],
      parent: null,
    });

    const result = manager.update({ index: "1", title: "New Title" });
    expect(result.task.title).toBe("New Title");
    expect(manager.getState().getTask("1")!.title).toBe("New Title");
  });

  test("clear description", () => {
    manager.createList({
      items: [{ index: "1", title: "Task", description: "Desc" }],
      parent: null,
    });

    manager.update({ index: "1", description: null });
    expect(manager.getState().getTask("1")!.description).toBeUndefined();
  });

  test("update description with value", () => {
    manager.createList({
      items: [{ index: "1", title: "Task" }],
      parent: null,
    });

    const result = manager.update({ index: "1", description: "New description" });
    expect(result.task.description).toBe("New description");
  });

  test("update via ambiguous title rejected", () => {
    manager.createList({
      items: [
        { index: "1", title: "Task" },
        { index: "2", title: "Task" },
      ],
      parent: null,
    });

    expect(() => manager.update({ index: "Task", title: "New" })).toThrow(TaskTreeError);
  });
});

describe("Task List", () => {
  let manager: ReturnType<typeof createTaskManager>;

  beforeEach(() => {
    manager = createTaskManager();
  });

  test("empty state returns empty tree", () => {
    const result = manager.list({ mode: "focus" });
    expect(result.tree).toHaveLength(0);
    expect(result.rootProgress).toEqual({ completed: 0, total: 0 });
  });

  test("focus mode fresh start shows oldest leaf", () => {
    manager.createList({
      items: [{ index: "1", title: "Root 1" }],
      parent: null,
    });
    manager.createList({
      items: [{ index: "1.1", title: "L2" }],
      parent: "1",
    });
    manager.createList({
      items: [{ index: "1.1.1", title: "Leaf" }],
      parent: "1.1",
    });
    manager.createList({
      items: [{ index: "2", title: "Root 2" }],
      parent: null,
      mode: "append",
    });
    manager.createList({
      items: [{ index: "2.1", title: "L2" }],
      parent: "2",
    });

    const result = manager.list({ mode: "focus" });
    // Should show path to oldest leaf: 1 → 1.1 → 1.1.1
    const indices = result.tree.map(t => t.index);
    expect(indices).toContain("1");
    expect(indices).toContain("1.1");
    expect(indices).toContain("1.1.1");
    // 2.1 should not be shown (collapsed)
    expect(indices).not.toContain("2.1");
  });

  test("focus mode shows path to last completed task", () => {
    // Create tree 1 with subtree
    manager.createList({
      items: [{ index: "1", title: "Root 1" }],
      parent: null,
    });
    manager.createList({
      items: [{ index: "1.1", title: "Child" }],
      parent: "1",
    });
    manager.createList({
      items: [{ index: "1.1.1", title: "Leaf" }],
      parent: "1.1",
    });

    // Create tree 2
    manager.createList({
      items: [{ index: "2", title: "Root 2" }],
      parent: null,
      mode: "append",
    });

    // Complete 1.1.1, then 1.1 (lastCompletedIndex becomes 1.1)
    manager.complete({ index: "1.1.1" });
    manager.complete({ index: "1.1" });

    const result = manager.list({ mode: "focus" });
    const indices = result.tree.map(t => t.index);

    // Focus mode shows all tasks, recurses only on path to target
    expect(indices).toContain("1");
    expect(indices).toContain("1.1");
    // 1.1.1 not shown (target is 1.1, don't recurse into its children)
    expect(indices).not.toContain("1.1.1");
    // Root 2 is shown but not expanded
    expect(indices).toContain("2");
    expect(indices).not.toContain("2.1");
  });

  test("full mode shows entire tree", () => {
    manager.createList({
      items: [{ index: "1", title: "Root 1" }],
      parent: null,
    });
    manager.createList({
      items: [{ index: "1.1", title: "L2" }],
      parent: "1",
    });
    manager.createList({
      items: [{ index: "1.1.1", title: "Leaf" }],
      parent: "1.1",
    });
    manager.createList({
      items: [{ index: "2", title: "Root 2" }],
      parent: null,
      mode: "append",
    });
    manager.createList({
      items: [{ index: "2.1", title: "L2" }],
      parent: "2",
    });

    const result = manager.list({ mode: "full" });
    const indices = result.tree.map(t => t.index);
    expect(indices).toEqual(["1", "1.1", "1.1.1", "2", "2.1"]);
  });

  test("focus mode all done shows root tasks", () => {
    manager.createList({
      items: [{ index: "1", title: "Root 1" }],
      parent: null,
    });
    manager.createList({
      items: [{ index: "2", title: "Root 2" }],
      parent: null,
      mode: "append",
    });
    manager.complete({ index: "1" });
    manager.complete({ index: "2" });

    const result = manager.list({ mode: "focus" });
    expect(result.tree.length).toBeGreaterThan(0);
    expect(result.rootProgress.completed).toBe(2);
    expect(result.rootProgress.total).toBe(2);
  });
});
