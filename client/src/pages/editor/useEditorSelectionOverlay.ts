import type { EditorSetup, SelectionOverlayState } from '@/utils/editor';
import type { DetectedFormula } from '@/snippets/formula/formulaUtils';
import { createEditorService } from '@/lib/editorService';
import type { MutableRefObject } from 'react';
import { useCallback, useState } from 'react';

export type FormulaOverlayState = DetectedFormula & {
  visible: boolean;
  top: number;
  left: number;
};

type UseEditorSelectionOverlayArgs = {
  editorSetupRef: MutableRefObject<EditorSetup | null>;
};

export function useEditorSelectionOverlay({
  editorSetupRef,
}: UseEditorSelectionOverlayArgs) {
  const [selectedText, setSelectedText] = useState<string>('');
  const [selectionOverlay, setSelectionOverlay] =
    useState<SelectionOverlayState>({
      text: '',
      visible: false,
      top: 0,
      left: 0,
      activeFormats: [],
    });
  const [isInTable, setIsInTable] = useState<boolean>(false);
  const [formulaOverlay, setFormulaOverlay] =
    useState<FormulaOverlayState | null>(null);
  const [lastKnownTableEndTabularPos, setLastKnownTableEndTabularPos] =
    useState<number | null>(null);

  const handleSelectionChange = useCallback(
    (selection: SelectionOverlayState) => {
      setSelectedText(selection.text);

      let nextOverlay: SelectionOverlayState = selection;
      const editorInstance = editorSetupRef.current?.editor;

      if (editorInstance) {
        const editorService = createEditorService(editorInstance);
        const activeFormats = editorService.getActiveFormats();
        nextOverlay = { ...selection, activeFormats };

        const tableInfo = editorService.detectTableAtCursor();
        setIsInTable(tableInfo?.isInTable ?? false);
        if (tableInfo) {
          setLastKnownTableEndTabularPos(tableInfo.endTabularPos);
        }

        if (tableInfo?.isInTable) {
          const endCoords = editorService.getVisiblePositionForOffset(
            tableInfo.endTabularPos,
          );

          if (endCoords) {
            nextOverlay = {
              text: selection.text,
              visible: true,
              top: Math.max(8, endCoords.top - 10),
              left: Math.max(8, endCoords.left),
              activeFormats,
            };
          }
        }
      }

      setSelectionOverlay(nextOverlay);

      if (selection.text) {
        setFormulaOverlay(null);
        return;
      }

      const formula = editorInstance
        ? createEditorService(editorInstance).detectFormulaAtCursor()
        : null;
      if (!formula || !editorInstance) {
        setFormulaOverlay(null);
        return;
      }

      const endCoords = createEditorService(
        editorInstance,
      ).getVisiblePositionForOffset(formula.endOffset);
      if (!endCoords) {
        setFormulaOverlay(null);
        return;
      }

      setFormulaOverlay({
        visible: true,
        top: Math.max(8, endCoords.top - 10),
        left: Math.max(8, endCoords.left + 12),
        body: formula.body,
        fullText: formula.fullText,
        kind: formula.kind,
        openDelimiter: formula.openDelimiter,
        closeDelimiter: formula.closeDelimiter,
        startOffset: formula.startOffset,
        bodyStartOffset: formula.bodyStartOffset,
        bodyEndOffset: formula.bodyEndOffset,
        endOffset: formula.endOffset,
      });
    },
    [editorSetupRef],
  );

  const handleAddTableRow = useCallback(() => {
    const editorInstance = editorSetupRef.current?.editor;
    if (!editorInstance) return;
    const editorService = createEditorService(editorInstance);

    const currentTableInfo = editorService.resolveTableForRowInsertion(
      lastKnownTableEndTabularPos ?? undefined,
    );
    if (!currentTableInfo || currentTableInfo.colCount <= 0) {
      return;
    }

    editorService.insertTableRowAtOffset(
      currentTableInfo.colCount,
      currentTableInfo.endTabularPos,
    );
    const nextTableInfo = editorService.detectTableAtCursor();
    if (nextTableInfo) {
      setLastKnownTableEndTabularPos(nextTableInfo.endTabularPos);
      setIsInTable(true);
    }
  }, [editorSetupRef, lastKnownTableEndTabularPos]);

  return {
    selectedText,
    selectionOverlay,
    formulaOverlay,
    isInTable,
    handleSelectionChange,
    handleAddTableRow,
  };
}
