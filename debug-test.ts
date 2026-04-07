import { createTaskManager } from './src/task-manager';

const m = createTaskManager();
console.log("Initial keys:", [...m.getState().indexMap.keys()]);

m.createRoot({ title: "Plan", items: [{ title: "Parent" }] });
console.log("After createRoot:", [...m.getState().indexMap.keys()]);
console.log("Task 1:", m.getState().indexMap.get("1")?.title);
console.log("Root children:", m.getState().indexMap.get("root")?.children?.tasks.map(t => t.index));

m.breakdown({ items: [{ title: "Child 1" }, { title: "Child 2" }], parent: "1" });
console.log("After breakdown:", [...m.getState().indexMap.keys()]);
console.log("Task 1:", m.getState().indexMap.get("1")?.title);
