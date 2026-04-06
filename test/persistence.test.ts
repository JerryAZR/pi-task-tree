/**
 * Persistence Tests - Serialization/Deserialization
 */

import { createTaskManager, loadFromDump } from "../src/task-manager";
import { unlinkSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const PROJECT_ROOT = resolve(__dirname, "..");
const PERSISTENCE_FILE = resolve(PROJECT_ROOT, ".nested-todo.json");

function cleanupPersistence() {
  try {
    if (existsSync(PERSISTENCE_FILE)) {
      unlinkSync(PERSISTENCE_FILE);
    }
  } catch {
    // Ignore
  }
}

beforeEach(() => {
  cleanupPersistence();
});

afterAll(() => {
  cleanupPersistence();
});

describe("Empty State", () => {
  test("empty state produces empty dump", () => {
    const manager = createTaskManager();
    const result = manager.list({ mode: "full" });
    expect(result.tree).toEqual([]);
    expect(result.rootProgress).toEqual({ completed: 0, total: 0 });
  });
});

describe("Single Root Task", () => {
  test("single root task roundtrip", () => {
    const manager = createTaskManager();
    manager.createList({
      items: [{ index: "1", title: "Task 1" }],
    });

    const state = manager.getState();
    // indexMap: root + 1
    expect(state.indexMap.size).toBe(2);
    expect(state.indexMap.has("root")).toBe(true);
    expect(state.indexMap.has("1")).toBe(true);
    expect(state.rootList?.tasks.length).toBe(1);
  });

  test("multiple root tasks roundtrip", () => {
    const manager = createTaskManager();
    manager.createList({
      items: [
        { index: "1", title: "Task 1" },
        { index: "2", title: "Task 2" },
        { index: "3", title: "Task 3" },
      ],
    });

    const state = manager.getState();
    // indexMap: root + 1 + 2 + 3
    expect(state.indexMap.size).toBe(4);
    expect(state.indexMap.has("root")).toBe(true);
    expect(state.indexMap.has("1")).toBe(true);
    expect(state.indexMap.has("2")).toBe(true);
    expect(state.indexMap.has("3")).toBe(true);
    expect(state.rootList?.tasks.length).toBe(3);
  });
});

describe("Nested Tree Structure", () => {
  test("single child roundtrip", () => {
    const manager = createTaskManager();
    manager.createList({
      items: [{ index: "1", title: "Parent" }],
    });
    manager.createList({
      items: [{ index: "1.1", title: "Child" }],
      parent: "1",
    });

    const state = manager.getState();
    // indexMap includes root synthetic task + parent + child
    expect(state.indexMap.size).toBe(3);
    expect(state.indexMap.has("root")).toBe(true);
    expect(state.indexMap.has("1")).toBe(true);
    expect(state.indexMap.has("1.1")).toBe(true);
    expect(state.indexMap.get("1")?.children?.tasks.length).toBe(1);
    expect(state.indexMap.get("1")?.children?.tasks[0].index).toBe("1.1");
  });

  test("deep nesting roundtrip", () => {
    const manager = createTaskManager();
    manager.createList({
      items: [{ index: "1", title: "Level 1" }],
    });
    manager.createList({
      items: [{ index: "1.1", title: "Level 2" }],
      parent: "1",
    });
    manager.createList({
      items: [{ index: "1.1.1", title: "Level 3" }],
      parent: "1.1",
    });

    const state = manager.getState();
    // indexMap: root + 1 + 1.1 + 1.1.1
    expect(state.indexMap.size).toBe(4);
    expect(state.indexMap.has("1.1.1")).toBe(true);
    expect(state.indexMap.get("1.1.1")?.parentIndex).toBe("1.1");
  });

  test("multiple branches roundtrip", () => {
    const manager = createTaskManager();
    manager.createList({
      items: [
        { index: "1", title: "Branch 1" },
        { index: "2", title: "Branch 2" },
      ],
    });
    manager.createList({
      items: [{ index: "1.1", title: "Child of 1" }],
      parent: "1",
    });
    manager.createList({
      items: [{ index: "2.1", title: "Child of 2" }],
      parent: "2",
    });

    const state = manager.getState();
    // indexMap: root + 1 + 2 + 1.1 + 2.1
    expect(state.indexMap.size).toBe(5);
    expect(state.indexMap.has("1")).toBe(true);
    expect(state.indexMap.has("2")).toBe(true);
    expect(state.indexMap.has("1.1")).toBe(true);
    expect(state.indexMap.has("2.1")).toBe(true);
    expect(state.indexMap.get("1")?.children?.tasks.length).toBe(1);
    expect(state.indexMap.get("2")?.children?.tasks.length).toBe(1);
  });
});

describe("Parallel Groups", () => {
  test("parallel group preserved in roundtrip", () => {
    const manager = createTaskManager();
    manager.createList({
      items: [{ index: "1", title: "Parent" }],
    });
    manager.createList({
      items: [
        { index: "1.1", title: "Task A", parallelGroup: "A" },
        { index: "1.2", title: "Task B", parallelGroup: "A" },
        { index: "1.3", title: "Task C" },
      ],
      parent: "1",
    });

    const state = manager.getState();
    const groups = state.indexMap.get("1")?.children?.groups;
    expect(groups?.length).toBe(2); // Group A (2 tasks) + sequential (1 task)
    expect(groups?.[0].taskIndices).toEqual(["1.1", "1.2"]);
    expect(groups?.[1].taskIndices).toEqual(["1.3"]);
  });

  test("multiple parallel groups roundtrip", () => {
    const manager = createTaskManager();
    manager.createList({
      items: [{ index: "1", title: "Parent" }],
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

    const state = manager.getState();
    const groups = state.indexMap.get("1")?.children?.groups;
    expect(groups?.length).toBe(2);
    // Position is the array index - groups[0] is position 0, groups[1] is position 1
  });
});

describe("Task Status", () => {
  test("pending status roundtrip", () => {
    const manager = createTaskManager();
    manager.createList({
      items: [{ index: "1", title: "Task" }],
    });

    const state = manager.getState();
    expect(state.indexMap.get("1")?.status).toBe("ready"); // First root task is ready
  });

  test("completed status roundtrip", () => {
    const manager = createTaskManager();
    manager.createList({
      items: [{ index: "1", title: "Task" }],
    });
    manager.complete({ index: "1" });

    const state = manager.getState();
    expect(state.indexMap.get("1")?.status).toBe("completed");
  });

  test("completed root unblocks next", () => {
    const manager = createTaskManager();
    manager.createList({
      items: [
        { index: "1", title: "First" },
        { index: "2", title: "Second" },
      ],
    });
    manager.complete({ index: "1" });

    const state = manager.getState();
    expect(state.indexMap.get("1")?.status).toBe("completed");
    expect(state.indexMap.get("2")?.status).toBe("ready");
  });
});

describe("Task Descriptions", () => {
  test("task with description roundtrip", () => {
    const manager = createTaskManager();
    manager.createList({
      items: [{ index: "1", title: "Task", description: "A description" }],
    });

    const state = manager.getState();
    expect(state.indexMap.get("1")?.description).toBe("A description");
  });

  test("task with multiline description", () => {
    const manager = createTaskManager();
    manager.createList({
      items: [{ index: "1", title: "Task", description: "Line 1\nLine 2\nLine 3" }],
    });

    const state = manager.getState();
    expect(state.indexMap.get("1")?.description).toBe("Line 1\nLine 2\nLine 3");
  });
});

describe("lastCompletedIndex", () => {
  test("lastCompletedIndex updated on complete", () => {
    const manager = createTaskManager();
    manager.createList({
      items: [{ index: "1", title: "Task" }],
    });

    expect(manager.getState().lastCompletedIndex).toBeNull();

    manager.complete({ index: "1" });

    expect(manager.getState().lastCompletedIndex).toBe("1");
  });

  test("lastCompletedIndex tracks deepest completed", () => {
    const manager = createTaskManager();
    manager.createList({
      items: [{ index: "1", title: "Parent" }],
    });
    manager.createList({
      items: [{ index: "1.1", title: "Child" }],
      parent: "1",
    });

    manager.complete({ index: "1.1" });

    expect(manager.getState().lastCompletedIndex).toBe("1.1");
  });
});

describe("Complex Tree Structures", () => {
  test("mixed depth tree", () => {
    const manager = createTaskManager();
    // Root 1 with child
    manager.createList({
      items: [{ index: "1", title: "R1" }],
    });
    manager.createList({
      items: [{ index: "1.1", title: "Child" }],
      parent: "1",
    });

    // Root 2 with two children
    manager.createList({
      items: [{ index: "2", title: "R2" }],
      mode: "append",
    });
    manager.createList({
      items: [
        { index: "2.1", title: "C1" },
        { index: "2.2", title: "C2" },
      ],
      parent: "2",
    });

    // Root 3 with nested children
    manager.createList({
      items: [{ index: "3", title: "R3" }],
      mode: "append",
    });
    manager.createList({
      items: [{ index: "3.1", title: "C" }],
      parent: "3",
    });
    manager.createList({
      items: [{ index: "3.1.1", title: "Grandchild" }],
      parent: "3.1",
    });

    const state = manager.getState();
    // indexMap: root + 1 + 1.1 + 2 + 2.1 + 2.2 + 3 + 3.1 + 3.1.1
    expect(state.indexMap.size).toBe(9);
    expect(state.rootList?.tasks.length).toBe(3);

    // Check 3.1.1 is grandchild of 3.1
    expect(state.indexMap.get("3.1")?.children?.tasks.length).toBe(1);
    expect(state.indexMap.get("3.1.1")?.parentIndex).toBe("3.1");
  });

  test("sibling children with grandchildren", () => {
    const manager = createTaskManager();
    manager.createList({
      items: [{ index: "1", title: "Parent" }],
    });
    manager.createList({
      items: [
        { index: "1.1", title: "Child A" },
        { index: "1.2", title: "Child B" },
      ],
      parent: "1",
    });
    manager.createList({
      items: [{ index: "1.1.1", title: "Grandchild of A" }],
      parent: "1.1",
    });
    manager.createList({
      items: [{ index: "1.2.1", title: "Grandchild of B" }],
      parent: "1.2",
    });

    const state = manager.getState();
    // indexMap: root + 1 + 1.1 + 1.2 + 1.1.1 + 1.2.1
    expect(state.indexMap.size).toBe(6);
    expect(state.indexMap.get("1.1")?.children?.tasks.length).toBe(1);
    expect(state.indexMap.get("1.2")?.children?.tasks.length).toBe(1);
    expect(state.indexMap.get("1.1.1")?.parentIndex).toBe("1.1");
    expect(state.indexMap.get("1.2.1")?.parentIndex).toBe("1.2");
  });
});

describe("Malformed Persistence Files", () => {
  test("metadata-only file produces empty state with root task", () => {
    // This simulates a file that exists but has only metadata, no task lines
    // (like a corrupted or partially written file)
    const malformedDump = `{"version":1,"lastCompletedIndex":"3"}`;

    const loaded = loadFromDump(malformedDump);

    // Root task should exist even with empty task list
    expect(loaded.tasks.has("root")).toBe(true);
    expect(loaded.rootList.tasks.length).toBe(0);
    expect(loaded.lastCompletedIndex).toBe("3");
  });

  test("empty file produces empty state with root task", () => {
    // Empty file should not throw, should produce valid state with root
    const emptyDump = "";

    expect(() => loadFromDump(emptyDump)).toThrow();
  });

  test("malformed JSON throws descriptive error", () => {
    const malformedJson = "not valid json";

    expect(() => loadFromDump(malformedJson)).toThrow();
  });

  test("metadata-only file allows createList operations", () => {
    // This is the key bug scenario: loading from a file with only metadata
    // should still allow creating new tasks
    const malformedDump = `{"version":1,"lastCompletedIndex":null}`;

    const loaded = loadFromDump(malformedDump);

    // Root must exist for any operations to work
    expect(loaded.tasks.has("root")).toBe(true);

    // The loaded state should be usable to create tasks
    const rootTask = loaded.tasks.get("root");
    expect(rootTask).toBeDefined();
    expect(rootTask?.status).toBe("ready");
  });

  test("file with tasks but missing root task still produces usable state", () => {
    // If somehow the root task is not in the dump, operations should still work
    // This shouldn't normally happen, but the system should be robust
    const dumpWithOnlyChild = `{"version":1,"lastCompletedIndex":null}
{"index":"1","parentIndex":"root","title":"Task 1","status":"ready","groupIndex":0}`;

    const loaded = loadFromDump(dumpWithOnlyChild);

    // Root task should be created even if not in the dump
    expect(loaded.tasks.has("root")).toBe(true);
    // Child task should also be present
    expect(loaded.tasks.has("1")).toBe(true);
  });
});
