# Task Management Interface Test

## Context

You are testing the task management tools (`task_*`) provided by the pi extension. These tools allow you to create hierarchical task lists, track progress, and organize complex engineering workflows.

You have access to the following tools:
- `task_create_list` — Create, extend, or override task lists
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

Plan the migration by breaking it down into phases: research, implementation, testing, and deployment.

---

### Step 2

Under the research phase, add specific tasks for evaluating the current system, reviewing OAuth2 providers, and comparing token strategies.

---

### Step 3

After evaluating the current system, you realize it shares a database with the billing service. Update that task to note this dependency.

---

### Step 4

The deployment phase needs to be split into staging and production rollout. Replace the original deployment task with these two separate tasks.

---

### Step 5

Once the OAuth2 provider evaluation is complete, mark that task as done.

---

### Step 6

Check the current status of all tasks to see what's blocking what.

---

### Step 7

Under the implementation phase, add subtasks for updating the login flow, implementing token refresh logic, and adding logout handling.

---

### Step 8

The testing phase needs to include integration tests and end-to-end tests. Add both as parallel tasks that can run together.

---

### Step 9

Realize the implementation plan was too simplistic. Replace it entirely with a more detailed breakdown.

---

### Step 10

Clear the entire plan since the migration has been cancelled.

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
   - Creating top-level tasks vs. subtasks
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
