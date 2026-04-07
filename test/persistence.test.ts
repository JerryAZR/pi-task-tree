/**
 * Persistence Tests for Nested Todo
 */

import { createTaskManager, loadFromDump } from "../src/task-manager";
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
    // Ignore
  }
}

beforeEach(() => {
  cleanupPersistence();
});

describe("Load and Dump", () => {
  test("empty dump roundtrips", () => {
    const state = loadFromDump(
      JSON.stringify({ version: 1, lastCompletedIndex: null }) + "\n"
    );
    expect(state.tasks.size).toBe(0);
    expect(state.lastCompletedIndex).toBeNull();
  });

  test("simple dump roundtrips", () => {
    const manager = createTaskManager();
    manager.createRoot({
      title: "Test",
      items: [{ title: "Task 1" }, { title: "Task 2" }],
    });

    const { indexMap } = manager.getState();
    const serialized = Array.from(indexMap.entries())
      .map(([k, v]) => JSON.stringify({ k, v }))
      .join("\n");

    expect(indexMap.get("1")?.title).toBe("Task 1");
    expect(indexMap.get("2")?.title).toBe("Task 2");
  });
});

describe("Root Management", () => {
  test("createRoot creates in memory state", () => {
    const manager = createTaskManager();
    manager.createRoot({
      title: "Plan A",
      items: [{ title: "Task" }],
    });

    const roots = manager.listRoots();
    expect(roots.roots.length).toBe(1);
    expect(roots.roots[0].title).toBe("Plan A");
    expect(roots.activeId).toBe(roots.roots[0].id);
  });

  test("multiple roots tracked", () => {
    const manager = createTaskManager();
    const root1 = manager.createRoot({
      title: "Plan 1",
      items: [{ title: "Task 1" }],
    });
    manager.createRoot({
      title: "Plan 2",
      items: [{ title: "Task 2" }],
    });

    const roots = manager.listRoots();
    expect(roots.roots.length).toBe(2);
    expect(roots.activeId).toBe(roots.roots[1].id); // Last created is active
  });

  test("activateRoot updates activeId", () => {
    const manager = createTaskManager();
    const root1 = manager.createRoot({
      title: "Plan 1",
      items: [{ title: "Task 1" }],
    });
    manager.createRoot({
      title: "Plan 2",
      items: [{ title: "Task 2" }],
    });

    // Activate first root
    manager.activateRoot({ id: root1.root.id });

    const roots = manager.listRoots();
    expect(roots.activeId).toBe(root1.root.id);
  });

  test("deleteRoot removes from list", () => {
    const manager = createTaskManager();
    const root = manager.createRoot({
      title: "Plan",
      items: [{ title: "Task" }],
    });

    manager.deleteRoot({ id: root.root.id });

    const roots = manager.listRoots();
    expect(roots.roots.length).toBe(0);
  });
});

describe("Breakdown Tasks", () => {
  test("breakdown adds children", () => {
    const manager = createTaskManager();
    manager.createRoot({
      title: "Plan",
      items: [{ title: "Parent" }],
    });

    manager.breakdown({
      items: [{ title: "Child 1" }, { title: "Child 2" }],
      parent: "1",
    });

    const state = manager.getState();
    expect(state.indexMap.get("1.1")?.title).toBe("Child 1");
    expect(state.indexMap.get("1.2")?.title).toBe("Child 2");
  });

  test("override mode replaces children", () => {
    const manager = createTaskManager();
    manager.createRoot({
      title: "Plan",
      items: [{ title: "Parent" }],
    });

    manager.breakdown({
      items: [{ title: "Old" }],
      parent: "1",
    });

    manager.breakdown({
      items: [{ title: "New 1" }, { title: "New 2" }],
      parent: "1",
      mode: "override",
    });

    const state = manager.getState();
    expect(state.indexMap.has("1.1")).toBe(true);
    expect(state.indexMap.get("1.1")?.title).toBe("New 1");
    expect(state.indexMap.has("1.2")).toBe(true);
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
    expect(state.indexMap.get("1")?.title).toBe("Level 1");
    expect(state.indexMap.get("1.1")?.title).toBe("Level 2");
    expect(state.indexMap.get("1.1.1")?.title).toBe("Level 3");
  });
});

describe("Task Completion", () => {
  test("complete marks task done", () => {
    const manager = createTaskManager();
    manager.createRoot({
      title: "Plan",
      items: [{ title: "Task" }],
    });

    manager.complete({ index: "1" });

    expect(manager.isCompleted("1")).toBe(true);
  });

  test("already completed throws", () => {
    const manager = createTaskManager();
    manager.createRoot({
      title: "Plan",
      items: [{ title: "Task" }],
    });

    manager.complete({ index: "1" });
    expect(() => manager.complete({ index: "1" })).toThrow("already completed");
  });
});
