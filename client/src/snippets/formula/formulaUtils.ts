import * as monaco from 'monaco-editor';
import type { SnippetInsertion } from '@/snippets/snippetInsertion';

export const FORMULA_SNIPPET = '\\[\n\n\\]';

export function createFormulaInsertion(): SnippetInsertion {
    return {
        text: FORMULA_SNIPPET,
        requiredPackages: ['amsmath'],
    };
}

export type FormulaKind = 'display' | 'inline';

export interface DetectedFormula {
    kind: FormulaKind;
    body: string;
    fullText: string;
    openDelimiter: string;
    closeDelimiter: string;
    startOffset: number;
    bodyStartOffset: number;
    bodyEndOffset: number;
    endOffset: number;
}

type FormulaMatch = {
    regex: RegExp;
    toFormula: (match: RegExpExecArray) => DetectedFormula;
};

const FORMULA_MATCHERS: FormulaMatch[] = [
    {
        regex: /\\\[([\s\S]*?)\\\]/g,
        toFormula: (match) => {
            const openDelimiter = '\\[';
            const closeDelimiter = '\\]';
            const startOffset = match.index;
            const bodyStartOffset = startOffset + openDelimiter.length;
            const body = match[1] ?? '';
            const bodyEndOffset = bodyStartOffset + body.length;

            return {
                kind: 'display',
                body,
                fullText: match[0],
                openDelimiter,
                closeDelimiter,
                startOffset,
                bodyStartOffset,
                bodyEndOffset,
                endOffset: bodyEndOffset + closeDelimiter.length,
            };
        },
    },
    {
        regex: /\\begin\{equation\*?\}([\s\S]*?)\\end\{equation\*?\}/g,
        toFormula: (match) => {
            const openDelimiter = match[0].startsWith('\\begin{equation*}')
                ? '\\begin{equation*}'
                : '\\begin{equation}';
            const closeDelimiter = match[0].includes('\\end{equation*}')
                ? '\\end{equation*}'
                : '\\end{equation}';
            const startOffset = match.index;
            const bodyStartOffset = startOffset + openDelimiter.length;
            const body = match[1] ?? '';
            const bodyEndOffset = bodyStartOffset + body.length;

            return {
                kind: 'display',
                body,
                fullText: match[0],
                openDelimiter,
                closeDelimiter,
                startOffset,
                bodyStartOffset,
                bodyEndOffset,
                endOffset: bodyEndOffset + closeDelimiter.length,
            };
        },
    },
    {
        regex: /\$\$([\s\S]*?)\$\$/g,
        toFormula: (match) => {
            const openDelimiter = '$$';
            const closeDelimiter = '$$';
            const startOffset = match.index;
            const bodyStartOffset = startOffset + openDelimiter.length;
            const body = match[1] ?? '';
            const bodyEndOffset = bodyStartOffset + body.length;

            return {
                kind: 'display',
                body,
                fullText: match[0],
                openDelimiter,
                closeDelimiter,
                startOffset,
                bodyStartOffset,
                bodyEndOffset,
                endOffset: bodyEndOffset + closeDelimiter.length,
            };
        },
    },
    {
        regex: /\\\(([\s\S]*?)\\\)/g,
        toFormula: (match) => {
            const openDelimiter = '\\(';
            const closeDelimiter = '\\)';
            const startOffset = match.index;
            const bodyStartOffset = startOffset + openDelimiter.length;
            const body = match[1] ?? '';
            const bodyEndOffset = bodyStartOffset + body.length;

            return {
                kind: 'inline',
                body,
                fullText: match[0],
                openDelimiter,
                closeDelimiter,
                startOffset,
                bodyStartOffset,
                bodyEndOffset,
                endOffset: bodyEndOffset + closeDelimiter.length,
            };
        },
    },
    {
        regex: /(^|[^\\])\$(?!\$)([\s\S]*?)(?<!\\)\$(?!\$)/g,
        toFormula: (match) => {
            const prefix = match[1] ?? '';
            const openDelimiter = '$';
            const closeDelimiter = '$';
            const startOffset = match.index + prefix.length;
            const bodyStartOffset = startOffset + openDelimiter.length;
            const body = match[2] ?? '';
            const bodyEndOffset = bodyStartOffset + body.length;

            return {
                kind: 'inline',
                body,
                fullText: match[0].slice(prefix.length),
                openDelimiter,
                closeDelimiter,
                startOffset,
                bodyStartOffset,
                bodyEndOffset,
                endOffset: bodyEndOffset + closeDelimiter.length,
            };
        },
    },
];

export function detectFormulaAtCursor(
    editor: monaco.editor.IStandaloneCodeEditor,
): DetectedFormula | null {
    const model = editor.getModel();
    const selection = editor.getSelection();
    if (!model || !selection || !selection.isEmpty()) {
        return null;
    }

    const cursorOffset = model.getOffsetAt(selection.getStartPosition());
    const text = model.getValue();

    for (const matcher of FORMULA_MATCHERS) {
        matcher.regex.lastIndex = 0;

        let match: RegExpExecArray | null = matcher.regex.exec(text);
        while (match) {
            const formula = matcher.toFormula(match);
            if (
                cursorOffset >= formula.startOffset &&
                cursorOffset <= formula.endOffset
            ) {
                return formula;
            }

            match = matcher.regex.exec(text);
        }
    }

    return null;
}

export function replaceFormulaInEditor(
    editor: monaco.editor.IStandaloneCodeEditor,
    formula: DetectedFormula,
    nextBody: string,
): void {
    const model = editor.getModel();
    if (!model) {
        return;
    }

    const nextFormulaText = `${formula.openDelimiter}${nextBody}${formula.closeDelimiter}`;
    const nextCursorOffset =
        formula.startOffset + formula.openDelimiter.length + nextBody.length;
    const startPosition = model.getPositionAt(formula.startOffset);
    const endPosition = model.getPositionAt(formula.endOffset);

    editor.executeEdits('formula.edit', [
        {
            range: new monaco.Range(
                startPosition.lineNumber,
                startPosition.column,
                endPosition.lineNumber,
                endPosition.column,
            ),
            text: nextFormulaText,
            forceMoveMarkers: true,
        },
    ]);
    editor.pushUndoStop();

    const nextCursorPosition = model.getPositionAt(nextCursorOffset);
    editor.setSelection(
        new monaco.Selection(
            nextCursorPosition.lineNumber,
            nextCursorPosition.column,
            nextCursorPosition.lineNumber,
            nextCursorPosition.column,
        ),
    );
    editor.focus();
}