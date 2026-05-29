import React from 'react';
import { TableSizePicker } from '@/components/TableSizePicker';
import { createTableInsertion } from '@/snippets/table/tableUtils';
import type { SnippetPlugin } from './types';

export const tableSnippetPlugin: SnippetPlugin = {
  id: 'table-snippet',
  customBlocks: [
    {
      id: 'table-size-picker',
      tab: 'insert',
      title: 'Table',
      render: ({ onInsertSnippet, onStartSnippetDrag }) => (
        <TableSizePicker
          onInsert={(rows, cols) => onInsertSnippet(createTableInsertion(rows, cols))}
          onDragStart={(event, rows, cols) =>
            onStartSnippetDrag(event, createTableInsertion(rows, cols))
          }
        />
      ),
    },
  ],
};
