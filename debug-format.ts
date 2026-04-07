import { createTaskManager } from './src/task-manager';

const m = createTaskManager();

// Capture what createRoot returns (before calling list)
const result1 = m.createRoot({ title: "Plan", items: [{ title: "Task 1" }, { title: "Task 2" }] });
console.log("=== createRoot returns ===");
console.log("tree:", result1.tree.map(t => t.index));

m.breakdown({ items: [{ title: "1.1" }, { title: "1.2" }], parent: "1" });

const result2 = m.complete({ index: "1.1" });
console.log("\n=== complete returns ===");
console.log("tree:", result2.tree.map(t => t.index));

const result3 = m.addTask({ items: [{ title: "New task" }] });
console.log("\n=== addTask returns ===");
console.log("tree:", result3.tree.map(t => t.index));

// Also check what list returns
console.log("\n=== list focus returns ===");
console.log("tree:", m.list({ mode: "focus" }).tree.map(t => t.index));

console.log("\n=== list full returns ===");
console.log("tree:", m.list({ mode: "full" }).tree.map(t => t.index));
