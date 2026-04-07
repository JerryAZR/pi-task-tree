# Task Management Interface Test

## Context

You have access to task management tools via the pi extension. Use them to plan and track a development project.

**Important:** There is no actual development involved. When asked to do work (implement, test, evaluate, etc.), simply mark the task as complete using the task tools. Your job is to use the task management tools to organize and track progress, not to actually write code.

---

## Scenario: Migrate User Authentication Service

Your team is migrating the legacy authentication service to a new OAuth2-based system.

---

### Step 1

Create a task list for this migration project. Give it a descriptive name. Plan the main phases: research, implementation, testing, and deployment.

---

### Step 2

The research phase needs specific work items: evaluating the current system, reviewing OAuth2 providers, and comparing token strategies.

---

### Step 3

During research, you discover that the current authentication system shares a database with the billing service. Document this dependency.

---

### Step 4

The original plan had a single "deployment" phase, but it should actually be split into staging rollout and production rollout.

---

### Step 5

Continue making progress until all research tasks are complete.

---

### Step 6

Review the current state of the entire migration plan.

---

### Step 7

The implementation phase needs specific tasks: updating the login flow, implementing token refresh logic, and adding logout handling.

---

### Step 8

Continue making progress until all implementation tasks are complete.

---

### Step 9

The testing phase needs both integration tests and end-to-end tests.

---

### Step 10

Continue making progress until all testing tasks are complete.

---

### Step 11

The OAuth2 provider changed their API. The implementation needs to be updated accordingly, and re-tested.

---

### Step 12

Continue making progress until implementation and testing are complete.

---

### Step 13

The deployment phase needs more detail: setting up the staging environment, configuring production servers, and planning the rollout schedule.

---

### Step 14

Review the current state and verify all prerequisites for deployment are met.

---

## Success Criteria

You should:
- Create a coherent hierarchical task structure
- Correctly organize subtasks under parent tasks
- Update task details when context changes
- Modify task lists when plans evolve
- Complete tasks in the right order
- View and report progress accurately

---

## Self-Evaluation

After completing the operations above, report your experience:

### Tool Discovery

1. How did you discover what tools were available and what they do?
2. Were the tool descriptions helpful? What was missing or confusing?
3. How did you figure out which tool to use for each step?

### Navigation

4. How did you find the task indices needed for subsequent operations?
5. Were the response formats helpful for discovering structure?

### Errors and Edge Cases

6. Document any errors you encountered. For each error:
   - What were you trying to do?
   - What went wrong?
   - Was this actually your mistake, or was the rejection reasonable?
   - Was the error message helpful in understanding what went wrong?

7. Were there any operations you couldn't figure out how to perform, even after trying different approaches?

### Suggestions

8. What would make this interface easier to use?

---

## Notes

- Do not write any code — only use the provided tools
- Be honest about confusion and failures
- Explore freely and document what you learn
