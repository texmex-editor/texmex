import { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { getApiDocumentsByIdFilesByFileId } from '@/client';
import {
  isCategoryTextEditable,
  normalizeFileCategory,
  type FileCategory,
} from '@/utils/fileCategories';
import {
  MAIN_TAB_KEY,
  createFileEditorKey,
  type OpenEditorFile,
} from './fileEditorUtils';

type OpenFileRequest = {
  fileId: string;
  filename: string;
  contentType: string | null;
  isTextEditable: boolean;
  category: FileCategory;
  isCollaborative: boolean;
};

type UseEditorFileTabsParams = {
  docId: string;
  hasApiDocumentId: boolean;
};

export function useEditorFileTabs({
  docId,
  hasApiDocumentId,
}: UseEditorFileTabsParams) {
  const [openFileTabs, setOpenFileTabs] = useState<OpenEditorFile[]>([]);
  const [activeEditorTabKey, setActiveEditorTabKey] =
    useState<string>(MAIN_TAB_KEY);
  const [isOpeningFile, setIsOpeningFile] = useState(false);

  const activeFileTab = useMemo(
    () => openFileTabs.find((tab) => tab.key === activeEditorTabKey) ?? null,
    [activeEditorTabKey, openFileTabs],
  );
  const isMainTabActive = activeEditorTabKey === MAIN_TAB_KEY;

  const fetchFileText = useCallback(
    async (fileId: string) => {
      const { data } = await getApiDocumentsByIdFilesByFileId({
        path: {
          id: docId,
          fileId,
        },
        parseAs: 'arrayBuffer',
        throwOnError: true,
      });

      const bytes =
        data instanceof ArrayBuffer
          ? new Uint8Array(data)
          : data instanceof Uint8Array
            ? data
            : null;

      return bytes ? new TextDecoder().decode(bytes) : '';
    },
    [docId],
  );

  const handleOpenFile = useCallback(
    async (file: OpenFileRequest) => {
      if (!hasApiDocumentId) {
        return;
      }

      const existing = openFileTabs.find((tab) => tab.fileId === file.fileId);
      if (existing) {
        setActiveEditorTabKey(existing.key);
        return;
      }

      setIsOpeningFile(true);
      try {
        let initialText: string | null = null;
        const category = normalizeFileCategory(file.category);

        if (category === 'static_text') {
          initialText = await fetchFileText(file.fileId);
        }

        const key = createFileEditorKey(file.fileId);
        const isTextEditable = file.isTextEditable || isCategoryTextEditable(category);
        const nextTab: OpenEditorFile = {
          key,
          fileId: file.fileId,
          filename: file.filename,
          contentType: file.contentType,
          isTextEditable,
          category,
          isCollaborative: file.isCollaborative,
          initialText,
        };

        setOpenFileTabs((previous) => [...previous, nextTab]);
        setActiveEditorTabKey(key);
      } catch {
        toast.error(`Could not open "${file.filename}".`);
      } finally {
        setIsOpeningFile(false);
      }
    },
    [fetchFileText, hasApiDocumentId, openFileTabs],
  );

  const handleCloseFileTab = useCallback(
    (tabKey: string) => {
      setOpenFileTabs((previous) => {
        const nextTabs = previous.filter((tab) => tab.key !== tabKey);
        if (activeEditorTabKey === tabKey) {
          setActiveEditorTabKey(MAIN_TAB_KEY);
        }
        return nextTabs;
      });
    },
    [activeEditorTabKey],
  );

  const closeFileTabById = useCallback(
    (fileId: string) => {
      const tab = openFileTabs.find((candidate) => candidate.fileId === fileId);
      if (tab) {
        handleCloseFileTab(tab.key);
      }
    },
    [handleCloseFileTab, openFileTabs],
  );

  const updateFileTabById = useCallback(
    (
      fileId: string,
      update: Partial<Omit<OpenEditorFile, 'key' | 'fileId'>>,
    ) => {
      setOpenFileTabs((previous) =>
        previous.map((tab) =>
          tab.fileId === fileId ? { ...tab, ...update } : tab,
        ),
      );
    },
    [],
  );

  const refreshStaticTextTab = useCallback(
    async (fileId: string) => {
      const tab = openFileTabs.find((candidate) => candidate.fileId === fileId);
      if (!tab || tab.category !== 'static_text') {
        return;
      }

      try {
        const nextText = await fetchFileText(fileId);
        updateFileTabById(fileId, { initialText: nextText });
      } catch {
        toast.error(`Could not refresh "${tab.filename}".`);
      }
    },
    [fetchFileText, openFileTabs, updateFileTabById],
  );

  const handleFileDocChange = useCallback(() => {
    return;
  }, []);

  return {
    openFileTabs,
    activeEditorTabKey,
    setActiveEditorTabKey,
    isOpeningFile,
    activeFileTab,
    isMainTabActive,
    handleFileDocChange,
    handleOpenFile,
    handleCloseFileTab,
    closeFileTabById,
    updateFileTabById,
    refreshStaticTextTab,
  };
}
