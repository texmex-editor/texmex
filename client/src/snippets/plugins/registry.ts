import { coreSnippetPlugin } from './coreSnippetPlugin';
import { tableSnippetPlugin } from './tableSnippetPlugin';
import type {
  SnippetCustomBlockContribution,
  SnippetPlugin,
  SnippetSectionContribution,
  SnippetTabName,
} from './types';

const SNIPPET_PLUGINS: SnippetPlugin[] = [coreSnippetPlugin, tableSnippetPlugin];

export function getSnippetSections(tab: SnippetTabName): SnippetSectionContribution[] {
  return SNIPPET_PLUGINS.flatMap((plugin) =>
    (plugin.sections ?? []).filter((section) => section.tab === tab),
  );
}

export function getSnippetCustomBlocks(
  tab: SnippetTabName,
): SnippetCustomBlockContribution[] {
  return SNIPPET_PLUGINS.flatMap((plugin) =>
    (plugin.customBlocks ?? []).filter((block) => block.tab === tab),
  );
}
