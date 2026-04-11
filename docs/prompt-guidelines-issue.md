# Task Tool Prompt Guidelines - Integration Issue

## Problem Summary

The `promptGuidelines` defined for task tools are not effectively guiding agent behavior due to how they're presented in the system prompt.

## Observed Issues

### 1. Agents Appending Instead of Creating
Agents call `task_extend_root` when they should call `task_create_root` for new work.

**Root Cause:** The prompt guidelines are presented as a flat, unlabeled bullet list in the system prompt. Agents cannot clearly associate guidelines with specific tools.

Example from system prompt:
```
## Guidelines:
- Use this tool to start a new planning session
- Provide a descriptive title for the plan
- Include initial tasks to break down the work
- Use this tool to add new tasks to the root level of the active plan
- Requires an active task list (created with task_create_root)
```

**Problem:** No explicit tool association. "Use this tool..." references are ambiguous.

### 2. Agents Passing Summaries Instead of Task Identifiers
Agents call `task_close` with natural language summaries ("Finished refactoring auth module") instead of actual task indices or titles.

**Root Cause:** The `promptGuidelines` for `task_close` don't clearly emphasize that `indexOrTitle` must be a registered task identifier.

## Underlying Cause

The pi harness injects `promptGuidelines` into a flat "Guidelines" section without:
1. Tool name prefixes (e.g., `[task_create_root]: ...`)
2. Grouped sections per tool
3. Clear visual separation between different tools' guidelines

## Potential Solutions

### Option A: Tool-Prefixed Guidelines
Prefix each guideline with the tool name:
```
- [task_create_root] Use this to start new planning sessions
- [task_create_root] DO NOT use if actively working on an existing plan
- [task_extend_root] ONLY use when continuing work on an existing plan
- [task_extend_root] DO NOT use for new work
```

### Option B: Grouped Sections
Group guidelines by tool:
```
## Guidelines:
### task_create_root
- Use this to start new planning sessions
- DO NOT use if actively working on an existing plan

### task_extend_root
- ONLY use when continuing work on an existing plan
- DO NOT use for new work
```

### Option C: Emphasize in Description Fields
Move critical behavioral constraints from `promptGuidelines` to the `description` field which is always visible in the tool context:

```typescript
description: "Create a new named task list. DEFAULT for new work - DO NOT use if continuing an existing plan.",
```

## Recommended Fix

Combine Option A (clearer presentation at harness level) with stronger language in the existing `promptGuidelines`:

**For `task_create_root`:**
```typescript
promptGuidelines: [
  "DEFAULT: Use this to start new planning sessions",
  "DO NOT use if actively working on an existing plan - use task_extend_root or task_breakdown instead",
  ...
]
```

**For `task_extend_root`:**
```typescript
promptGuidelines: [
  "ONLY use when actively working on an existing plan",
  "DO NOT use for new work - use task_create_root instead",
  ...
]
```

**For `task_close`:**
```typescript
promptGuidelines: [
  "Mark tasks complete as soon as you finish working on them",
  "ONLY use for tasks previously created with task_create_root/task_extend_root/task_breakdown",
  "The indexOrTitle must be the exact index or title of a registered task - NOT a summary of work completed",
  ...
]
```

## Files Affected

- `index.ts` - Contains tool registrations with `promptGuidelines`

## Related Documentation

- pi extensions.md: "Use `promptGuidelines` to add tool-specific bullets to the default system prompt Guidelines section. These bullets are included only while the tool is active."

---

**Status:** Documented, pending fix
**Priority:** Medium - affects agent behavior accuracy
