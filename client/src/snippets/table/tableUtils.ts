import * as monaco from 'monaco-editor'
import type { SnippetInsertion } from '@/snippets/snippetInsertion'

export function createTableSnippet(rows: number, cols: number): string {
    const colSpec = Array(cols).fill('c').join('|')
    const header = Array(cols)
        .fill(null)
        .map((_, i) => `Col ${i + 1}`)
        .join(' & ')
    const rowsArray = Array(rows - 1)
        .fill(null)
        .map(() =>
            Array(cols)
                .fill(null)
                .map(() => ' ')
                .join(' & '),
        )
        .join(' \\\\\n  ')

    return `\\begin{tabular}{${colSpec}}\n  ${header} \\\\\n  \\hline\n  ${rowsArray} \\\\\n\\end{tabular}`
}

export function createTableInsertion(
    rows: number,
    cols: number,
): SnippetInsertion {
    return {
        text: createTableSnippet(rows, cols),
        requiredPackages: [],
    }
}

export type TableCursorInfo = {
    start: number
    end: number
    colCount: number
    isInTable: boolean
    endTabularPos: number
}

type TableBlock = Omit<TableCursorInfo, 'isInTable'>

const TABULAR_BEGIN_TOKEN = '\\begin{tabular}{'
const TABULAR_END_TOKEN = '\\end{tabular}'

function getCursorOffset(editor: monaco.editor.IStandaloneCodeEditor): number | null {
    const model = editor.getModel()
    const selection = editor.getSelection()
    const cursorPosition = selection?.getStartPosition() ?? editor.getPosition()
    if (!model || !cursorPosition) return null
    return model.getOffsetAt(cursorPosition)
}

function countColumns(columnSpec: string): number {
    let index = 0
    let count = 0

    const parseBraceGroup = (
        source: string,
        openBraceIndex: number,
    ): { content: string; endExclusive: number } | null => {
        if (source[openBraceIndex] !== '{') return null
        let depth = 1
        let cursor = openBraceIndex + 1
        while (cursor < source.length && depth > 0) {
            const char = source[cursor]
            if (char === '{') depth += 1
            if (char === '}') depth -= 1
            cursor += 1
        }
        if (depth !== 0) return null
        return {
            content: source.slice(openBraceIndex + 1, cursor - 1),
            endExclusive: cursor,
        }
    }

    while (index < columnSpec.length) {
        const char = columnSpec[index]

        if (/\s/.test(char) || char === '|') {
            index += 1
            continue
        }

        if (char === 'c' || char === 'l' || char === 'r' || char === 'X') {
            count += 1
            index += 1
            continue
        }

        if (char === 'p' || char === 'm' || char === 'b') {
            const group = parseBraceGroup(columnSpec, index + 1)
            if (!group) {
                index += 1
                continue
            }
            count += 1
            index = group.endExclusive
            continue
        }

        if (char === '>' || char === '<' || char === '@' || char === '!') {
            const group = parseBraceGroup(columnSpec, index + 1)
            if (!group) {
                index += 1
                continue
            }
            index = group.endExclusive
            continue
        }

        if (char === '*') {
            const repeatGroup = parseBraceGroup(columnSpec, index + 1)
            if (!repeatGroup) {
                index += 1
                continue
            }
            const formatGroup = parseBraceGroup(columnSpec, repeatGroup.endExclusive)
            if (!formatGroup) {
                index = repeatGroup.endExclusive
                continue
            }
            const multiplier = Number.parseInt(repeatGroup.content.trim(), 10)
            const nested = countColumns(formatGroup.content)
            count += (Number.isFinite(multiplier) ? multiplier : 1) * nested
            index = formatGroup.endExclusive
            continue
        }

        index += 1
    }

    return count
}

function findTabularBlocks(documentText: string): TableBlock[] {
    const blocks: TableBlock[] = []

    const parseBraceGroup = (
        source: string,
        openBraceIndex: number,
    ): { content: string; endExclusive: number } | null => {
        if (source[openBraceIndex] !== '{') return null
        let depth = 1
        let cursor = openBraceIndex + 1
        while (cursor < source.length && depth > 0) {
            const char = source[cursor]
            if (char === '{') depth += 1
            if (char === '}') depth -= 1
            cursor += 1
        }
        if (depth !== 0) return null
        return {
            content: source.slice(openBraceIndex + 1, cursor - 1),
            endExclusive: cursor,
        }
    }

    let searchIndex = 0
    while (searchIndex < documentText.length) {
        const start = documentText.indexOf(TABULAR_BEGIN_TOKEN, searchIndex)
        if (start === -1) break

        const columnSpecGroup = parseBraceGroup(
            documentText,
            start + TABULAR_BEGIN_TOKEN.length - 1,
        )
        if (!columnSpecGroup) {
            searchIndex = start + TABULAR_BEGIN_TOKEN.length
            continue
        }

        const colCount = countColumns(columnSpecGroup.content)
        const endTabularPos = documentText.indexOf(
            TABULAR_END_TOKEN,
            columnSpecGroup.endExclusive,
        )
        if (endTabularPos !== -1) {
            blocks.push({
                start,
                end: endTabularPos + TABULAR_END_TOKEN.length,
                colCount,
                endTabularPos,
            })
        }
        searchIndex = start + TABULAR_BEGIN_TOKEN.length
    }

    return blocks
}

function findTableAtOffset(documentText: string, offset: number): TableBlock | null {
    const blocks = findTabularBlocks(documentText)
    return blocks.find((block) => offset > block.start && offset < block.end) ?? null
}

/**
 * Detects if the cursor is inside a LaTeX tabular environment
 * Returns the table info or null if not in a table
 */
export function detectTableAtCursor(
    editor: monaco.editor.IStandaloneCodeEditor,
): TableCursorInfo | null {
    const model = editor.getModel()
    const from = getCursorOffset(editor)
    if (!model || from === null) return null
    const block = findTableAtOffset(model.getValue(), from)
    if (!block) return null
    return {
        ...block,
        isInTable: true,
    }
}

/**
 * Inserts a new row in a LaTeX table before \end{tabular}
 */
export function insertTableRow(
    editor: monaco.editor.IStandaloneCodeEditor,
    colCount: number,
): number | null {
    const model = editor.getModel()
    const from = getCursorOffset(editor)
    if (!model || from === null) return null
    const block = findTableAtOffset(model.getValue(), from)
    if (!block) return null
    return insertTableRowAtOffset(editor, colCount, block.endTabularPos)
}

export function insertTableRowAtOffset(
    editor: monaco.editor.IStandaloneCodeEditor,
    colCount: number,
    insertPos: number,
): number | null {
    const model = editor.getModel()
    if (!model || colCount <= 0) return null

    // Create a new row with the same number of columns
    const cells = Array(colCount).fill('  ').join(' & ')
    const newRow = `  ${cells} \\\\\n`

    const insertPosition = model.getPositionAt(insertPos)
    editor.executeEdits('table.insertRow', [{
        range: new monaco.Range(
            insertPosition.lineNumber,
            insertPosition.column,
            insertPosition.lineNumber,
            insertPosition.column,
        ),
        text: newRow,
        forceMoveMarkers: true,
    }])

    const cursorPos = model.getPositionAt(insertPos + newRow.length)
    editor.setPosition(cursorPos)
    editor.focus()
    return newRow.length
}

export function resolveTableForRowInsertion(
    editor: monaco.editor.IStandaloneCodeEditor,
    preferredEndTabularPos?: number,
): TableCursorInfo | null {
    const activeTable = detectTableAtCursor(editor)
    if (activeTable) {
        return activeTable
    }

    const model = editor.getModel()
    const cursorOffset = getCursorOffset(editor)
    if (!model) {
        return null
    }

    const blocks = findTabularBlocks(model.getValue())
    if (blocks.length === 0) {
        return null
    }

    const target = preferredEndTabularPos ?? cursorOffset
    if (target === null || target === undefined) {
        return null
    }
    const fallback = blocks.reduce((best, candidate) =>
        Math.abs(candidate.endTabularPos - target) <
        Math.abs(best.endTabularPos - target)
            ? candidate
            : best,
    )

    return {
        ...fallback,
        isInTable: true,
    }
}