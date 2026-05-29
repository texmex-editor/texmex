import React from 'react';
import { DocumentVersionsPanel } from './DocumentVersionsPanel';
import { language as latexLanguage } from '../../../utils/monacoLatex';

interface InfoTabProps {
  documentText: string;
  docId: string;
  hasApiDocumentId: boolean;
  onApplyVersion?: (sourceText: string) => void;
  canRestoreVersion?: boolean;
}

const TEXT_COMMANDS = [
  'text',
  'textbf',
  'textit',
  'emph',
  'underline',
  'textrm',
  'textsf',
  'texttt',
  'section',
  'subsection',
  'subsubsection',
  'paragraph',
  'subparagraph',
  'chapter',
  'part',
  'title',
  'author',
  'caption',
];

const TEXT_COMMAND_SET = new Set(TEXT_COMMANDS);
const latexLanguageWithBuiltins = latexLanguage as unknown as { builtins?: unknown };
const TOKENIZER_BUILTINS =
  Array.isArray(latexLanguageWithBuiltins.builtins)
    ? (latexLanguageWithBuiltins.builtins as string[])
    : [];

const NON_VISIBLE_COMMANDS = TOKENIZER_BUILTINS.filter(
  (command: string) => !TEXT_COMMAND_SET.has(command) && command !== 'item' && command !== 'par',
);

const BLOCK_MATH_ENVS = [
  'equation',
  'equation\\*',
  'align',
  'align\\*',
  'gather',
  'gather\\*',
  'multline',
  'multline\\*',
  'flalign',
  'flalign\\*',
  'math',
];

function toRenderableText(source: string): string {
  let text = source.replace(/\r\n/g, '\n');

  // Remove comments while keeping escaped \% literals.
  text = text.replace(/(^|[^\\])%.*$/gm, '$1');

  // Remove common math modes and environments.
  text = text
    .replace(/\\\[[\s\S]*?\\]/g, ' ')
    .replace(/\\\([\s\S]*?\\\)/g, ' ')
    .replace(/\$\$[\s\S]*?\$\$/g, ' ')
    .replace(/(^|[^\\])\$(?:\\.|[^\n$\\])+\$/g, '$1 ');

  const blockMathEnvPattern = new RegExp(
    `\\\\begin\\{(${BLOCK_MATH_ENVS.join('|')})}[\\s\\S]*?\\\\end\\{\\1}`,
    'g',
  );
  text = text.replace(blockMathEnvPattern, ' ');

  const textCommandPattern = new RegExp(
    `\\\\(?:${TEXT_COMMANDS.join('|')})\\*?(?:\\[[^\\]]*])?\\{([^{}]*)}`,
    'g',
  );

  // Unwrap visible text commands (non-nested args).
  for (let i = 0; i < 4; i += 1) {
    const next = text.replace(textCommandPattern, ' $1 ');
    if (next === text) break;
    text = next;
  }

  const nonVisiblePattern = new RegExp(
    `\\\\(?:${NON_VISIBLE_COMMANDS.join('|')})\\*?(?:\\[[^\\]]*])?(?:\\{[^{}]*})*`,
    'g',
  );
  text = text.replace(nonVisiblePattern, ' ');

  // Keep some list/paragraph separators as line breaks.
  text = text
    .replace(/\\(?:item|par)\b/g, '\n')
    .replace(/\\\\/g, '\n')
    .replace(/\\(?:begin|end)\{[^{}]+}/g, ' ');

  // Decode common escaped visible characters.
  text = text
    .replace(/\\%/g, '%')
    .replace(/\\&/g, '&')
    .replace(/\\_/g, '_')
    .replace(/\\#/g, '#')
    .replace(/\\\$/g, '$')
    .replace(/\\\{/g, '{')
    .replace(/\\}/g, '}');

  // Drop any remaining commands and LaTeX grouping syntax.
  text = text
    .replace(/\\[a-zA-Z@]+|\\./g, ' ')
    .replace(/[{}]/g, ' ');

  // Normalize whitespace but preserve paragraph breaks.
  text = text
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return text;
}

function getDocumentStats(source: string) {
  const rendered = toRenderableText(source);
  const trimmed = rendered.trim();
  const lines = trimmed === '' ? 0 : rendered.split('\n').length;
  const words = rendered.match(/[A-Za-z0-9]+(?:['-][A-Za-z0-9]+)*/g) ?? [];
  const wordCount = words.length;
  const charCount = rendered.length;
  const charNoSpacesCount = rendered.replace(/\s/g, '').length;
  const paragraphs = rendered
    .split(/\n\s*\n/g)
    .map((part) => part.trim())
    .filter(Boolean).length;
  const readingTimeMin = Math.max(1, Math.ceil(wordCount / 200));

  return {
    wordCount,
    charCount,
    charNoSpacesCount,
    lines,
    paragraphs,
    readingTimeMin,
  };
}

export const InfoTab: React.FC<InfoTabProps> = ({
  documentText,
  docId,
  hasApiDocumentId,
  onApplyVersion,
  canRestoreVersion,
}) => {
  const stats = React.useMemo(
    () => getDocumentStats(documentText),
    [documentText],
  );

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-border bg-card p-4">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Document info
        </h3>
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <dt className="text-muted-foreground">Words</dt>
            <dd className="font-medium text-foreground">{stats.wordCount}</dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-muted-foreground">Characters</dt>
            <dd className="font-medium text-foreground">{stats.charCount}</dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-muted-foreground">Characters (no spaces)</dt>
            <dd className="font-medium text-foreground">
              {stats.charNoSpacesCount}
            </dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-muted-foreground">Lines</dt>
            <dd className="font-medium text-foreground">{stats.lines}</dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-muted-foreground">Paragraphs</dt>
            <dd className="font-medium text-foreground">{stats.paragraphs}</dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-muted-foreground">Reading time</dt>
            <dd className="font-medium text-foreground">
              ~{stats.readingTimeMin} min
            </dd>
          </div>
        </dl>
      </div>

      <DocumentVersionsPanel
        docId={docId}
        hasApiDocumentId={hasApiDocumentId}
        documentText={documentText}
        onApplyVersion={onApplyVersion}
        canRestoreVersion={canRestoreVersion}
      />
    </div>
  );
};
