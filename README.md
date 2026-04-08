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
