'use strict'

const obsidian = require('obsidian')

const VIEW_TYPE_DND_TASKSBOARD = 'dnd-tasksboard-view'
const TASK_DRAG_MIME = 'application/vnd.obsidian-dnd-task'
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

    return getFolderSegments(file.path).some(folderContainsTaskMarker)
}

function getFolderSegments(path) {
    const segments = String(path || '').split('/')

    return segments.slice(0, -1).filter(Boolean)
}

function folderContainsTaskMarker(folderName) {
    return folderName.toLowerCase().includes(TASK_FOLDER_MARKER)
}

function normalizeTaskStatus(status) {
    return KNOWN_STATUSES.has(status) ? status : DEFAULT_STATUS
}

function normalizeTaskPriority(priority) {
    return KNOWN_PRIORITIES.has(priority) ? priority : DEFAULT_PRIORITY
}

function normalizeTaskTitle(title) {
    const cleanTitle = String(title || '')
        .replace(/\.md$/i, '')
        .replace(/[\r\n]+/g, ' ')
        .replace(/[\\/:*?"<>|]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()

    return cleanTitle || DEFAULT_TASK_TITLE
}

function getTaskTitle(file) {
    const basename = file.basename || (file.name || '').replace(/\.md$/i, '')

    return normalizeTaskTitle(basename)
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

class TaskNotesRepository {
    constructor(app) {
        this.app = app
    }

    getTaskNotes() {
        return this.app.vault
            .getMarkdownFiles()
            .filter(isTaskNote)
            .map((file) => ({
                path: file.path,
                name: file.name,
                basename: file.basename,
                frontmatter: this.getFrontmatter(file)
            }))
            .sort((left, right) => left.path.localeCompare(right.path, 'ru'))
    }

    getFrontmatter(file) {
        const cache = this.app.metadataCache.getFileCache(file)

        return cache && cache.frontmatter ? cache.frontmatter : {}
    }

    async createTask(title, status = DEFAULT_STATUS, priority = DEFAULT_PRIORITY) {
        const cleanTitle = sanitizeTaskTitle(title)
        const folderPath = await this.getDefaultTaskFolder()
        const path = await this.createUniqueTaskPath(folderPath, cleanTitle)
        const content = `---\ndnd_status: ${normalizeTaskStatus(status)}\ndnd_priority: ${normalizeTaskPriority(priority)}\n---\n`

        return this.app.vault.create(path, content)
    }

    async createUniqueTaskPath(folderPath, title) {
        const basePath = folderPath ? `${folderPath}/${title}` : title
        let candidate = `${basePath}.md`
        let index = 2

        while (this.app.vault.getAbstractFileByPath(candidate)) {
            candidate = `${basePath} ${index}.md`
            index += 1
        }

        return candidate
    }

    async getDefaultTaskFolder() {
        const activeFile = this.app.workspace.getActiveFile()
        const activeTaskFolder = activeFile ? getNearestTaskFolderPath(activeFile.path) : null

        if (activeTaskFolder) {
            return activeTaskFolder
        }

        const existingTaskFolder = this.findExistingTaskFolder()

        if (existingTaskFolder) {
            return existingTaskFolder.path
        }

        await this.ensureTaskFolder(TASK_FOLDER_MARKER)

        return TASK_FOLDER_MARKER
    }

    findExistingTaskFolder() {
        return this.app.vault
            .getAllLoadedFiles()
            .find((file) => file instanceof obsidian.TFolder && folderPathHasTaskMarker(file.path))
    }

    async ensureTaskFolder(path) {
        const folder = this.app.vault.getAbstractFileByPath(path)

        if (!folder) {
            await this.app.vault.createFolder(path)
            return
        }

        if (!(folder instanceof obsidian.TFolder)) {
            throw new Error(`Путь ${path} уже занят файлом`)
        }
    }

    async moveTask(path, priority) {
        const file = this.getTaskFile(path)
        const content = await this.app.vault.read(file)
        const updatedContent = replaceTaskPriorityInContent(content, priority)

        if (updatedContent !== content) {
            await this.app.vault.modify(file, updatedContent)
        }
    }

    async setTaskStatus(path, status) {
        const file = this.getTaskFile(path)
        const content = await this.app.vault.read(file)
        const updatedContent = replaceTaskStatusInContent(content, status)

        if (updatedContent !== content) {
            await this.app.vault.modify(file, updatedContent)
        }
    }

    async openTask(path) {
        const file = this.getTaskFile(path)
        const leaf = this.app.workspace.getLeaf(false)

        await leaf.openFile(file)
    }

    getTaskFile(path) {
        const file = this.app.vault.getAbstractFileByPath(path)

        if (!(file instanceof obsidian.TFile)) {
            throw new Error(`Заметка не найдена: ${path}`)
        }

        return file
    }
}

class TaskTitleModal extends obsidian.Modal {
    constructor(app, onSubmit) {
        super(app)
        this.onSubmit = onSubmit
        this.isSubmitting = false
    }

    onOpen() {
        const { contentEl } = this

        contentEl.addClass('dnd-task-modal')
        contentEl.createEl('h2', { text: 'Новая задача' })

        const form = contentEl.createEl('form', { cls: 'dnd-task-form' })
        const input = form.createEl('input', {
            attr: {
                type: 'text',
                placeholder: DEFAULT_TASK_TITLE,
                'aria-label': 'Название задачи'
            },
            cls: 'dnd-task-input'
        })

        const actions = form.createDiv({ cls: 'dnd-task-form-actions' })
        const cancelButton = actions.createEl('button', {
            text: 'Отмена',
            attr: { type: 'button' },
            cls: 'dnd-secondary-button'
        })
        const submitButton = actions.createEl('button', {
            text: 'Создать',
            attr: { type: 'submit' },
            cls: 'mod-cta'
        })

        cancelButton.addEventListener('click', () => this.close())
        form.addEventListener('submit', async (event) => {
            event.preventDefault()

            if (this.isSubmitting) {
                return
            }

            const title = input.value.trim()

            if (!title) {
                new obsidian.Notice('Введите название задачи')
                input.focus()
                return
            }

            this.isSubmitting = true
            submitButton.disabled = true
            submitButton.textContent = 'Создание...'

            try {
                await this.onSubmit(title)
                this.close()
            } catch (error) {
                new obsidian.Notice(getErrorMessage(error))
                submitButton.disabled = false
                submitButton.textContent = 'Создать'
                this.isSubmitting = false
            }
        })

        input.focus()
    }

    onClose() {
        this.contentEl.empty()
    }
}

class TasksBoardView extends obsidian.ItemView {
    constructor(leaf, plugin) {
        super(leaf)
        this.plugin = plugin
        this.repository = plugin.repository
        this.pendingTaskPaths = new Set()
    }

    getViewType() {
        return VIEW_TYPE_DND_TASKSBOARD
    }

    getDisplayText() {
        return 'DND Tasksboard'
    }

    getIcon() {
        return 'table'
    }

    async onOpen() {
        await this.refresh()
    }

    async refresh() {
        this.contentEl.empty()
        this.contentEl.addClass('dnd-board-view')

        try {
            const board = createBoardFromNotes(this.repository.getTaskNotes())
            this.renderBoard(board)
        } catch (error) {
            this.renderError(error)
        }
    }

    renderBoard(board) {
        const header = this.contentEl.createDiv({ cls: 'dnd-board-header' })
        const titleGroup = header.createDiv({ cls: 'dnd-board-title-group' })
        titleGroup.createEl('h2', { text: 'DND Tasksboard' })
        titleGroup.createEl('div', {
            text: `${getTasksCount(board)} задач`,
            cls: 'dnd-board-counter'
        })

        const actions = header.createDiv({ cls: 'dnd-board-actions' })
        const refreshButton = createIconButton(actions, 'refresh-cw', 'Обновить')
        const addButton = actions.createEl('button', {
            text: 'Новая задача',
            cls: 'dnd-primary-button'
        })

        refreshButton.addEventListener('click', () => this.refresh())
        addButton.addEventListener('click', () => this.openCreateTaskModal())

        const boardEl = this.contentEl.createDiv({ cls: 'dnd-board' })

        board.columns.forEach((column) => {
            this.renderColumn(boardEl, column)
        })

        if (getTasksCount(board) === 0) {
            this.renderEmptyState()
        }
    }

    renderColumn(boardEl, column) {
        const columnEl = boardEl.createEl('section', {
            cls: 'dnd-column',
            attr: {
                'data-column-id': column.id,
                'aria-label': column.title
            }
        })
        const header = columnEl.createDiv({ cls: 'dnd-column-header' })
        header.createEl('h3', { text: column.title })
        header.createEl('span', {
            text: String(column.tasks.length),
            cls: 'dnd-column-count'
        })

        const tasksEl = columnEl.createDiv({
            cls: 'dnd-tasks-container',
            attr: { 'data-priority': column.id }
        })

        this.registerDropZone(tasksEl, column.id)

        if (column.tasks.length === 0) {
            tasksEl.createDiv({
                text: 'Пусто',
                cls: 'dnd-column-empty'
            })
            return
        }

        column.tasks.forEach((task) => {
            this.renderTask(tasksEl, task)
        })
    }

    renderTask(tasksEl, task) {
        const taskEl = tasksEl.createEl('article', {
            cls: `dnd-task-item status-${task.status}`,
            attr: {
                draggable: 'true',
                'data-task-path': task.path,
                'data-task-status': task.status
            }
        })

        if (this.pendingTaskPaths.has(task.path)) {
            taskEl.addClass('is-saving')
            taskEl.setAttribute('aria-busy', 'true')
        }

        taskEl.addEventListener('dragstart', (event) => {
            if (this.pendingTaskPaths.has(task.path)) {
                event.preventDefault()
                return
            }

            const payload = JSON.stringify({
                path: task.path,
                sourcePriority: task.priority
            })

            event.dataTransfer.setData(TASK_DRAG_MIME, payload)
            event.dataTransfer.setData('text/plain', task.path)
            event.dataTransfer.effectAllowed = 'move'
            taskEl.addClass('is-dragging')
        })
        taskEl.addEventListener('dragend', () => {
            taskEl.removeClass('is-dragging')
        })

        const body = taskEl.createDiv({ cls: 'dnd-task-body' })
        body.createEl('strong', { text: task.title, cls: 'dnd-task-title' })
        body.createEl('span', { text: task.path, cls: 'dnd-task-path' })

        const footer = taskEl.createDiv({ cls: 'dnd-task-footer' })
        footer.createEl('span', { text: 'Статус', cls: 'dnd-task-status-label' })
        const statusSelect = footer.createEl('select', {
            cls: 'dnd-status-select',
            attr: {
                'aria-label': `Статус задачи ${task.title}`
            }
        })

        TASK_STATUSES.forEach((status) => {
            const option = statusSelect.createEl('option', {
                text: status.title
            })

            option.value = status.id
            option.selected = status.id === task.status
        })

        statusSelect.addEventListener('mousedown', (event) => {
            event.stopPropagation()
        })
        statusSelect.addEventListener('change', async () => {
            await this.changeTaskStatus(task.path, statusSelect.value)
        })

        const openButton = createIconButton(taskEl, 'file-text', 'Открыть заметку')
        openButton.addEventListener('click', async () => {
            try {
                await this.repository.openTask(task.path)
            } catch (error) {
                new obsidian.Notice(getErrorMessage(error))
            }
        })
    }

    registerDropZone(tasksEl, targetPriority) {
        tasksEl.addEventListener('dragover', (event) => {
            event.preventDefault()
            event.dataTransfer.dropEffect = 'move'
            tasksEl.addClass('is-drag-over')
        })

        tasksEl.addEventListener('dragleave', (event) => {
            if (!tasksEl.contains(event.relatedTarget)) {
                tasksEl.removeClass('is-drag-over')
            }
        })

        tasksEl.addEventListener('drop', async (event) => {
            event.preventDefault()
            tasksEl.removeClass('is-drag-over')

            const payload = parseDropPayload(event.dataTransfer)

            if (!payload || payload.sourcePriority === targetPriority) {
                return
            }

            await this.moveTask(payload.path, targetPriority)
        })
    }

    async moveTask(path, priority) {
        if (this.pendingTaskPaths.has(path)) {
            return
        }

        this.pendingTaskPaths.add(path)

        try {
            await this.repository.moveTask(path, priority)
            new obsidian.Notice('Приоритет задачи обновлён')
            await this.refresh()
        } catch (error) {
            new obsidian.Notice(getErrorMessage(error))
        } finally {
            this.pendingTaskPaths.delete(path)
        }
    }

    async changeTaskStatus(path, status) {
        if (this.pendingTaskPaths.has(path)) {
            return
        }

        this.pendingTaskPaths.add(path)

        try {
            await this.repository.setTaskStatus(path, status)
            new obsidian.Notice('Статус задачи обновлён')
            await this.refresh()
        } catch (error) {
            new obsidian.Notice(getErrorMessage(error))
        } finally {
            this.pendingTaskPaths.delete(path)
        }
    }

    openCreateTaskModal() {
        new TaskTitleModal(this.app, async (title) => {
            const file = await this.repository.createTask(title)
            new obsidian.Notice(`Создана заметка: ${file.name}`)
            await this.refresh()
        }).open()
    }

    renderEmptyState() {
        const empty = this.contentEl.createDiv({ cls: 'dnd-empty-state' })
        empty.createEl('h3', { text: 'Нет задач' })
        empty.createEl('p', { text: 'Создайте папку с припиской -tasks или нажмите кнопку создания.' })
    }

    renderError(error) {
        const errorEl = this.contentEl.createDiv({ cls: 'dnd-error-state' })
        errorEl.createEl('h3', { text: 'Не удалось загрузить доску' })
        errorEl.createEl('p', { text: getErrorMessage(error) })

        const retryButton = errorEl.createEl('button', {
            text: 'Повторить',
            cls: 'dnd-primary-button'
        })
        retryButton.addEventListener('click', () => this.refresh())
    }

    async onClose() {
        this.contentEl.empty()
    }
}

class DNDTasksboardPlugin extends obsidian.Plugin {
    async onload() {
        this.repository = new TaskNotesRepository(this.app)

        this.registerView(
            VIEW_TYPE_DND_TASKSBOARD,
            (leaf) => new TasksBoardView(leaf, this)
        )

        this.addCommand({
            id: 'open-dnd-tasksboard',
            name: 'Открыть DnD доску задач',
            callback: () => this.activateView()
        })

        this.addRibbonIcon('table', 'Открыть DnD доску задач', () => {
            this.activateView()
        })

        this.registerEvent(this.app.vault.on('create', () => this.refreshOpenViews()))
        this.registerEvent(this.app.vault.on('delete', () => this.refreshOpenViews()))
        this.registerEvent(this.app.vault.on('rename', () => this.refreshOpenViews()))
        this.registerEvent(this.app.metadataCache.on('changed', () => this.refreshOpenViews()))
    }

    async activateView() {
        const existingLeaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_DND_TASKSBOARD)[0]
        const leaf = existingLeaf || this.app.workspace.getRightLeaf(false) || this.app.workspace.getLeaf(true)

        if (!existingLeaf) {
            await leaf.setViewState({
                type: VIEW_TYPE_DND_TASKSBOARD,
                active: true
            })
        }

        this.app.workspace.revealLeaf(leaf)
    }

    refreshOpenViews() {
        this.app.workspace
            .getLeavesOfType(VIEW_TYPE_DND_TASKSBOARD)
            .forEach((leaf) => {
                if (leaf.view && typeof leaf.view.refresh === 'function') {
                    leaf.view.refresh()
                }
            })
    }

    onunload() {
        this.app.workspace.detachLeavesOfType(VIEW_TYPE_DND_TASKSBOARD)
    }
}

function parseDropPayload(dataTransfer) {
    try {
        const rawPayload = dataTransfer.getData(TASK_DRAG_MIME)
        return rawPayload ? JSON.parse(rawPayload) : null
    } catch (error) {
        console.error('Failed to parse task drop payload:', error)
        return null
    }
}

function createIconButton(parent, icon, label) {
    const button = parent.createEl('button', {
        attr: {
            type: 'button',
            'aria-label': label,
            title: label
        },
        cls: 'dnd-icon-button'
    })

    obsidian.setIcon(button, icon)

    return button
}

function sanitizeTaskTitle(title) {
    return normalizeTaskTitle(title)
}

function getNearestTaskFolderPath(path) {
    const segments = getFolderSegments(path)

    for (let index = segments.length - 1; index >= 0; index -= 1) {
        if (folderContainsTaskMarker(segments[index])) {
            return segments.slice(0, index + 1).join('/')
        }
    }

    return null
}

function folderPathHasTaskMarker(path) {
    return String(path || '')
        .split('/')
        .filter(Boolean)
        .some(folderContainsTaskMarker)
}

function getTasksCount(board) {
    return board.columns.reduce((count, column) => count + column.tasks.length, 0)
}

function getErrorMessage(error) {
    return error instanceof Error ? error.message : 'Неизвестная ошибка'
}

module.exports = DNDTasksboardPlugin
