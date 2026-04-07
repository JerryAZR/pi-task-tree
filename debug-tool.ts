// Test through the tool layer
import * as pi from '@mariozechner/pi-sdk';
import { TaskTreeExt } from './index';

const ext = new TaskTreeExt();

// Initialize with test data
ext['_manager'] = (ext as any).createTaskManager?.() || (ext as any).getManager?.();
const m = ext['_manager'] as any;
if (!m) {
  // Try accessing internal
  const taskMgr = (ext as any).getManager?.();
  if (!taskMgr) {
    console.log("Can't access manager directly from extension");
    process.exit(1);
  }
}

// Simulate tool call with array index
try {
  const result = ext.getToolCalls().find((t: any) => t.name === 'task_close')?.execute('123', { index: ["2", "3"], mode: "complete" }, null as any, null as any, null as any);
  console.log("Result:", result);
} catch (e: any) {
  console.log("Error caught:", e.message || e);
}
