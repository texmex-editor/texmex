import { useCallback, useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  getApiDocumentsByIdOptions,
  getApiDocumentsByIdQueryKey,
  getApiDocumentsByIdStateOptions,
  getApiDocumentsQueryKey,
  putApiDocumentsByIdMutation,
} from '@/client/@tanstack/react-query.gen'
import { getApiErrorMessage } from '@/utils/apiError'

export type DocumentRole = 'owner' | 'editor' | 'viewer'

function normalizeDocumentRole(rawRole: string | null | undefined): DocumentRole {
  if (rawRole === 'owner' || rawRole === 'editor' || rawRole === 'viewer') {
    return rawRole
  }

  return 'editor'
}

type UseEditorDocumentArgs = {
  docId: string
  hasApiDocumentId: boolean
  /** Fired after the entrypoint successfully changes — coordinator wires
   *  this to triggerCompile so the PDF reflects the new source file. */
  onEntrypointChanged?: () => void
}

export function useEditorDocument({ docId, hasApiDocumentId, onEntrypointChanged }: UseEditorDocumentArgs) {
  const queryClient = useQueryClient()
  const [documentTitleInput, setDocumentTitleInput] = useState<string>('')
  const [renameError, setRenameError] = useState<string | null>(null)

  const documentOptions = useMemo(
    () => ({
      path: { id: docId },
    }),
    [docId],
  )

  const documentQuery = useQuery({
    ...getApiDocumentsByIdOptions(documentOptions),
    enabled: hasApiDocumentId,
  })

  const initialStateOptions = useMemo(
    () =>
      getApiDocumentsByIdStateOptions({
        ...documentOptions,
        parseAs: 'arrayBuffer',
      }),
    [documentOptions],
  )

  const selectInitialYjsState = useMemo(() => {
    let lastBytes: Uint8Array | null = null

    return (data: unknown): Uint8Array | null => {
      let next: Uint8Array | null = null

      if (data instanceof ArrayBuffer) {
        next = data.byteLength > 0 ? new Uint8Array(data) : null
      } else if (data instanceof Blob) {
        // Defensive fallback if generated client parsing changes unexpectedly.
        next = null
      }

      if (!next) {
        lastBytes = null
        return null
      }

      if (lastBytes && lastBytes.byteLength === next.byteLength) {
        let equal = true
        for (let i = 0; i < next.byteLength; i += 1) {
          if (lastBytes[i] !== next[i]) {
            equal = false
            break
          }
        }

        if (equal) {
          return lastBytes
        }
      }

      lastBytes = next
      return next
    }
  }, [])

  const initialStateQuery = useQuery({
    ...initialStateOptions,
    enabled: hasApiDocumentId,
    select: selectInitialYjsState,
  })

  const renameDocumentMutation = useMutation({
    ...putApiDocumentsByIdMutation(),
    onSuccess: async updatedDocument => {
      setDocumentTitleInput((updatedDocument.title ?? '').trim())
      setRenameError(null)

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getApiDocumentsQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getApiDocumentsByIdQueryKey(documentOptions) }),
      ])
    },
  })

  // Same PUT endpoint as rename, used to switch the entrypoint filename.
  // Kept as a separate mutation so its success handler doesn't touch the
  // documentTitleInput state.
  const setEntrypointMutation = useMutation({
    ...putApiDocumentsByIdMutation(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: getApiDocumentsByIdQueryKey(documentOptions) })
    },
  })

  useEffect(() => {
    if (documentQuery.data?.title !== undefined) {
      setDocumentTitleInput((documentQuery.data.title ?? '').trim())
    }
  }, [documentQuery.data?.title, docId])

  // Accepts an explicit nextTitle so callers don't have to round-trip through
  // setDocumentTitleInput (which would race with the immediate mutation).
  // When omitted, falls back to the current input state for backwards
  // compatibility with the old inline rename input.
  const handleRenameDocument = useCallback(async (nextTitle?: string) => {
    if (!hasApiDocumentId) {
      setRenameError('This document cannot be renamed from the API.')
      return
    }

    setRenameError(null)
    const title = (nextTitle ?? documentTitleInput).trim()

    if (!title) {
      setRenameError('Document name cannot be empty.')
      return
    }

    if (title === (documentQuery.data?.title ?? '').trim()) {
      return
    }

    try {
      await renameDocumentMutation.mutateAsync({
        path: { id: docId },
        body: { title },
      })
    } catch (err) {
      // Surface the real server message via toast (the inline renameError tooltip
      // alone is too easy to miss). Title display reverts automatically because
      // DocumentTitleEditor's draft re-syncs from the unchanged `title` prop.
      const message =
        getApiErrorMessage(err) ?? 'Could not rename this document.'
      setRenameError(message)
      toast.error(message)
    }
  }, [docId, documentQuery.data?.title, documentTitleInput, hasApiDocumentId, renameDocumentMutation])

  // Switch the document's compile entrypoint to a new filename. Backend
  // validates that the filename matches an active collaborative file in this
  // doc (returns 400 otherwise — surfaced as a toast). Success silently
  // refetches the doc; the file tree updates its highlighted entrypoint.
  const handleSetEntrypoint = useCallback(async (filename: string) => {
    if (!hasApiDocumentId) return
    const target = filename.trim()
    if (!target) return
    if (target === (documentQuery.data?.entrypoint ?? '').trim()) return

    try {
      await setEntrypointMutation.mutateAsync({
        path: { id: docId },
        body: { entrypoint: target },
      })
      toast.success(`'${target}' is now the entrypoint.`)
      // The compile source changed — kick a recompile so the PDF preview
      // updates without the user having to type something to trigger it.
      onEntrypointChanged?.()
    } catch (err) {
      const message =
        getApiErrorMessage(err) ?? 'Could not change the entrypoint.'
      toast.error(message)
    }
  }, [docId, documentQuery.data?.entrypoint, hasApiDocumentId, onEntrypointChanged, setEntrypointMutation])

  const documentTitle = (documentQuery.data?.title ?? '').trim() || 'Untitled'
  const documentRole = normalizeDocumentRole(documentQuery.data?.role)
  const accessorDisplayName =
    (
      documentQuery.data as
        | { accessorDisplayName?: string | null }
        | undefined
    )?.accessorDisplayName ?? null

  return {
    documentQuery,
    initialYjsState: hasApiDocumentId ? (initialStateQuery.data ?? null) : null,
    isLoadingInitialState: hasApiDocumentId && initialStateQuery.isPending,
    documentTitle,
    documentRole,
    accessorDisplayName,
    documentTitleInput,
    setDocumentTitleInput,
    renameError,
    renameDocumentMutation,
    handleRenameDocument,
    handleSetEntrypoint,
  }
}

