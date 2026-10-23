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

export interface DefinedColor {
  name: string;
  model: string;
  spec: string;
  hex: string;
}

/**
 * Parses the document for \definecolor{name}{model}{spec}
 */
export function getDefinedColors(content: string): DefinedColor[] {
  const regex = /\\definecolor\{([^}]+)\}\{([^}]+)\}\{([^}]+)\}/g;
  const colors: DefinedColor[] = [];
  let match;

  while ((match = regex.exec(content)) !== null) {
    const name = match[1];
    const model = match[2];
    const spec = match[3];
    const hex = convertToHex(model, spec);
    colors.push({ name, model, spec, hex });
  }

  return colors;
}

function convertToHex(model: string, spec: string): string {
  try {
    if (model === 'HTML') return `#${spec}`;
    if (model === 'rgb') {
      const parts = spec.split(',').map((n) => parseFloat(n.trim()));
      if (parts.length === 3) {
        const [r, g, b] = parts.map((n) => Math.round(n * 255));
        return rgbToHex(r, g, b);
      }
    }
    if (model === 'RGB') {
      const parts = spec.split(',').map((n) => parseInt(n.trim()));
      if (parts.length === 3) {
        const [r, g, b] = parts;
        return rgbToHex(r, g, b);
      }
    }
    if (model === 'gray') {
      const g = Math.round(parseFloat(spec.trim()) * 255);
      return rgbToHex(g, g, g);
    }
  } catch (e) {
    console.error('Error converting color to hex:', e);
  }
  return '#000000'; // Default
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, n));
  return (
    '#' +
    ((1 << 24) + (clamp(r) << 16) + (clamp(g) << 8) + clamp(b))
      .toString(16)
      .slice(1)
      .toUpperCase()
  );
}

/**
 * Inserts a \definecolor command into the document.
 */
export function defineNewColor(
  editor: monaco.editor.IStandaloneCodeEditor,
  name: string,
  model: string,
  spec: string,
): void {
  const modelContent = editor.getModel();
  if (!modelContent) return;

  const content = modelContent.getValue();
  const defineColorRegex = /\\definecolor\{[^}]+\}\{[^}]+\}\{[^}]+\}/g;
  let lastMatchEnd = -1;
  let match;

  while ((match = defineColorRegex.exec(content)) !== null) {
    lastMatchEnd = match.index + match[0].length;
  }

  let insertPos: monaco.IPosition;
  let textToInsert = `\\definecolor{${name}}{${model}}{${spec}}`;

  if (lastMatchEnd !== -1) {
    // Insert after the last definecolor
    insertPos = modelContent.getPositionAt(lastMatchEnd);
    textToInsert = '\n' + textToInsert;
  } else {
    // Find documentclass or xcolor usepackage
    const preambleRegex = /\\documentclass.*|\\usepackage.*\{xcolor\}.*/g;
    let lastPreambleEnd = -1;
    while ((match = preambleRegex.exec(content)) !== null) {
      lastPreambleEnd = match.index + match[0].length;
    }

    if (lastPreambleEnd !== -1) {
      insertPos = modelContent.getPositionAt(lastPreambleEnd);
      textToInsert = '\n' + textToInsert;
    } else {
      // Just at the beginning
      insertPos = { lineNumber: 1, column: 1 };
      textToInsert = textToInsert + '\n';
    }
  }

  editor.executeEdits('format.defineColor', [
    {
      range: new monaco.Range(
        insertPos.lineNumber,
        insertPos.column,
        insertPos.lineNumber,
        insertPos.column,
      ),
      text: textToInsert,
      forceMoveMarkers: true,
    },
  ]);
}
