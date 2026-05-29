import * as monaco from 'monaco-editor'
import { insertSnippet } from '@/utils/editor'
import {
  getActiveFormats,
  unwrapSelection,
  wrapSelection,
} from '@/utils/format'
import {
  detectFormulaAtCursor,
  replaceFormulaInEditor,
  type DetectedFormula,
} from '@/snippets/formula/formulaUtils'
import {
  detectTableAtCursor,
  insertTableRowAtOffset,
  resolveTableForRowInsertion,
  type TableCursorInfo,
} from '@/snippets/table/tableUtils'
import type { LatexPackageName } from '@/lib/latexPackages'
import {
  ensureLatexPackagesInEditor,
  hasLatexPackage as hasLatexPackageInSource,
} from '@/lib/latexPackageEditor'

export type EditorInstance = monaco.editor.IStandaloneCodeEditor

export type EditorViewportPosition = {
  top: number
  left: number
}

export type EditorService = {
  getValue: () => string
  replaceAllContent: (source: string, text: string) => boolean
  setPosition: (position: monaco.IPosition) => void
  getDropPosition: (clientX: number, clientY: number) => monaco.IPosition | undefined
  getVisiblePositionForOffset: (offset: number) => EditorViewportPosition | null
  insertSnippet: (snippet: string, position?: monaco.IPosition) => void
  wrapSelection: (before: string, after: string) => void
  unwrapSelection: (before: string, after: string) => void
  getActiveFormats: () => string[]
  detectFormulaAtCursor: () => DetectedFormula | null
  replaceFormula: (formula: DetectedFormula, nextBody: string) => void
  hasLatexPackage: (packageName: LatexPackageName) => boolean
  ensureLatexPackage: (packageName: LatexPackageName) => boolean
  ensureLatexPackages: (packageNames: LatexPackageName[]) => boolean
  detectTableAtCursor: () => TableCursorInfo | null
  resolveTableForRowInsertion: (preferredEndTabularPos?: number) => TableCursorInfo | null
  insertTableRowAtOffset: (colCount: number, insertPos: number) => number | null
}

export function createEditorService(editor: EditorInstance): EditorService {
  const hasLatexPackage = (packageName: LatexPackageName): boolean => {
    const source = editor.getModel()?.getValue() ?? ''
    return hasLatexPackageInSource(source, packageName)
  }

  const ensureLatexPackages = (packageNames: LatexPackageName[]): boolean => {
    return ensureLatexPackagesInEditor(editor, packageNames)
  }

  const ensureLatexPackage = (packageName: LatexPackageName): boolean =>
    ensureLatexPackages([packageName])

  return {
    getValue: () => editor.getValue(),
    replaceAllContent: (source, text) => {
      const model = editor.getModel()
      if (!model) {
        return false
      }
      editor.executeEdits(source, [
        {
          range: model.getFullModelRange(),
          text,
          forceMoveMarkers: true,
        },
      ])
      editor.pushUndoStop()
      editor.focus()
      return true
    },
    setPosition: (position) => editor.setPosition(position),
    getDropPosition: (clientX, clientY) => {
      const target = editor.getTargetAtClientPoint(clientX, clientY)
      if (!target) {
        return undefined
      }
      if (target.position) {
        return target.position
      }
      if (target.range) {
        return {
          lineNumber: target.range.startLineNumber,
          column: target.range.startColumn,
        }
      }
      return undefined
    },
    getVisiblePositionForOffset: (offset) => {
      const model = editor.getModel()
      if (!model) {
        return null
      }
      const position = model.getPositionAt(offset)
      const coords = editor.getScrolledVisiblePosition(position)
      if (!coords) {
        return null
      }
      return { top: coords.top, left: coords.left }
    },
    insertSnippet: (snippet, position) => insertSnippet(editor, snippet, position),
    wrapSelection: (before, after) => wrapSelection(editor, before, after),
    unwrapSelection: (before, after) => unwrapSelection(editor, before, after),
    getActiveFormats: () => getActiveFormats(editor),
    detectFormulaAtCursor: () => detectFormulaAtCursor(editor),
    replaceFormula: (formula, nextBody) => replaceFormulaInEditor(editor, formula, nextBody),
    hasLatexPackage,
    ensureLatexPackage,
    ensureLatexPackages,
    detectTableAtCursor: () => detectTableAtCursor(editor),
    resolveTableForRowInsertion: (preferredEndTabularPos) =>
      resolveTableForRowInsertion(editor, preferredEndTabularPos),
    insertTableRowAtOffset: (colCount, insertPos) =>
      insertTableRowAtOffset(editor, colCount, insertPos),
  }
}
