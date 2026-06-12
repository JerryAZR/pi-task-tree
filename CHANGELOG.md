# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [0.3.0] - 2025-05-21

### Changed

- **Migrated peer dependencies** from `@mariozechner/*` to `@earendil-works/*`
  - `@mariozechner/pi-ai` → `@earendil-works/pi-ai`
  - `@mariozechner/pi-coding-agent` → `@earendil-works/pi-coding-agent`

## [0.2.0] - 2025-04-12

### Changed

- **Refined `promptGuidelines` for all tools** to focus on "when to use" rather than "how to use"
  - Guidelines are now self-contained and standalone
  - Removed vague references like "This tool" in favor of explicit tool names
  - Balanced positive (when TO use) and negative (when NOT to use) guidelines
  - Removed cross-tool references for better compatibility when tools aren't loaded

### Fixed

- **Fixed TypeScript return types** for all tool handlers to consistently include `details: {}`
- **Changed enum types** from `StringEnum` to `Type.Union`/`Type.Literal` for better schema compatibility
- **Added type annotation** in filter callback for `task_close` parent check

### Documentation

- Added prominent comment explaining how `promptGuidelines` are aggregated and displayed
- Enhanced `task_close` description to clarify `indexOrTitle` requirements

## [0.1.0] - 2025-04-11

### Added

- Initial release of pi-task-tree extension
- 7 task management tools:
  - `task_create_root` - Create new task lists
  - `task_extend_root` - Add tasks to root level
  - `task_breakdown` - Add subtasks under parent tasks
  - `task_get` - Retrieve task details
  - `task_update` - Update task title/description
  - `task_close` - Complete or delete tasks
  - `task_list` - Display tasks in focus or full mode
- Nested task tree support with parent-child relationships
- Task state tracking (pending, in_progress, completed, deleted)
- Focus mode showing working path (first incomplete at each level)
- File-based persistence for task lists
- Progress tracking and parent completion validation

### Technical

- TypeScript implementation with TypeBox parameter schemas
- Session-based state management with proper branching support
- Custom error handling with descriptive error codes
- Formatted output for task display
