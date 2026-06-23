const test = require('node:test')
const assert = require('node:assert/strict')

const {
    TASK_FOLDER_MARKER,
    BOARD_COLUMNS,
    TASK_STATUSES,
    isTaskNote,
    normalizeTaskPriority,
    normalizeTaskStatus,
    createBoardFromNotes,
    replaceFrontmatterFieldInContent
} = require('./board-core')

test('detects markdown notes inside folders that contain -tasks', () => {
    assert.equal(TASK_FOLDER_MARKER, '-tasks')
    assert.equal(isTaskNote({ path: '-tasks/Buy milk.md', name: 'Buy milk.md' }), true)
    assert.equal(isTaskNote({ path: 'Projects/project-tasks/Buy milk.md', name: 'Buy milk.md' }), true)
    assert.equal(isTaskNote({ path: 'Projects/-Tasks nested/Buy milk.md', name: 'Buy milk.md' }), true)
    assert.equal(isTaskNote({ path: 'Projects/-tasks/nested/Buy milk.md', name: 'Buy milk.md' }), true)
    assert.equal(isTaskNote({ path: '-tasks/Buy milk.canvas', name: 'Buy milk.canvas' }), false)
    assert.equal(isTaskNote({ path: 'Inbox/-tasks Buy milk.md', name: '-tasks Buy milk.md' }), false)
    assert.equal(isTaskNote({ path: 'Inbox/Buy milk.md', name: 'Buy milk.md' }), false)
})

test('groups task notes by priority and keeps completion status on cards', () => {
    const board = createBoardFromNotes([
        {
            path: 'Projects/-tasks/First.md',
            basename: 'First',
            name: 'First.md',
            frontmatter: { dnd_status: 'in_progress', dnd_priority: 'high' }
        },
        {
            path: 'Projects/-tasks/Second.md',
            basename: 'Second',
            name: 'Second.md',
            frontmatter: { dnd_status: 'unknown', dnd_priority: 'unknown' }
        },
        {
            path: 'Inbox/Regular.md',
            basename: 'Regular',
            name: 'Regular.md',
            frontmatter: { dnd_status: 'done', dnd_priority: 'low' }
        }
    ])

    assert.deepEqual(
        board.columns.map((column) => [column.id, column.title]),
        [
            ['high', 'Очень важно'],
            ['medium', 'Важно'],
            ['low', 'Нужно']
        ]
    )

    const highPriorityTasks = board.columns.find((column) => column.id === 'high').tasks
    const mediumPriorityTasks = board.columns.find((column) => column.id === 'medium').tasks

    assert.equal(highPriorityTasks.length, 1)
    assert.equal(highPriorityTasks[0].status, 'in_progress')
    assert.equal(mediumPriorityTasks.length, 1)
    assert.equal(mediumPriorityTasks[0].status, 'todo')
})

test('normalizes priority values', () => {
    assert.deepEqual(
        BOARD_COLUMNS.map((priority) => priority.id),
        ['high', 'medium', 'low']
    )
    assert.deepEqual(
        BOARD_COLUMNS.map((priority) => priority.title),
        ['Очень важно', 'Важно', 'Нужно']
    )
    assert.equal(normalizeTaskPriority('low'), 'low')
    assert.equal(normalizeTaskPriority('medium'), 'medium')
    assert.equal(normalizeTaskPriority('high'), 'high')
    assert.equal(normalizeTaskPriority('unknown'), 'medium')
    assert.equal(normalizeTaskPriority(undefined), 'medium')
})

test('normalizes completion status values', () => {
    assert.deepEqual(
        TASK_STATUSES.map((status) => [status.id, status.title]),
        [
            ['todo', 'Ожидает'],
            ['in_progress', 'В работе'],
            ['done', 'Выполненно']
        ]
    )
    assert.equal(normalizeTaskStatus('todo'), 'todo')
    assert.equal(normalizeTaskStatus('in_progress'), 'in_progress')
    assert.equal(normalizeTaskStatus('done'), 'done')
    assert.equal(normalizeTaskStatus('unknown'), 'todo')
    assert.equal(normalizeTaskStatus(undefined), 'todo')
})

test('creates frontmatter field when a note does not have frontmatter', () => {
    const updated = replaceFrontmatterFieldInContent('# Title\n\nBody', 'dnd_status', 'done')

    assert.equal(updated, '---\ndnd_status: done\n---\n# Title\n\nBody')
})

test('updates existing frontmatter field without removing other fields', () => {
    const updated = replaceFrontmatterFieldInContent(
        '---\ntags:\n  - task\ndnd_priority: low\n---\nBody',
        'dnd_priority',
        'high'
    )

    assert.equal(updated, '---\ntags:\n  - task\ndnd_priority: high\n---\nBody')
})
