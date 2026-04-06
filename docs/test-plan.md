# Nested Todo API Test Plan

## Part 1: Controlled Tests

### Task Creation

**Test: create root list**
- Arrange: Fresh instance
- Act: Create list with 3 items
- Assert: Response shows parent=null, task "1" is ready while the other two are pending
- Explanation: When parallel group unspecified, the task should be in its own group and block all younger groups

**Test: nested list inherits parent status (ready)**
- Arrange: Create root task "1"
- Act: Create child list under "1" with items "1.1", "1.2"
- Assert: Task "1.1" status=ready and task "1.2" status=pending
- Explanation: Task "1.1" being the first child/group of root task "1" inherits its status from parent, task "1.2" in the second group is blocked by "1.1"

**Test: nested list inherits parent status (pending)**
- Arrange: Create root task "1" (ready) and root task "2" pending
- Act: Create child list under "2" with items "2.1", "2.2"
- Assert: Both children have status=pending
- Explanation: Task "2.1" inherits parent status (pending) and task "2.2" is blocked anyways

**Test: parallel group inheritance**
- Arrange: Create root task "1"
- Act: Create children where "1.1" and "1.2" has group=A, "1.3" and "1.4" has group=B
- Assert: "1.1" and "1.2" (first group) status=ready, "1.3" and "1.4" (younger) status=pending

**Test: deep expansion**
- Arrange: Create "1", then expand to "1.1"
- Act: Create child list under "1.1" with items "1.1.1", "1.1.2", "1.1.3"
- Assert: "1.1.1" status=ready (inherited), "1.1.2" and "1.1.3" status=pending (blocked)

**Test: invalid index scope rejected**
- Arrange: Create root task "1"
- Act: Create child list with index "2" (wrong scope)
- Assert: INVALID_INDEX_SCOPE error

**Test: depth violation rejected**
- Arrange: Create root task "1"
- Act: Create child list under "1" with items "1.1", "1.1.1" (single call)
- Assert: DEPTH_VIOLATION error

**Test: gap in sequence rejected (create)**
- Arrange: Create root task "1"
- Act: Create child list under "1" with items "1.1", "1.3" (gap)
- Assert: OUT_OF_ORDER error

**Test: append with gap rejected (append)**
- Arrange: Create "1", then expand to "1.1"
- Act: Append with index "1.3" (gap)
- Assert: OUT_OF_ORDER error

**Test: expand completed task rejected**
- Arrange: Create "1", complete it
- Act: Try to create child list under "1"
- Assert: TASK_COMPLETED error

**Test: new mode when children exist rejected**
- Arrange: Create "1", expand to "1.1"
- Act: Create new child list under "1" with mode=new
- Assert: LIST_EXISTS error

**Test: append after siblings complete shows new task ready**
- Arrange: Create "1", expand to "1.1", "1.2", complete both
- Act: Append "1.3" to parent "1"
- Assert: Response shows "1.3" status=ready

**Test: append with incomplete siblings shows new task pending**
- Arrange: Create "1", expand to "1.1"
- Act: Append "1.2" to parent "1"
- Assert: Response shows "1.2" status=pending

**Test: override mode replaces existing children**
- Arrange: Create "1", expand to "1.1", "1.2"
- Act: Create child list under "1" with items "1.1", "1.2", "1.3", mode=override
- Assert: Response shows "1.1", "1.2", "1.3", old children replaced

**Test: second root creation rejected**
- Arrange: Create root list with "1"
- Act: Create another root list with "1"
- Assert: LIST_EXISTS error

**Test: duplicate indices in same call rejected**
- Arrange: Fresh instance
- Act: Create root list with items "1", "1"
- Assert: OUT_OF_ORDER error (or appropriate error)

**Test: create under non-existent parent rejected**
- Arrange: Fresh instance
- Act: Create child list under "99" (non-existent parent)
- Assert: NOT_FOUND error

---

### Task Completion

**Test: complete non-existent rejected**
- Arrange: Fresh instance
- Act: Complete task "99"
- Assert: NOT_FOUND error

**Test: complete ready task**
- Arrange: Create root task
- Act: Complete "1"
- Assert: Internal state shows "1" status=completed

**Test: pending task rejected**
- Arrange: Create parallel groups A→B, complete nothing
- Act: Try to complete B task (still pending)
- Assert: NOT_READY error

**Test: task with incomplete children rejected**
- Arrange: Create "1", expand to "1.1"
- Act: Try to complete "1" (child incomplete)
- Assert: CHILDREN_INCOMPLETE error

**Test: already completed rejected**
- Arrange: Create "1", complete it
- Act: Complete "1" again
- Assert: ALREADY_COMPLETED error

**Test: completing first group unblocks second**
- Arrange: Create root "1", expand to: "1.1" (group=A), "1.2" (group=B)
- Act: Complete "1.1"
- Assert: Internal state shows "1.2" status=ready

**Test: completing one in parallel group doesn't unblock next group**
- Arrange: Create root "1", expand to: "1.1" (A), "1.2" (A), "1.3" (B)
- Act: Complete "1.2"
- Assert: "1.1" still ready (same group), "1.3" still pending (next group blocked by incomplete A)
- Explanation: Because "1.1" and "1.2" are in the same group, "1.2" can be completed before "1.1"

**Test: completing parallel group unblocks next**
- Arrange: Same setup as above
- Act: Complete both "1.1" and "1.2"
- Assert: "1.3" becomes ready

**Test: result includes focused view**
- Arrange: Create 2 tasks, complete "1"
- Act: Complete "2"
- Assert: Response includes tree and rootProgress

**Test: complete result includes accurate rootProgress**
- Arrange: Create 2 root tasks
- Act: Complete "1"
- Assert: Response rootProgress={completed: 1, total: 2}

**Test: completing child requires parent ready**
- Arrange: Create "1", expand to "1.1" (first group inherits ready)
- Act: Complete "1.1"
- Assert: Response shows "1" still ready, "1.1" completed, "1" in tree with correct status

**Test: completing root unblocks next root**
- Arrange: Create "1", "2" (sequential)
- Act: Complete "1"
- Assert: Response shows "1" completed, "2" ready (unblocked)

**Test: completing parent marks completed**
- Arrange: Create "1", expand to "1.1", complete "1.1"
- Act: Complete "1"
- Assert: Response shows "1" completed, tree contains "1" with status=completed

**Test: complete via ambiguous title rejected**
- Arrange: Create "1", "2" both titled "Task"
- Act: Complete "Task"
- Assert: AMBIGUOUS error with match list

---

### Task Query

**Test: get by index returns detail**
- Arrange: Create list with items having descriptions
- Act: Get task by index
- Assert: Response includes full task detail with description

**Test: get by unique title returns task**
- Arrange: Create list with distinct titles
- Act: Get task by unique title
- Assert: Response includes full task detail

**Test: get returns correct group context**
- Arrange: Create items: "1" (sequential), "2"/"3" (group=A), "4" (sequential)
- Act: Get task "3"
- Assert: previousGroup=["1"], currentGroup=["2","3"], nextGroup=["4"]

**Test: ambiguous title rejected**
- Arrange: Create two tasks with same title "Task"
- Act: Get by title "Task"
- Assert: AMBIGUOUS error with match list

**Test: get non-existent rejected**
- Arrange: Empty instance
- Act: Get task "1"
- Assert: NOT_FOUND error

---

### Task Update

**Test: update non-existent task rejected**
- Arrange: Fresh instance
- Act: Update task "99"
- Assert: NOT_FOUND error

**Test: update completed task rejected**
- Arrange: Create "1", complete it
- Act: Update "1" title
- Assert: TASK_COMPLETED error

**Test: update title**
- Arrange: Create task "1" with title "Old"
- Act: Update "1" title to "New"
- Assert: Internal state and response show new title

**Test: clear description**
- Arrange: Create task with description
- Act: Update description to null
- Assert: Internal state shows description=undefined

**Test: update description with value**
- Arrange: Create "1"
- Act: Update "1" description to "New description"
- Assert: Response shows new description

**Test: update via ambiguous title rejected**
- Arrange: Create "1", "2" both titled "Task"
- Act: Update "Task" title to "New"
- Assert: AMBIGUOUS error with match list

---

### Task List

**Test: empty state returns empty tree**
- Arrange: Fresh instance
- Act: List tasks
- Assert: Tree=[], rootProgress={completed:0, total:0}

**Test: focus mode fresh start shows oldest leaf**
- Arrange: Create "1"→"1.1"→"1.1.1", "2"→"2.1"
- Act: List with mode=focus
- Assert: Tree shows path to oldest leaf: "1"→"1.1"→"1.1.1", subtree "2" collapsed ("2.1" not shown)

**Test: focus mode collapses completed branches**
- Arrange: Create "1"→"1.1"→"1.1.1", "2"→"2.1"→"2.1.1", complete "1.1.1"
- Act: List with mode=focus
- Assert: Tree shows "1"→"1.1"→"1.1.1" (completed, no children), "2" (ready, not expanded)

**Test: focus mode shows recently completed**
- Arrange: Create 3 root tasks, each expanded to X.1.1, X.1.2, X.2.1, X.2.2. Complete entire subtree "1"
- Act: Complete task "2.1.1" (now unblocked after "1" done), then list with mode=focus
- Assert: Tree shows "1" (completed, collapsed), "2" (ready, partially expanded), "3" (pending, collapsed)
- Note: Subtree "2" shows "2.1" (completed), "2.1.1" (completed), "2.1.2" (ready), "2.2" (ready, collapsed)

**Test: full mode shows entire tree**
- Arrange: Create "1"→"1.1"→"1.1.1", "2"→"2.1"
- Act: List with mode=full
- Assert: Tree: "1", "1.1", "1.1.1", "2", "2.1" in DFS order

**Test: focus mode all done shows root tasks**
- Arrange: Create "1", "2", complete both
- Act: List with mode=focus
- Assert: Tree shows both root tasks with status=completed, rootProgress completed=total

---

## Part 2: Random API Testing

### Strategy

Generate random valid API calls using seeded RNG. After each operation, verify invariants hold.

### Invariant Checkers

Run after each API call:

1. **Ready availability**: Either at least one task is ready, or all tasks are completed
2. **Child-Parent status**: Child cannot be ready/completed if parent is pending
3. **Parallel group blocking**: Next group only ready when current group fully complete
4. **No orphaned tasks**: All tasks have valid parent references or are root
5. **Root progress accuracy**: rootProgress matches actual completed/total of root tasks

### Implementation

```
After each API call:
  Run all invariant checkers
  If any check fails → test fails with details
```

### Test Scenarios

- **Random creation**: Random indices, groups, verify structure valid
- **Random completion**: Pick random ready task, verify unblocking correct
- **Mixed operations**: Interleave create/complete/list randomly
- **Deep nesting**: 5 levels deep, complete in random order
- **Parallel stress**: Many parallel groups, random completion order
- **Recovery**: Override lists, verify clean state

### Seeds

Document seeds for each scenario for reproduction.

---

## Test Configuration

### Test Instance Creation

Use factory function `createTaskManager()` that returns fresh instance.

### Backdoor Access

For asserting internal state, expose read-only accessors:
- `getState()`: Returns full internal task map
- `getTaskStatus(index)`: Returns status of specific task

### Seeding

Use `SeededRandom` class with configurable seed for deterministic random tests.
