import { createFormulaInsertion } from '@/snippets/formula/formulaUtils';
import type { SnippetInsertion } from '@/snippets/snippetInsertion';
import type { SnippetPlugin } from './types';

const createStaticInsertion = (text: string) => (): SnippetInsertion => ({
  text,
  requiredPackages: [],
});

export const coreSnippetPlugin: SnippetPlugin = {
  id: 'core-snippets',
  sections: [
    {
      id: 'core-basic',
      tab: 'insert',
      title: '',
      items: [
        {
          id: 'core-code-block',
          label: 'Code Block',
          icon: '</>',
          createInsertion: createStaticInsertion('\\begin{verbatim}\n\n\\end{verbatim}'),
        },
        {
          id: 'core-formula',
          label: 'Formula',
          icon: '\\sqrt{}',
          createInsertion: createFormulaInsertion,
        },
      ],
    },
    {
      id: 'core-nested-content',
      tab: 'insert',
      title: 'Nested Content',
      items: [
        {
          id: 'core-page',
          label: 'Page',
          icon: '[ ]',
          createInsertion: createStaticInsertion('\\newpage\n'),
        },
        {
          id: 'core-card',
          label: 'Card',
          icon: '[#]',
          createInsertion: createStaticInsertion('\\fbox{\\parbox{0.9\\linewidth}{\n\n}}'),
        },
      ],
    },
    {
      id: 'core-separators',
      tab: 'insert',
      title: 'Separators',
      items: [
        {
          id: 'core-separator-extralight',
          label: 'Extralight',
          icon: '---',
          createInsertion: createStaticInsertion('\\noindent\\rule{\\linewidth}{0.2pt}\n'),
        },
        {
          id: 'core-separator-light',
          label: 'Light',
          icon: '===',
          createInsertion: createStaticInsertion('\\noindent\\rule{\\linewidth}{0.4pt}\n'),
        },
        {
          id: 'core-separator-regular',
          label: 'Regular',
          icon: '___',
          createInsertion: createStaticInsertion('\\noindent\\rule{\\linewidth}{0.8pt}\n'),
        },
        {
          id: 'core-separator-strong',
          label: 'Strong',
          icon: '###',
          createInsertion: createStaticInsertion('\\noindent\\rule{\\linewidth}{1.2pt}\n'),
        },
        {
          id: 'core-page-break',
          label: 'Page Break',
          icon: '| |',
          createInsertion: createStaticInsertion('\\pagebreak\n'),
        },
      ],
    },
    {
      id: 'core-lists',
      tab: 'insert',
      title: 'Lists',
      items: [
        {
          id: 'core-list-bullets',
          label: 'Bullet List',
          icon: '- -',
          createInsertion: createStaticInsertion('\\begin{itemize}\n  \\item \n\\end{itemize}'),
        },
        {
          id: 'core-list-task',
          label: 'Task List',
          icon: '[x]',
          createInsertion: createStaticInsertion('\\begin{itemize}\n  \\item[$\\square$] \n\\end{itemize}'),
        },
        {
          id: 'core-list-toggle',
          label: 'Toggle List',
          icon: '> >',
          createInsertion: createStaticInsertion('\\begin{description}\n  \\item[] \n\\end{description}'),
        },
        {
          id: 'core-list-numbered',
          label: 'Numbered',
          icon: '1.2',
          createInsertion: createStaticInsertion('\\begin{enumerate}\n  \\item \n\\end{enumerate}'),
        },
      ],
    },
    {
      id: 'core-text-styles',
      tab: 'insert',
      title: 'Text Styles',
      items: [
        {
          id: 'core-title',
          label: 'Title',
          icon: 'H1',
          createInsertion: createStaticInsertion('\\section{}'),
        },
        {
          id: 'core-subtitle',
          label: 'Subtitle',
          icon: 'H2',
          createInsertion: createStaticInsertion('\\subsection{}'),
        },
        {
          id: 'core-heading',
          label: 'Heading',
          icon: 'H3',
          createInsertion: createStaticInsertion('\\subsubsection{}'),
        },
        {
          id: 'core-strong',
          label: 'Strong',
          icon: 'S',
          createInsertion: createStaticInsertion('\\textbf{}'),
        },
        {
          id: 'core-body',
          label: 'Body',
          icon: 'P',
          createInsertion: createStaticInsertion('\\par '),
        },
        {
          id: 'core-caption',
          label: 'Caption',
          icon: 'C',
          createInsertion: createStaticInsertion('\\caption{}'),
        },
      ],
    },
  ],
};
