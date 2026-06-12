# pi-task-tree

> **Archived** — This project is no longer maintained.
>
> Before I built this extension, I read Mario Zechner (creator of pi) write in a blog post:
>
> > *"In my experience, to-do lists generally confuse models more than they help. They add state that the model has to track and update, which introduces more opportunities for things to go wrong."*
>
> I didn't believe him, so I built it anyway — and went further, betting that a *hierarchical* task tree would give agents a structured way to decompose complex work. After real-world use, the problems were even clearer than with a flat list:
>
> 1. **Agents create flat lists disguised as trees.** Despite the hierarchical API, agents almost always produce shallow, one-level-deep task lists. The tree structure adds cognitive overhead without the benefit of actual decomposition.
> 2. **Tree reasoning is hard for agents.** Deciding where to insert a subtask, how deep to nest, or when to promote/demote a node requires planning that agents struggle with — and the results are often more confusing than a simple list would be.
> 3. **The same core problems remain.** Agents batch-create tasks then batch-complete them, reminders backfire, and the agent never queries the tree to decide what to do next. The hierarchy just makes all of this heavier.
>
> If you find this extension useful or want to explore a different approach to the problem, please **fork it freely**. I'm happy to participate in related discussions — reach out at **zerui.an@outlook.com**.

---

Nested task list with completed tracking and focus mode for pi.

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

## Agent Tools

The agent can use these tools to manage tasks:

- `task_create_root` - Create a new task list
- `task_extend_root` - Add tasks to root level
- `task_breakdown` - Add subtasks under existing tasks
- `task_update` - Update task title/description
- `task_close` - Mark tasks complete or delete them
- `task_list` - Show tasks in focus or full mode
- `task_get` - Get details about a specific task

## Human Commands

You can also manage tasks directly with slash commands:

| Command | Description |
|---------|-------------|
| `/plans` | Show current plan (focus mode) |
| `/plans list` | List all available plans |
| `/plans switch <id>` | Switch to a different plan |
| `/plans delete <id>` | Delete a plan (with confirmation) |
| `/plans help` | Show command help |

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
