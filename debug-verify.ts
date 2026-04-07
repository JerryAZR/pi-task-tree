import { createTaskManager } from './src/task-manager';

// Test that insert doesn't lose tasks
const m = createTaskManager();
m.createRoot({ title: "Test", items: [{ title: "Task 1" }, { title: "Task 2" }, { title: "Task 3" }] });

console.log("=== Insert at position 1 ===");
m.addTask({ items: [{ title: "X" }, { title: "Y" }], mode: "insert", before: "2" });
const tree = m.list({ mode: "full" }).tree;
const map = m.getState().indexMap;

console.log("Tree:", tree.map(t => `${t.index}:${t.title}`));
console.log("Map size:", map.size);
console.log("Map keys:", [...map.keys()]);
console.log("Tree size matches map:", tree.length === map.size);
