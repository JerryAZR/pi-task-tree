# Task Management Interface Test

## Context

You are testing the task management tools (`task_*`) provided by the pi extension. These tools allow you to create multiple named task lists (roots), break down tasks hierarchically, track progress, and organize complex engineering workflows.

You have access to the following tools:
- `task_create_root` — Create a new named task list with initial tasks
- `task_breakdown` — Add subtasks under an existing parent task
- `task_update` — Update task title or description
- `task_complete` — Mark a task as completed
- `task_list` — View tasks in focus or full mode
- `task_get` — Get details of a planned task

## Your Task

Use the provided tools to complete the following operations. You may call any tool as many times as needed. Document your experience, including any confusion or failed attempts, in the self-evaluation section below.

---

## Scenario: Migrate User Authentication Service

**Context:** The team needs to migrate the legacy authentication service to a new OAuth2-based system.

---

### Step 1

Start a new task list called "Auth Migration" by creating a root with initial phases: research, implementation, testing, and deployment.

---

### Step 2

Under the research phase (task "1"), add specific tasks for evaluating the current system, reviewing OAuth2 providers, and comparing token strategies.

---

### Step 3

After evaluating the current system (task "1.1"), you realize it shares a database with the billing service. Update that task's description to note this dependency.

---

### Step 4

The deployment phase (task "4") needs to be split into staging and production rollout. Use override mode to replace it with two separate tasks.

---

### Step 5

Once the OAuth2 provider evaluation (task "1.2") is complete, mark that task as done.

---

### Step 6

Check the current status of all tasks to see what's ready, pending, or completed.

---

### Step 7

Under the implementation phase (task "2"), add subtasks for updating the login flow, implementing token refresh logic, and adding logout handling.

---

### Step 8

The testing phase (task "3") needs to include integration tests and end-to-end tests. Add both as parallel tasks under the testing phase.

---

### Step 9

The implementation plan (task "2") was too simplistic. Replace it entirely with a more detailed breakdown.

---

### Step 10

Clear the entire plan since the migration has been cancelled. (Delete the root or clear all tasks.)

---

## Success Criteria

You should:
- Create a coherent hierarchical task structure
- Correctly nest subtasks under parents
- Handle parallel tasks appropriately
- Update task descriptions when context changes
- Replace task lists when plans change
- Complete tasks in the right order
- View and report progress accurately

---

## Self-Evaluation

After completing the operations above, report your experience:

### Tool Discovery and Understanding

1. How did you discover what parameters each tool accepts?
2. Were the parameter names intuitive or confusing? Explain.
3. Did you encounter any unexpected constraints on parameter values?

### Common Patterns

4. Describe how you figured out the correct patterns for:
   - Creating a new task list (root)
   - Adding top-level tasks vs. subtasks
   - Creating parallel tasks that can run together
   - Replacing/overwriting existing tasks
   - Clearing/deleting tasks

### Failures and Confusion

5. Document any failed tool calls, including:
   - The exact call you attempted
   - The error message received
   - What you initially assumed the error meant
   - How you figured out the correct usage

6. Were there any operations you couldn't figure out how to perform? Describe what you tried.

### Interface Improvement Suggestions

7. What would make this interface easier to use? Consider:
   - Parameter naming
   - Default behaviors
   - Error messages
   - Documentation/inline help

---

## Notes

- Do not write any code — only use the provided tools
- Be honest about confusion and failures — this helps improve the interface
- You may call tools multiple times to explore and verify behavior
- If stuck, try different approaches and document what didn't work
