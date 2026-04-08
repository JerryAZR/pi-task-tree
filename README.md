# pi-task-tree

Nested task list with completed tracking and focus mode for pi.

## Installation

```bash
pi install npm:pi-task-tree
```

Or add to `~/.pi/agent/settings.json`:

```json
{
  "packages": ["npm:pi-task-tree"]
}
```

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
# Run tests
npm test

# Watch mode
npm run test:watch
```

## License

MIT
