import type { EditorSetup } from '@/utils/editor';
import React, { useEffect, useState } from 'react';
import {
  DocumentSettingsDialog,
  type DocumentSettings,
} from './DocumentSettingsDialog';

interface EditorDocumentSettingsProps {
  editorSetup: EditorSetup | null;
  currentSettings: DocumentSettings;
  onApply: (settings: DocumentSettings) => void;
}

export const EditorDocumentSettings: React.FC<EditorDocumentSettingsProps> = ({
  editorSetup,
  currentSettings,
  onApply,
}) => {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (!editorSetup) return;

    const { editor } = editorSetup;
    const model = editor.getModel();
    if (!model) return;

    const domNode = document.createElement('button');
    domNode.type = 'button';
    domNode.title = 'Document Settings';
    domNode.setAttribute('aria-label', 'Document Settings');
    domNode.style.width = '34px';
    domNode.style.height = '34px';
    domNode.style.display = 'inline-flex';
    domNode.style.alignItems = 'center';
    domNode.style.justifyContent = 'center';
    domNode.style.border = '1px solid #3f3f46';
    domNode.style.borderRadius = '6px';
    domNode.style.background = '#1f2937';
    domNode.style.color = '#e5e7eb';
    domNode.style.cursor = 'pointer';
    domNode.style.boxShadow = '0 1px 2px rgba(0, 0, 0, 0.35)';
    domNode.style.marginLeft = '8px';
    domNode.style.transform = 'translateY(-2px)';

    const iconHost = document.createElement('span');
    iconHost.style.display = 'inline-flex';
    iconHost.style.alignItems = 'center';
    iconHost.style.justifyContent = 'center';
    iconHost.style.fontSize = '16px';
    iconHost.style.lineHeight = '1';
    iconHost.textContent = '⚙';
    domNode.appendChild(iconHost);

    const onMouseEnter = () => {
      domNode.style.background = '#283548';
      domNode.style.borderColor = '#5a5a66';
    };
    const onMouseLeave = () => {
      domNode.style.background = '#1f2937';
      domNode.style.borderColor = '#3f3f46';
    };
    const onClick = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      setIsOpen(true);
    };

    const updateRightAlignment = () => {
      const firstLinePos = editor.getScrolledVisiblePosition({
        lineNumber: 1,
        column: 1,
      });

      if (!firstLinePos) {
        domNode.style.display = 'none';
        return;
      }

      domNode.style.display = 'inline-flex';

      const { contentWidth } = editor.getLayoutInfo();
      const horizontalPadding = 12;
      const buttonWidth = 34;
      const targetLeft = contentWidth - buttonWidth - horizontalPadding;
      const marginLeft = Math.max(0, targetLeft - firstLinePos.left);

      domNode.style.marginLeft = `${marginLeft}px`;
    };

    domNode.addEventListener('mouseenter', onMouseEnter);
    domNode.addEventListener('mouseleave', onMouseLeave);
    domNode.addEventListener('click', onClick);

    const settingsWidget = {
      getId: () => 'editor-document-settings-widget',
      getDomNode: () => domNode,
      getPosition: () => ({
        position: {
          lineNumber: 1,
          column: 1,
        },
        preference: [0],
      }),
    };

    editor.addContentWidget(settingsWidget as any);
    editor.layoutContentWidget(settingsWidget as any);
    updateRightAlignment();

    const contentChangeDisposable = model.onDidChangeContent(() => {
      editor.layoutContentWidget(settingsWidget as any);
      updateRightAlignment();
    });
    const layoutChangeDisposable = editor.onDidLayoutChange(() => {
      editor.layoutContentWidget(settingsWidget as any);
      updateRightAlignment();
    });
    const scrollChangeDisposable = editor.onDidScrollChange(() => {
      editor.layoutContentWidget(settingsWidget as any);
      updateRightAlignment();
    });

    return () => {
      contentChangeDisposable.dispose();
      layoutChangeDisposable.dispose();
      scrollChangeDisposable.dispose();
      domNode.removeEventListener('mouseenter', onMouseEnter);
      domNode.removeEventListener('mouseleave', onMouseLeave);
      domNode.removeEventListener('click', onClick);
      editor.removeContentWidget(settingsWidget as any);
    };
  }, [editorSetup]);

  return (
    <>
      <DocumentSettingsDialog
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        onApply={onApply}
        currentSettings={currentSettings}
      />
    </>
  );
};
