import type { DragEvent, ReactNode } from 'react';
import type { SnippetInsertion } from '../snippetInsertion';

export type SnippetTabName = 'insert' | 'format';

export interface SnippetItemContribution {
  id: string;
  label: string;
  icon: string;
  createInsertion: () => SnippetInsertion;
}

export interface SnippetSectionContribution {
  id: string;
  tab: SnippetTabName;
  title: string;
  items: SnippetItemContribution[];
}

export interface SnippetCustomBlockContext {
  onInsertSnippet: (insertion: SnippetInsertion) => void;
  onStartSnippetDrag: (
    event: DragEvent<HTMLButtonElement>,
    insertion: SnippetInsertion,
  ) => void;
}

export interface SnippetCustomBlockContribution {
  id: string;
  tab: SnippetTabName;
  title: string;
  render: (context: SnippetCustomBlockContext) => ReactNode;
}

export interface SnippetPlugin {
  id: string;
  sections?: SnippetSectionContribution[];
  customBlocks?: SnippetCustomBlockContribution[];
}
