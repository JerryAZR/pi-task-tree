/**
 * Nested Todo - TaskManager Tests
 * Based on: extensions/nested-todo/docs/test-plan.md
 */

import { createTaskManager } from "../src/task-manager";
import { TaskTreeError, ERRORS } from "../src/errors";
import { unlinkSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const PROJECT_ROOT = resolve(__dirname, "..");
const PERSISTENCE_DIR = resolve(PROJECT_ROOT, ".pi/task_tree");
const LISTS_DIR = resolve(PERSISTENCE_DIR, "lists");
const ROOTS_FILE = resolve(PERSISTENCE_DIR, "roots.jsonl");

function cleanupPersistence() {
  try {
    if (existsSync(LISTS_DIR)) {
      const files = require("fs").readdirSync(LISTS_DIR);
      for (const file of files) {
        if (file.endsWith(".jsonl")) {
          unlinkSync(resolve(LISTS_DIR, file));
        }
      }
    }
    if (existsSync(ROOTS_FILE)) {
      unlinkSync(ROOTS_FILE);
    }
  } catch {
    // Ignore errors during cleanup
  }
}

beforeEach(() => {
  cleanupPersistence();
});

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

  describe("create root", () => {
    test("creates root list with 3 items, first ready, rest pending", () => {
      const result = manager.createRoot({
        title: "Plan",
        items: [
          { title: "Task 1" },
          { title: "Task 2" },
          { title: "Task 3" },
        ],
      });

      expect(manager.getTaskStatus("1")).toBe("ready");
      expect(manager.getTaskStatus("2")).toBe("pending");
      expect(manager.getTaskStatus("3")).toBe("pending");
    });

    test("second root creation is allowed (creates new root)", () => {
      manager.createRoot({
        title: "Plan 1",
        items: [{ title: "Task" }],
      });

      manager.createRoot({
        title: "Plan 2",
        items: [{ title: "Task" }],
      });

      const roots = manager.listRoots();
      expect(roots.roots.length).toBe(2);
    });

    test("create under non-existent parent throws internal error", () => {
      manager.createRoot({
        title: "Plan",
        items: [{ title: "Parent" }],
      });

      expect(() =>
        manager.breakdown({
          items: [{ title: "Child" }],
          parent: "99",
        })
      ).toThrow(/INTERNAL ERROR.*Parent task "99" not found/);
    });
  });

  describe("breakdown", () => {
    test("creates subtasks under parent", () => {
      manager.createRoot({
        title: "Plan",
        items: [{ title: "Parent" }],
      });

      manager.breakdown({
        items: [
          { title: "Child 1" },
          { title: "Child 2" },
        ],
        parent: "1",
      });

      expect(manager.getTaskStatus("1.1")).toBe("ready");
      expect(manager.getTaskStatus("1.2")).toBe("pending");
    });

    test("breakdown requires active root", () => {
      expect(() =>
        manager.breakdown({
          items: [{ title: "Orphan" }],
          parent: "1",
        })
      ).toThrow("No active task list");
    });
  });

  describe("nested list status inheritance", () => {
    test("inherits parent status (ready)", () => {
      manager.createRoot({
        title: "Plan",
        items: [{ title: "Root" }],
      });

      manager.breakdown({
        items: [
          { title: "Child 1" },
          { title: "Child 2" },
        ],
        parent: "1",
      });

      expect(manager.getTaskStatus("1.1")).toBe("ready");
      expect(manager.getTaskStatus("1.2")).toBe("pending");
    });

    test("first child inherits parent ready status", () => {
      manager.createRoot({
        title: "Plan",
        items: [{ title: "Root" }],
      });

      manager.breakdown({
        items: [{ title: "Child" }],
        parent: "1",
      });

      expect(manager.getTaskStatus("1.1")).toBe("ready");
    });
  });

  describe("parallel group behavior", () => {
    test("append with same group label creates new group, pending until previous complete", () => {
      manager.createRoot({
        title: "Plan",
        items: [{ title: "Parent" }],
      });

      manager.breakdown({
        items: [
          { title: "Group1 Task 1", parallelGroup: "group-a" },
          { title: "Group1 Task 2", parallelGroup: "group-a" },
        ],
        parent: "1",
      });

      const state = manager.getState();
      expect(state.indexMap.get("1")?.children?.groups.length).toBe(1);

      manager.breakdown({
        items: [{ title: "Group2 Task 1", parallelGroup: "group-a" }],
        parent: "1",
        mode: "append",
      });

      const state2 = manager.getState();
      expect(state2.indexMap.get("1")?.children?.groups.length).toBe(2);
      expect(manager.getTaskStatus("1.3")).toBe("pending");
    });
  });

  describe("mode behaviors", () => {
    test("expand completed task rejected", () => {
      manager.createRoot({
        title: "Plan",
        items: [{ title: "Task" }],
      });
      manager.complete({ index: "1" });

      expectError(() =>
        manager.breakdown({
          items: [{ title: "Child" }],
          parent: "1",
        }),
        "TASK_COMPLETED"
      );
    });

    test("override mode replaces existing children", () => {
      manager.createRoot({
        title: "Plan",
        items: [{ title: "Parent" }],
      });

      manager.breakdown({
        items: [
          { title: "Old 1" },
          { title: "Old 2" },
        ],
        parent: "1",
      });

      manager.breakdown({
        items: [
          { title: "New 1" },
          { title: "New 2" },
          { title: "New 3" },
        ],
        parent: "1",
        mode: "override",
      });

      const state = manager.getState();
      expect(state.indexMap.get("1.1")?.title).toBe("New 1");
      expect(state.indexMap.get("1.2")?.title).toBe("New 2");
      expect(state.indexMap.get("1.3")?.title).toBe("New 3");
    });

    test("override mode removes old children when new list is shorter", () => {
      manager.createRoot({
        title: "Plan",
        items: [{ title: "Parent" }],
      });

      manager.breakdown({
        items: [
          { title: "Old 1" },
          { title: "Old 2" },
          { title: "Old 3" },
        ],
        parent: "1",
      });

      manager.breakdown({
        items: [{ title: "New 1" }],
        parent: "1",
        mode: "override",
      });

      const state = manager.getState();
      expect(state.indexMap.has("1.2")).toBe(false);
      expect(state.indexMap.has("1.3")).toBe(false);
    });

    test("override mode with empty items clears children", () => {
      manager.createRoot({
        title: "Plan",
        items: [{ title: "Parent" }],
      });

      manager.breakdown({
        items: [
          { title: "Child 1" },
          { title: "Child 2" },
        ],
        parent: "1",
      });

      manager.breakdown({
        items: [],
        parent: "1",
        mode: "override",
      });

      const state = manager.getState();
      expect(state.indexMap.has("1.1")).toBe(false);
      expect(state.indexMap.has("1.2")).toBe(false);
      expect(state.indexMap.get("1")?.title).toBe("Parent");
    });
  });
});

describe("Task Completion", () => {
  let manager: ReturnType<typeof createTaskManager>;

  beforeEach(() => {
    manager = createTaskManager();
  });

  test("complete non-existent rejected", () => {
    manager.createRoot({
      title: "Plan",
      items: [{ title: "Task" }],
    });

    expectError(() => manager.complete({ index: "99" }), "NOT_FOUND");
  });

  test("complete ready task marks it completed", () => {
    manager.createRoot({
      title: "Plan",
      items: [{ title: "Task" }],
    });

    const result = manager.complete({ index: "1" });
    expect(manager.getTaskStatus("1")).toBe("completed");
  });

  test("complete pending task rejected", () => {
    manager.createRoot({
      title: "Plan",
      items: [{ title: "First" }, { title: "Second" }],
    });

    expectError(() => manager.complete({ index: "2" }), "NOT_READY");
  });

  test("complete unblocks next sequential task", () => {
    manager.createRoot({
      title: "Plan",
      items: [
        { title: "First" },
        { title: "Second" },
        { title: "Third" },
      ],
    });

    manager.complete({ index: "1" });
    expect(manager.getTaskStatus("2")).toBe("ready");
    expect(manager.getTaskStatus("3")).toBe("pending");

    manager.complete({ index: "2" });
    expect(manager.getTaskStatus("3")).toBe("ready");
  });

  test("complete last task marks root list complete", () => {
    manager.createRoot({
      title: "Plan",
      items: [{ title: "Task" }],
    });

    manager.complete({ index: "1" });
    const result = manager.list({ mode: "full" });
    expect(result.rootProgress.completed).toBe(1);
  });

  test("complete by title", () => {
    manager.createRoot({
      title: "Plan",
      items: [{ title: "Unique" }],
    });

    manager.complete({ index: "Unique" });
    expect(manager.getTaskStatus("1")).toBe("completed");
  });

  test("complete already completed rejected", () => {
    manager.createRoot({
      title: "Plan",
      items: [{ title: "Task" }],
    });

    manager.complete({ index: "1" });
    expectError(() => manager.complete({ index: "1" }), "ALREADY_COMPLETED");
  });
});

describe("Task Update", () => {
  let manager: ReturnType<typeof createTaskManager>;

  beforeEach(() => {
    manager = createTaskManager();
  });

  test("update non-existent rejected", () => {
    manager.createRoot({
      title: "Plan",
      items: [{ title: "Task" }],
    });

    expectError(() => manager.update({ index: "99", title: "New" }), "NOT_FOUND");
  });

  test("update root task rejected", () => {
    manager.createRoot({
      title: "Plan",
      items: [{ title: "Task" }],
    });

    expectError(() => manager.update({ index: "root", title: "New" }), "ROOT_TASK");
  });

  test("update completed task rejected", () => {
    manager.createRoot({
      title: "Plan",
      items: [{ title: "Task" }],
    });

    manager.complete({ index: "1" });

    expectError(() => manager.update({ index: "1", title: "New" }), "TASK_COMPLETED");
  });

  test("update title", () => {
    manager.createRoot({
      title: "Plan",
      items: [{ title: "Task" }],
    });

    const result = manager.update({ index: "1", title: "New Title" });
    expect(result.task.title).toBe("New Title");
    expect(manager.getState().getTask("1")!.title).toBe("New Title");
  });

  test("update description to null clears", () => {
    manager.createRoot({
      title: "Plan",
      items: [{ title: "Task", description: "Old" }],
    });

    manager.update({ index: "1", description: null });
    expect(manager.getState().getTask("1")!.description).toBeUndefined();
  });

  test("update description", () => {
    manager.createRoot({
      title: "Plan",
      items: [{ title: "Task" }],
    });

    const result = manager.update({ index: "1", description: "New description" });
    expect(result.task.description).toBe("New description");
  });

  test("update by index works", () => {
    manager.createRoot({
      title: "Plan",
      items: [{ title: "Task" }],
    });

    const result = manager.update({ index: "1", title: "New" });
    expect(result.task.title).toBe("New");
  });
});

describe("Task Retrieval", () => {
  let manager: ReturnType<typeof createTaskManager>;

  beforeEach(() => {
    manager = createTaskManager();
  });

  test("get by index returns detail", () => {
    manager.createRoot({
      title: "Plan",
      items: [{ title: "Task", description: "Description" }],
    });

    const result = manager.get({ query: "1" });
    expect(result.task.index).toBe("1");
    expect(result.task.title).toBe("Task");
    expect(result.task.description).toBe("Description");
  });

  test("get by unique title returns task", () => {
    manager.createRoot({
      title: "Plan",
      items: [{ title: "Unique" }, { title: "Also Unique" }],
    });

    const result = manager.get({ query: "Unique" });
    expect(result.task.index).toBe("1");
  });

  test("get returns correct group context", () => {
    manager.createRoot({
      title: "Plan",
      items: [{ title: "Parent" }],
    });

    manager.breakdown({
      items: [
        { title: "A1", parallelGroup: "A" },
        { title: "A2", parallelGroup: "A" },
        { title: "B1", parallelGroup: "B" },
      ],
      parent: "1",
    });

    const result = manager.get({ query: "1.2" });
    expect(result.parent?.index).toBe("1");
    expect(result.previousGroup.map(t => t.index)).toEqual([]);
    expect(result.currentGroup.map(t => t.index)).toEqual(["1.1", "1.2"]);
    expect(result.nextGroup.map(t => t.index)).toEqual(["1.3"]);
  });

  test("ambiguous title rejected", () => {
    manager.createRoot({
      title: "Plan",
      items: [{ title: "Task" }, { title: "Task" }],
    });

    expectError(() => manager.get({ query: "Task" }), "AMBIGUOUS");
  });

  test("get non-existent rejected", () => {
    manager.createRoot({
      title: "Plan",
      items: [{ title: "Task" }],
    });

    expectError(() => manager.get({ query: "99" }), "NOT_FOUND");
  });

  test("get root task returns root with children", () => {
    manager.createRoot({
      title: "Plan",
      items: [
        { title: "Task 1" },
        { title: "Task 2" },
      ],
    });

    const result = manager.get({ query: "root" });
    expect(result.task.index).toBe("root");
    expect(result.task.title).toBe("Root");
    expect(result.parent).toBeUndefined();
    expect(result.currentGroup.map(t => t.index)).toEqual(["1", "2"]);
    expect(result.previousGroup).toEqual([]);
    expect(result.nextGroup).toEqual([]);
  });
});

describe("Root Management", () => {
  let manager: ReturnType<typeof createTaskManager>;

  beforeEach(() => {
    manager = createTaskManager();
  });

  test("listRoots returns empty initially", () => {
    const result = manager.listRoots();
    expect(result.roots).toEqual([]);
    expect(result.activeId).toBeNull();
  });

  test("createRoot sets active root", () => {
    const result = manager.createRoot({
      title: "My Plan",
      items: [{ title: "Task" }],
    });

    expect(result.root.title).toBe("My Plan");
    expect(result.root.id).toBeDefined();

    const roots = manager.listRoots();
    expect(roots.activeId).toBe(result.root.id);
  });

  test("activateRoot switches active root", () => {
    const root1 = manager.createRoot({
      title: "Plan 1",
      items: [{ title: "Task 1" }],
    });

    const root2 = manager.createRoot({
      title: "Plan 2",
      items: [{ title: "Task 2" }],
    });

    manager.activateRoot({ id: root1.root.id });

    const state = manager.getState();
    expect(state.indexMap.has("1")).toBe(true);
  });

  test("activateRoot throws for non-existent", () => {
    expectError(() => manager.activateRoot({ id: "nonexistent" }), "ROOT_NOT_FOUND");
  });

  test("deleteRoot removes root", () => {
    const root = manager.createRoot({
      title: "Plan",
      items: [{ title: "Task" }],
    });

    manager.deleteRoot({ id: root.root.id });

    const roots = manager.listRoots();
    expect(roots.roots.length).toBe(0);
  });

  test("deleteRoot clears active if deleted root was active", () => {
    const root = manager.createRoot({
      title: "Plan",
      items: [{ title: "Task" }],
    });

    manager.deleteRoot({ id: root.root.id });

    const result = manager.list({ mode: "full" });
    expect(result.tree).toEqual([]);
  });
});
