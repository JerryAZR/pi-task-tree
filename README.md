# pi-task-tree

Nested task list with completed tracking and focus mode for pi.

> ⚠️ **Early Stage Development**: This extension is in active development. Expect bugs and breaking changes. Specifically, **data loss of created plans may occur** as the internal format evolves. Use with caution and back up important plans.

```bash
pi install npm:@jerryan/pi-task-tree
```

Or add to `~/.pi/agent/settings.json`:

```json
{
  "packages": ["npm:@jerryan/pi-task-tree"]
}
```

## ⚠️ Context Cost Warning

This extension is **relatively heavy** compared to a simple flat todo list. It exposes 7 tools with rich parameters (hierarchical indexes, insert modes, soft deletes, etc.) that exist for functional completeness but are **rarely used by agents in practice**. Most agent workflows only need a flat list of tasks, yet the full schema descriptions sit in the system prompt on every turn.

If you typically use pi for short, interactive coding sessions rather than long-running autonomous agent work, consider whether this extension is worth the context cost. You may prefer to:

- **Not install it globally** — only add it to specific projects that need complex planning
- **Use a simpler flat todo** for basic task tracking (e.g., the built-in `todo.ts` example or a lightweight alternative)

Reserve `pi-task-tree` for sessions where you expect deep hierarchical planning, subtask breakdowns, and long agent runs where the tree structure genuinely adds value.

## Features

- **Hierarchical tasks**: Break down work into parent tasks and subtasks
- **Completed tracking**: Mark tasks complete with `[✅]` display
- **Focus mode**: Shows the working path - first incomplete at each level
- **Insert mode**: Add tasks at specific positions
- **Soft delete**: Tasks can be deleted without losing context
- **Persistence**: State survives restarts

## Usage

Once installed, the following tools are available:

- `task_create_root` - Create a new task list
- `task_extend_root` - Add tasks to root level
- `task_breakdown` - Add subtasks under existing tasks
- `task_update` - Update task title/description
- `task_close` - Mark tasks complete or delete them
- `task_list` - Show tasks in focus or full mode
- `task_get` - Get details about a specific task

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Watch mode
npm run test:watch

# Build
npm run build

# Type check
npm run lint
```

## License

MIT
