import * as monaco from 'monaco-editor';

export const FORMATTING_ACTIONS = [
  { label: 'B', title: 'Bold', before: '\\textbf{', after: '}' },
  { label: 'I', title: 'Italic', before: '\\textit{', after: '}' },
  { label: 'U', title: 'Underline', before: '\\underline{', after: '}' },
  { label: '</>', title: 'Monospace', before: '\\texttt{', after: '}' },
  { label: 'lnk', title: 'Hyperlink', before: '\\href{}{', after: '}' },
  { label: 'sqrt', title: 'Square Root', before: '\\sqrt{', after: '}' },
  { label: 'Section', before: '\\section{', after: '}' },
  { label: 'Subsection', before: '\\subsection{', after: '}' },
  { label: 'Math Inline', before: '$', after: '$' },
  { label: 'Emphasis', before: '\\emph{', after: '}' },
  { label: 'Small Caps', before: '\\textsc{', after: '}' },
];

export const FONT_SIZES = [
  { label: 'tiny', value: 'tiny' },
  { label: 'small', value: 'small' },
  { label: 'normal', value: 'normalsize' },
  { label: 'large', value: 'large' },
  { label: 'very large', value: 'Large' },
  { label: 'huge', value: 'huge' },
];

export const COLORS = [
  { label: 'Black', value: 'black' },
  { label: 'Red', value: 'red' },
  { label: 'Green', value: 'green' },
  { label: 'Blue', value: 'blue' },
  { label: 'Yellow', value: 'yellow' },
  { label: 'Orange', value: 'orange' },
  { label: 'Purple', value: 'purple' },
  { label: 'Gray', value: 'gray' },
];

/**
 * Checks which formatting actions are active at the current selection.
 */
export function getActiveFormats(
  editor: monaco.editor.IStandaloneCodeEditor,
): string[] {
  const model = editor.getModel();
  const selection = editor.getSelection();
  if (!model || !selection) return [];

  const from = model.getOffsetAt(selection.getStartPosition());
  const to = model.getOffsetAt(selection.getEndPosition());
  // Don't show active formats for empty selections, it's ambiguous.
  if (from === to) return [];

  const doc = model.getValue();
  const activeFormats: string[] = [];

  for (const action of FORMATTING_ACTIONS) {
    // Check if the text around the selection matches the action's delimiters
    const fromWord = doc.slice(Math.max(0, from - action.before.length), from);
    const toWord = doc.slice(to, to + action.after.length);

    if (fromWord === action.before && toWord === action.after) {
      activeFormats.push(action.title!);
    }
  }

  return activeFormats;
}

/**
 * Wraps the current selection with the given strings.
 */
export function wrapSelection(
  editor: monaco.editor.IStandaloneCodeEditor,
  before: string,
  after: string,
): void {
  const model = editor.getModel();
  const selection = editor.getSelection();
  if (!model || !selection) return;

  const from = model.getOffsetAt(selection.getStartPosition());
  const to = model.getOffsetAt(selection.getEndPosition());
  const selectedText = model.getValueInRange(selection);

  // Check if the selection is already wrapped and do nothing if so.
  const doc = model.getValue();
  const fromWord = doc.slice(Math.max(0, from - before.length), from);
  const toWord = doc.slice(to, to + after.length);
  if (fromWord === before && toWord === after) {
    return;
  }

  const startPos = selection.getStartPosition();
  const endPos = selection.getEndPosition();
  editor.executeEdits('format.wrap', [
    {
      range: new monaco.Range(
        startPos.lineNumber,
        startPos.column,
        endPos.lineNumber,
        endPos.column,
      ),
      text: `${before}${selectedText}${after}`,
      forceMoveMarkers: true,
    },
  ]);

  const nextStart = model.getPositionAt(from + before.length);
  const nextEnd = model.getPositionAt(to + before.length);
  editor.setSelection(
    new monaco.Selection(
      nextStart.lineNumber,
      nextStart.column,
      nextEnd.lineNumber,
      nextEnd.column,
    ),
  );
  editor.focus();
}

/**
 * Unwraps the current selection from the given strings.
 */
export function unwrapSelection(
  editor: monaco.editor.IStandaloneCodeEditor,
  before: string,
  after: string,
): void {
  const model = editor.getModel();
  const selection = editor.getSelection();
  if (!model || !selection) return;

  const from = model.getOffsetAt(selection.getStartPosition());
  const to = model.getOffsetAt(selection.getEndPosition());
  const doc = model.getValue();

  const fromWord = doc.slice(Math.max(0, from - before.length), from);
  const toWord = doc.slice(to, to + after.length);

  // Only unwrap if the selection is exactly wrapped by the provided strings
  if (fromWord === before && toWord === after) {
    const originalText = model.getValueInRange(selection);
    const startPos = model.getPositionAt(from - before.length);
    const endPos = model.getPositionAt(to + after.length);

    editor.executeEdits('format.unwrap', [
      {
        range: new monaco.Range(
          startPos.lineNumber,
          startPos.column,
          endPos.lineNumber,
          endPos.column,
        ),
        text: originalText,
        forceMoveMarkers: true,
      },
    ]);

    const nextStart = model.getPositionAt(from - before.length);
    const nextEnd = model.getPositionAt(to - before.length);
    editor.setSelection(
      new monaco.Selection(
        nextStart.lineNumber,
        nextStart.column,
        nextEnd.lineNumber,
        nextEnd.column,
      ),
    );
  }
  editor.focus();
}

/**
 * Applies font size to the current selection.
 * Uses {\size text} syntax which requires proper scope in LaTeX.
 */
export function applyFontSize(
  editor: monaco.editor.IStandaloneCodeEditor,
  size: string,
): void {
  const model = editor.getModel();
  const selection = editor.getSelection();
  if (!model || !selection) return;

  const selectedText = model.getValueInRange(selection);
  const startPos = selection.getStartPosition();
  const endPos = selection.getEndPosition();

  // Use the LaTeX size commands
  const formattedText = `{\\${size} ${selectedText}}`;

  editor.executeEdits('format.fontSize', [
    {
      range: new monaco.Range(
        startPos.lineNumber,
        startPos.column,
        endPos.lineNumber,
        endPos.column,
      ),
      text: formattedText,
      forceMoveMarkers: true,
    },
  ]);

  const from = model.getOffsetAt(startPos);
  const nextStart = model.getPositionAt(from + 1);
  const nextEnd = model.getPositionAt(from + 1 + formattedText.length - 1);
  editor.setSelection(
    new monaco.Selection(
      nextStart.lineNumber,
      nextStart.column,
      nextEnd.lineNumber,
      nextEnd.column,
    ),
  );
  editor.focus();
}

/**
 * Applies color to the current selection.
 * Requires the xcolor package: \usepackage{xcolor}
 */
export function applyColor(
  editor: monaco.editor.IStandaloneCodeEditor,
  color: string,
): void {
  const model = editor.getModel();
  const selection = editor.getSelection();
  if (!model || !selection) return;

  const selectedText = model.getValueInRange(selection);
  const startPos = selection.getStartPosition();
  const endPos = selection.getEndPosition();

  const formattedText = `\\textcolor{${color}}{${selectedText}}`;

  editor.executeEdits('format.color', [
    {
      range: new monaco.Range(
        startPos.lineNumber,
        startPos.column,
        endPos.lineNumber,
        endPos.column,
      ),
      text: formattedText,
      forceMoveMarkers: true,
    },
  ]);

  const from = model.getOffsetAt(startPos);
  const nextStart = model.getPositionAt(from + 11); // \textcolor{
  const nextEnd = model.getPositionAt(from + 11 + selectedText.length);
  editor.setSelection(
    new monaco.Selection(
      nextStart.lineNumber,
      nextStart.column,
      nextEnd.lineNumber,
      nextEnd.column,
    ),
  );
  editor.focus();
}
