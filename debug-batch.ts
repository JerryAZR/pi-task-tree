import { createTaskManager } from './src/task-manager';

const m = createTaskManager();
m.createRoot({ title: "Test", items: [{ title: "Task 1" }, { title: "Task 2" }, { title: "Task 3" }] });

console.log("Initial:", m.list({ mode: "full" }).tree.map(t => `${t.index}:${t.title}`));

// Complete first - should work
console.log("\n--- Completing task 1 ---");
try {
  const r1 = m.complete({ index: "1" });
  console.log("Success:", r1.tree.map(t => `${t.index}:${t.title}`));
} catch (e: any) {
  console.log("Error:", e.message);
}

// Complete 2 and 3 together - should fail gracefully
console.log("\n--- Completing tasks 2 and 3 together (array) ---");
try {
  const r2 = m.complete({ index: ["2", "3"] as any });
  console.log("Success:", r2.tree.map(t => `${t.index}:${t.title}`));
} catch (e: any) {
  console.log("Error:", e.message);
}
