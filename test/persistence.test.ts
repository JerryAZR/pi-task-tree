/**
 * Persistence Tests - Serialization/Deserialization
 */

import { createTaskManager, loadFromDump } from "../src/task-manager";
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
    const result = manager.listRoots();
    expect(result.roots).toEqual([]);
    expect(result.activeId).toBeNull();
  });
});

describe("Create Root", () => {
  test("create root with initial tasks", () => {
    const manager = createTaskManager();
    const result = manager.createRoot({
      title: "My Plan",
      items: [{ title: "Task 1" }],
    });

    expect(result.root.title).toBe("My Plan");
    expect(result.root.id).toBeDefined();
    expect(result.rootProgress.total).toBe(1);

    const state = manager.getState();
    expect(state.indexMap.has("root")).toBe(true);
    expect(state.indexMap.has("1")).toBe(true);
    expect(state.rootList?.tasks.length).toBe(1);
  });

  test("create root with multiple tasks", () => {
    const manager = createTaskManager();
    manager.createRoot({
      title: "Plan",
      items: [
        { title: "Task 1" },
        { title: "Task 2" },
        { title: "Task 3" },
      ],
    });

    const state = manager.getState();
    expect(state.rootList?.tasks.length).toBe(3);
  });
});

describe("Breakdown Tasks", () => {
  test("add subtasks under parent", () => {
    const manager = createTaskManager();
    manager.createRoot({
      title: "Plan",
      items: [{ title: "Parent" }],
    });

    manager.breakdown({
      items: [{ title: "Child" }],
      parent: "1",
    });

    const state = manager.getState();
    expect(state.indexMap.has("1.1")).toBe(true);
    expect(state.indexMap.get("1")?.children?.tasks.length).toBe(1);
  });

  test("breakdown requires active root", () => {
    const manager = createTaskManager();
    expect(() =>
      manager.breakdown({
        items: [{ title: "Orphan" }],
        parent: "1",
      })
    ).toThrow("No active task list");
  });
});

describe("Nested Tree Structure", () => {
  test("deep nesting roundtrip", () => {
    const manager = createTaskManager();
    manager.createRoot({
      title: "Plan",
      items: [{ title: "Level 1" }],
    });

    manager.breakdown({
      items: [{ title: "Level 2" }],
      parent: "1",
    });

    manager.breakdown({
      items: [{ title: "Level 3" }],
      parent: "1.1",
    });

    const state = manager.getState();
    expect(state.indexMap.has("1.1.1")).toBe(true);
    expect(state.indexMap.get("1.1.1")?.parentIndex).toBe("1.1");
  });

  test("multiple branches roundtrip", () => {
    const manager = createTaskManager();
    manager.createRoot({
      title: "Plan",
      items: [
        { title: "Branch 1" },
        { title: "Branch 2" },
      ],
    });

    manager.breakdown({
      items: [{ title: "Child of 1" }],
      parent: "1",
    });
    manager.breakdown({
      items: [{ title: "Child of 2" }],
      parent: "2",
    });

    const state = manager.getState();
    expect(state.indexMap.has("1.1")).toBe(true);
    expect(state.indexMap.has("2.1")).toBe(true);
  });
});

describe("Parallel Groups", () => {
  test("parallel group preserved", () => {
    const manager = createTaskManager();
    manager.createRoot({
      title: "Plan",
      items: [{ title: "Parent" }],
    });

    manager.breakdown({
      items: [
        { title: "Task A", parallelGroup: "A" },
        { title: "Task B", parallelGroup: "A" },
        { title: "Task C" },
      ],
      parent: "1",
    });

    const state = manager.getState();
    const groups = state.indexMap.get("1")?.children?.groups;
    expect(groups?.length).toBe(2);
    expect(groups?.[0].taskIndices).toEqual(["1.1", "1.2"]);
    expect(groups?.[1].taskIndices).toEqual(["1.3"]);
  });
});

describe("Task Status", () => {
  test("pending status roundtrip", () => {
    const manager = createTaskManager();
    manager.createRoot({
      title: "Plan",
      items: [{ title: "Task" }],
    });

    const state = manager.getState();
    expect(state.indexMap.get("1")?.status).toBe("ready");
  });

  test("completed status roundtrip", () => {
    const manager = createTaskManager();
    manager.createRoot({
      title: "Plan",
      items: [{ title: "Task" }],
    });

    manager.complete({ index: "1" });

    const state = manager.getState();
    expect(state.indexMap.get("1")?.status).toBe("completed");
  });

  test("completed root unblocks next", () => {
    const manager = createTaskManager();
    manager.createRoot({
      title: "Plan",
      items: [
        { title: "First" },
        { title: "Second" },
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
    manager.createRoot({
      title: "Plan",
      items: [{ title: "Task", description: "A description" }],
    });

    const state = manager.getState();
    expect(state.indexMap.get("1")?.description).toBe("A description");
  });
});

describe("lastCompletedIndex", () => {
  test("lastCompletedIndex updated on complete", () => {
    const manager = createTaskManager();
    manager.createRoot({
      title: "Plan",
      items: [{ title: "Task" }],
    });

    expect(manager.getState().lastCompletedIndex).toBeNull();

    manager.complete({ index: "1" });

    expect(manager.getState().lastCompletedIndex).toBe("1");
  });
});

describe("loadFromDump (for testing)", () => {
  test("loadFromDump returns state without root task", () => {
    const dump = `{"version":1,"lastCompletedIndex":"3"}`;

    const loaded = loadFromDump(dump);

    expect(loaded.tasks.has("root")).toBe(false);
    expect(loaded.rootList.tasks.length).toBe(0);
    expect(loaded.lastCompletedIndex).toBe("3");
  });

  test("loadFromDump with tasks", () => {
    const dump = `{"version":1,"lastCompletedIndex":null}
{"index":"1","parentIndex":"root","title":"Task 1","status":"ready","groupIndex":0}`;

    const loaded = loadFromDump(dump);
    expect(loaded.tasks.has("1")).toBe(true);
    expect(loaded.tasks.has("root")).toBe(false);
  });
});
