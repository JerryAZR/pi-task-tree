/**
 * Nested Todo - TaskManager Tests
 * Model: completed/deleted flags, parent completion rules, [⏳] derived display
 */

import { createTaskManager } from "../src/task-manager";
import { TaskTreeError, ERRORS } from "../src/errors";
import { unlinkSync, existsSync } from "node:fs";
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
    test("creates root list with items", () => {
      const result = manager.createRoot({
        title: "Plan",
        items: [
          { title: "Task 1" },
          { title: "Task 2" },
          { title: "Task 3" },
        ],
      });

      expect(manager.isCompleted("1")).toBe(false);
      expect(manager.isCompleted("2")).toBe(false);
      expect(manager.isCompleted("3")).toBe(false);
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

    test("create under non-existent parent throws NOT_FOUND", () => {
      manager.createRoot({
        title: "Plan",
        items: [{ title: "Parent" }],
      });

      expectError(() =>
        manager.breakdown({
          items: [{ title: "Child" }],
          parent: "99",
        })
      , "NOT_FOUND");
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

      expect(manager.isCompleted("1.1")).toBe(false);
      expect(manager.isCompleted("1.2")).toBe(false);
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

  describe("addTask (extend plan)", () => {
    test("adds tasks to root level", () => {
      manager.createRoot({
        title: "Plan",
        items: [{ title: "Task 1" }],
      });

      manager.addTask({
        items: [{ title: "Task 2" }, { title: "Task 3" }],
      });

      const state = manager.getState();
      expect(state.indexMap.get("2")?.title).toBe("Task 2");
      expect(state.indexMap.get("3")?.title).toBe("Task 3");
    });

    test("addTask requires active root", () => {
      expect(() =>
        manager.addTask({
          items: [{ title: "Orphan" }],
        })
      ).toThrow("No active task list");
    });

    test("override mode replaces root tasks", () => {
      manager.createRoot({
        title: "Plan",
        items: [{ title: "Old 1" }, { title: "Old 2" }],
      });

      manager.addTask({
        items: [{ title: "New 1" }],
        mode: "override",
      });

      const state = manager.getState();
      expect(state.indexMap.has("1")).toBe(true);
      expect(state.indexMap.get("1")?.title).toBe("New 1");
      expect(state.indexMap.has("2")).toBe(false);
    });
  });

  describe("mode behaviors", () => {
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
    });
  });
});

describe("Task Complete", () => {
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

  test("complete root task rejected", () => {
    manager.createRoot({
      title: "Plan",
      items: [{ title: "Task" }],
    });

    expectError(() => manager.complete({ index: "root" }), "ROOT_TASK");
  });

  test("delete root task rejected", () => {
    manager.createRoot({
      title: "Plan",
      items: [{ title: "Task" }],
    });

    expectError(() => manager.delete({ index: "root" }), "ROOT_TASK");
  });

  test("complete marks task done", () => {
    manager.createRoot({
      title: "Plan",
      items: [{ title: "Task" }],
    });

    manager.complete({ index: "1" });
    expect(manager.isCompleted("1")).toBe(true);
  });

  test("complete by title", () => {
    manager.createRoot({
      title: "Plan",
      items: [{ title: "Unique" }],
    });

    manager.complete({ index: "Unique" });
    expect(manager.isCompleted("1")).toBe(true);
  });

  test("complete already completed rejected", () => {
    manager.createRoot({
      title: "Plan",
      items: [{ title: "Task" }],
    });

    manager.complete({ index: "1" });
    expectError(() => manager.complete({ index: "1" }), "ALREADY_COMPLETED");
  });

  test("complete any sibling in any order", () => {
    manager.createRoot({
      title: "Plan",
      items: [
        { title: "First" },
        { title: "Second" },
        { title: "Third" },
      ],
    });

    // Can complete any task in any order
    manager.complete({ index: "3" });
    expect(manager.isCompleted("3")).toBe(true);
    expect(manager.isCompleted("1")).toBe(false);
    expect(manager.isCompleted("2")).toBe(false);

    manager.complete({ index: "1" });
    expect(manager.isCompleted("1")).toBe(true);
  });

  test("cannot complete parent with incomplete children", () => {
    manager.createRoot({
      title: "Plan",
      items: [{ title: "Parent" }],
    });

    manager.breakdown({
      items: [{ title: "Child 1" }, { title: "Child 2" }],
      parent: "1",
    });

    // Cannot complete parent until children are done
    expectError(() => manager.complete({ index: "1" }), "HAS_PENDING_CHILDREN");
  });

  test("can complete parent when all children complete", () => {
    manager.createRoot({
      title: "Plan",
      items: [{ title: "Parent" }],
    });

    manager.breakdown({
      items: [{ title: "Child" }],
      parent: "1",
    });

    manager.complete({ index: "1.1" });
    manager.complete({ index: "1" });
    expect(manager.isCompleted("1")).toBe(true);
  });

  test("can complete parent when children deleted", () => {
    manager.createRoot({
      title: "Plan",
      items: [{ title: "Parent" }],
    });

    manager.breakdown({
      items: [{ title: "Child" }],
      parent: "1",
    });

    manager.delete({ index: "1.1" });
    manager.complete({ index: "1" });
    expect(manager.isCompleted("1")).toBe(true);
  });
});

describe("Task Delete", () => {
  let manager: ReturnType<typeof createTaskManager>;

  beforeEach(() => {
    manager = createTaskManager();
  });

  test("delete marks task and removes children", () => {
    manager.createRoot({
      title: "Plan",
      items: [{ title: "Parent" }],
    });

    manager.breakdown({
      items: [{ title: "Child 1" }, { title: "Child 2" }],
      parent: "1",
    });

    manager.delete({ index: "1" });

    const state = manager.getState();
    expect(state.indexMap.get("1")?.deleted).toBe(true);
    expect(state.indexMap.has("1.1")).toBe(false);
    expect(state.indexMap.has("1.2")).toBe(false);
  });

  test("delete already deleted rejected", () => {
    manager.createRoot({
      title: "Plan",
      items: [{ title: "Task" }],
    });

    manager.delete({ index: "1" });
    expectError(() => manager.delete({ index: "1" }), "ALREADY_DELETED");
  });

  test("delete remaining children allows parent complete", () => {
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

    // Complete one child
    manager.complete({ index: "1.1" });

    // Delete other child
    manager.delete({ index: "1.2" });

    // Now parent should be completable
    manager.complete({ index: "1" });
    expect(manager.isCompleted("1")).toBe(true);
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
      items: [{ title: "Unique" }],
    });

    const result = manager.get({ query: "Unique" });
    expect(result.task.index).toBe("1");
  });

  test("get returns children", () => {
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

    const result = manager.get({ query: "1" });
    expect(result.children.length).toBe(2);
    expect(result.children[0].title).toBe("Child 1");
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
    expect(result.children.length).toBe(2);
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

  test("activateRoot updates activeId", () => {
    const root1 = manager.createRoot({
      title: "Plan 1",
      items: [{ title: "Task 1" }],
    });
    manager.createRoot({
      title: "Plan 2",
      items: [{ title: "Task 2" }],
    });

    manager.activateRoot({ id: root1.root.id });

    const roots = manager.listRoots();
    expect(roots.activeId).toBe(root1.root.id);
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
});

describe("List Modes", () => {
  let manager: ReturnType<typeof createTaskManager>;

  beforeEach(() => {
    manager = createTaskManager();
  });

  test("focus mode shows working path", () => {
    manager.createRoot({
      title: "Plan",
      items: [{ title: "Task 1" }, { title: "Task 2" }],
    });

    manager.breakdown({
      items: [{ title: "Child 1" }, { title: "Child 2" }],
      parent: "1",
    });

    // Focus mode: first incomplete is 1, show its children
    const focus = manager.list({ mode: "focus" });
    const indices = focus.tree.map(t => t.index);
    expect(indices).toContain("1");
    expect(indices).toContain("1.1");
    // Task 2 shown but not recursed into
    expect(indices).toContain("2");
    expect(indices).not.toContain("2.1");
  });

  test("path mode shows path to target without expanding siblings", () => {
    manager.createRoot({
      title: "Plan",
      items: [{ title: "Task 1" }, { title: "Task 2" }],
    });

    manager.breakdown({
      items: [{ title: "Child 1" }, { title: "Child 2" }],
      parent: "1",
    });

    // Path to 2: show path without expanding siblings
    const path = manager.list({ mode: "path", target: "2" });
    const indices = path.tree.map(t => t.index);
    expect(indices).toContain("1");
    expect(indices).toContain("2");
    // Should NOT expand children of 1 since 2 is not under 1
    expect(indices).not.toContain("1.1");
    expect(indices).not.toContain("1.2");
  });

  test("full mode shows all tasks", () => {
    manager.createRoot({
      title: "Plan",
      items: [{ title: "Task 1" }, { title: "Task 2" }],
    });

    manager.breakdown({
      items: [{ title: "Child 1" }, { title: "Child 2" }],
      parent: "1",
    });

    const full = manager.list({ mode: "full" });
    const indices = full.tree.map(t => t.index);
    expect(indices).toContain("1");
    expect(indices).toContain("1.1");
    expect(indices).toContain("1.2");
    expect(indices).toContain("2");
  });
});
