'use strict'

const TASK_FOLDER_MARKER = '-tasks'

const BOARD_COLUMNS = [
    { id: 'high', title: 'Очень важно' },
    { id: 'medium', title: 'Важно' },
    { id: 'low', title: 'Нужно' }
]

const TASK_STATUSES = [
    { id: 'todo', title: 'Ожидает' },
    { id: 'in_progress', title: 'В работе' },
    { id: 'done', title: 'Выполненно' }
]

const DEFAULT_STATUS = TASK_STATUSES[0].id
const DEFAULT_PRIORITY = 'medium'
const DEFAULT_TASK_TITLE = 'Новая задача'
const KNOWN_STATUSES = new Set(TASK_STATUSES.map((status) => status.id))
const KNOWN_PRIORITIES = new Set(BOARD_COLUMNS.map((priority) => priority.id))
const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/
const SAFE_FRONTMATTER_FIELD_PATTERN = /^[A-Za-z0-9_-]+$/

function isTaskNote(file) {
    if (!file || !file.path || !String(file.name || '').toLowerCase().endsWith('.md')) {
        return false
    }

    return getFolderSegments(file.path).some((segment) =>
        segment.toLowerCase().includes(TASK_FOLDER_MARKER)
    )
}

function getFolderSegments(path) {
    const segments = String(path || '').split('/')

    return segments.slice(0, -1).filter(Boolean)
}

function normalizeTaskStatus(status) {
    return KNOWN_STATUSES.has(status) ? status : DEFAULT_STATUS
}

function normalizeTaskPriority(priority) {
    return KNOWN_PRIORITIES.has(priority) ? priority : DEFAULT_PRIORITY
}

function getTaskTitle(file) {
    const basename = file.basename || (file.name || '').replace(/\.md$/i, '')
    const title = String(basename || '')
        .replace(/[\r\n]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()

    return title || DEFAULT_TASK_TITLE
}

function createTaskFromNote(note) {
    const status = normalizeTaskStatus(note.frontmatter && note.frontmatter.dnd_status)
    const priority = normalizeTaskPriority(note.frontmatter && note.frontmatter.dnd_priority)

    return {
        id: note.path,
        path: note.path,
        title: getTaskTitle(note),
        status,
        priority
    }
}

function createBoardFromNotes(notes) {
    return {
        columns: BOARD_COLUMNS.map((column) => ({
            ...column,
            tasks: (notes || [])
                .filter(isTaskNote)
                .map(createTaskFromNote)
                .filter((task) => task.priority === column.id)
        }))
    }
}

function replaceFrontmatterFieldInContent(content, field, value) {
    if (!SAFE_FRONTMATTER_FIELD_PATTERN.test(field)) {
        throw new Error(`Некорректное поле frontmatter: ${field}`)
    }

    const match = content.match(FRONTMATTER_PATTERN)
    const nextLine = `${field}: ${value}`

    if (!match) {
        return `---\n${nextLine}\n---\n${content}`
    }

    const frontmatter = match[1]
    const fieldPattern = new RegExp(`^${field}:\\s*.*$`, 'm')
    const nextFrontmatter = fieldPattern.test(frontmatter)
        ? frontmatter.replace(fieldPattern, nextLine)
        : `${frontmatter}\n${nextLine}`

    return content.replace(FRONTMATTER_PATTERN, `---\n${nextFrontmatter}\n---\n`)
}

function replaceTaskStatusInContent(content, status) {
    return replaceFrontmatterFieldInContent(content, 'dnd_status', normalizeTaskStatus(status))
}

function replaceTaskPriorityInContent(content, priority) {
    return replaceFrontmatterFieldInContent(content, 'dnd_priority', normalizeTaskPriority(priority))
}

module.exports = {
    TASK_FOLDER_MARKER,
    BOARD_COLUMNS,
    TASK_STATUSES,
    DEFAULT_STATUS,
    DEFAULT_PRIORITY,
    DEFAULT_TASK_TITLE,
    isTaskNote,
    normalizeTaskStatus,
    normalizeTaskPriority,
    createBoardFromNotes,
    replaceFrontmatterFieldInContent,
    replaceTaskStatusInContent,
    replaceTaskPriorityInContent
}
