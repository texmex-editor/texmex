using System.Security.Cryptography;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using TexMex.Data.Schemas;
using YDotNet.Document;
using YDotNet.Document.Options;

namespace TexMex.Data.Services;

public class DocumentService(TexMexDbContext db)
{
    // Server-side Y.Docs are constructed with garbage collection ENABLED — this is how we bound
    // state growth (the mainstream Yjs pattern). GC drops deleted-item *content* but keeps the
    // ID skeleton, so identity / state-vector lineage is preserved (peers still sync cleanly) and
    // forward-delta restore still anchors correctly. Verified empirically: a 5000-edit history
    // shrinks 5.5× under GC with byte-identical final text, and the full Layer-3 forward-delta /
    // offline-merge / cycle suite is green with GC on. (We originally defaulted to gc:false out of
    // caution for forward-delta; the research + the suite proved that wasn't necessary.) See
    // project_notes/DURABILITY.md and project_notes/YDOTNET_MULTIBRANCH_CORRUPTION.md.
    internal static Doc NewYDoc() => new(new DocOptions { SkipGarbageCollection = false });

    // Threshold above which the persisted Y.Doc state is loud enough to warrant attention.
    // Yjs is append-only — every edit adds to the operation log — so a doc with kilobytes of
    // rendered text can have megabytes of state after months of co-editing. We don't auto-act;
    // see backend_todo.md ("Auto Y.Doc compaction") for the design we'd ship when this hurts.
    private const int StateAlarmThresholdBytes = 5 * 1024 * 1024;

    public async Task<Document> CreateAsync(Guid ownerId, string? title)
    {
        // Generate IDs client-side so we can wire up FKs and seed the Y.Doc with the entrypoint
        // file_id before SaveChanges. EF's HasDefaultValueSql only fires when Id is Guid.Empty.
        var document = new Document
        {
            Id = Guid.NewGuid(),
            OwnerId = ownerId,
            Title = title?.Trim() is { Length: > 0 } t ? t : "Untitled",
            Entrypoint = "main.tex",
        };
        db.Documents.Add(document);

        // Create the entrypoint DocumentFile (collaborative by default since .tex is whitelisted).
        var entrypointFile = new DocumentFile
        {
            Id = Guid.NewGuid(),
            DocumentId = document.Id,
            Filename = document.Entrypoint,
            ContentType = "text/plain",
            Data = null,
            Size = 0,
            IsCollaborative = true,
            UploadedBy = ownerId,
        };
        db.DocumentFiles.Add(entrypointFile);

        // Seed an empty Y.Doc with one Y.Text keyed by the entrypoint's file id.
        document.YjsState = CreateInitialYjsState(new[] { (entrypointFile.Id, string.Empty) });

        await db.SaveChangesAsync();

        // Reload with Owner for the response
        await db.Entry(document).Reference(d => d.Owner).LoadAsync();

        return document;
    }

    // Creates a new document seeded from a template — initial Yjs state is built from the
    // template's content plus any collaborative template files, and binary template files are
    // copied as static DocumentFiles owned by the new user.
    public async Task<Document> CreateFromTemplateAsync(Guid ownerId, string? title, Template template)
    {
        // Generate IDs client-side so the entrypoint file_id is known when we seed the Y.Doc.
        // Carry over the source doc's original entrypoint filename — falls back to "main.tex"
        // for legacy templates created before the EntrypointFilename column was added.
        var entrypointFilename = string.IsNullOrWhiteSpace(template.EntrypointFilename)
            ? "main.tex"
            : template.EntrypointFilename;
        var document = new Document
        {
            Id = Guid.NewGuid(),
            OwnerId = ownerId,
            Title = title?.Trim() is { Length: > 0 } t ? t : "Untitled",
            Entrypoint = entrypointFilename,
        };
        db.Documents.Add(document);

        // Entrypoint file holding the template's main content. Always collaborative.
        var entrypointFile = new DocumentFile
        {
            Id = Guid.NewGuid(),
            DocumentId = document.Id,
            Filename = document.Entrypoint,
            ContentType = "text/plain",
            Data = null,
            Size = System.Text.Encoding.UTF8.GetByteCount(template.Content),
            IsCollaborative = true,
            UploadedBy = ownerId,
        };
        db.DocumentFiles.Add(entrypointFile);

        // Collect everything that needs a Y.Text in the initial Y.Doc.
        var collabSeeds = new List<(Guid fileId, string content)>
        {
            (entrypointFile.Id, template.Content)
        };

        // Classify each auxiliary template file by its extension.
        foreach (var tf in template.Files)
        {
            // Defensive: skip any template file that would collide with the entrypoint we just
            // added. The save-as-template endpoint also rejects this upstream, but a legacy
            // user-template or future system-seed mistake could still hit it. SaveChanges would
            // otherwise blow up on the partial unique index and surface as a 500.
            if (string.Equals(tf.Filename, document.Entrypoint, StringComparison.Ordinal))
                continue;

            var isCollab = FileTypePolicy.IsCollaborativeFilename(tf.Filename);
            var docFile = new DocumentFile
            {
                Id = Guid.NewGuid(),
                DocumentId = document.Id,
                Filename = tf.Filename,
                ContentType = tf.ContentType,
                Size = tf.Data.Length,
                UploadedBy = ownerId,
                IsCollaborative = isCollab,
                Data = isCollab ? null : tf.Data,
            };
            db.DocumentFiles.Add(docFile);

            if (isCollab)
            {
                var text = System.Text.Encoding.UTF8.GetString(tf.Data);
                collabSeeds.Add((docFile.Id, text));
            }
        }

        document.YjsState = CreateInitialYjsState(collabSeeds);

        await db.SaveChangesAsync();

        // Reload with Owner for the response
        await db.Entry(document).Reference(d => d.Owner).LoadAsync();

        return document;
    }

    // Includes Owner + Collaborators so endpoints can do access checks without extra queries
    public async Task<Document?> GetByIdAsync(Guid documentId)
    {
        return await db.Documents
            .Include(d => d.Owner)
            .Include(d => d.Collaborators)
            .FirstOrDefaultAsync(d => d.Id == documentId);
    }

    // Merges owned docs + docs where user is a collaborator, sorted by most recently updated
    public async Task<List<(Document Document, string Role)>> GetUserDocumentsAsync(Guid userId)
    {
        var owned = await db.Documents
            .Include(d => d.Owner)
            .Where(d => d.OwnerId == userId)
            .OrderByDescending(d => d.UpdatedAt)
            .Select(d => new { Document = d, Role = "owner" })
            .ToListAsync();

        var collaborated = await db.DocumentCollaborators
            .Include(dc => dc.Document)
                .ThenInclude(d => d.Owner)
            .Where(dc => dc.UserId == userId)
            .OrderByDescending(dc => dc.Document.UpdatedAt)
            .Select(dc => new { dc.Document, dc.Role })
            .ToListAsync();

        return owned.Concat(collaborated)
            .OrderByDescending(x => x.Document.UpdatedAt)
            .Select(x => (x.Document, x.Role))
            .ToList();
    }

    public async Task UpdateAsync(Document document)
    {
        document.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
    }

    public async Task DeleteAsync(Document document)
    {
        db.Documents.Remove(document);
        await db.SaveChangesAsync();
    }

    // ── Collaborators ─────────────────────────────────────────────────

    public async Task<List<DocumentCollaborator>> GetCollaboratorsAsync(Guid documentId)
    {
        return await db.DocumentCollaborators
            .Include(dc => dc.User)
            .Where(dc => dc.DocumentId == documentId)
            .OrderBy(dc => dc.AddedAt)
            .ToListAsync();
    }

    public async Task<DocumentCollaborator?> GetCollaboratorAsync(Guid documentId, Guid userId)
    {
        return await db.DocumentCollaborators
            .Include(dc => dc.User)
            .FirstOrDefaultAsync(dc => dc.DocumentId == documentId && dc.UserId == userId);
    }

    public async Task<DocumentCollaborator> AddCollaboratorAsync(Guid documentId, Guid userId, string role)
    {
        var collaborator = new DocumentCollaborator
        {
            DocumentId = documentId,
            UserId = userId,
            Role = role,
        };

        db.DocumentCollaborators.Add(collaborator);
        await db.SaveChangesAsync();

        await db.Entry(collaborator).Reference(c => c.User).LoadAsync();

        return collaborator;
    }

    public async Task UpdateCollaboratorRoleAsync(DocumentCollaborator collaborator, string newRole)
    {
        collaborator.Role = newRole;
        await db.SaveChangesAsync();
    }

    public async Task RemoveCollaboratorAsync(DocumentCollaborator collaborator)
    {
        db.DocumentCollaborators.Remove(collaborator);
        await db.SaveChangesAsync();
    }

    // ── Access Links ────────────────────────────────────────────────

    public async Task<DocumentAccessLink> CreateAccessLinkAsync(
        Guid documentId, Guid createdBy, string permission,
        bool allowAnonymous = false, int? maxUses = null)
    {
        var tokenBytes = RandomNumberGenerator.GetBytes(48);
        var token = Convert.ToBase64String(tokenBytes)
            .Replace('+', '-').Replace('/', '_').TrimEnd('=');

        var link = new DocumentAccessLink
        {
            DocumentId = documentId,
            Token = token,
            Permission = permission,
            CreatedBy = createdBy,
            IsActive = true,
            AllowAnonymous = allowAnonymous,
            MaxUses = allowAnonymous ? null : maxUses,
        };

        db.DocumentAccessLinks.Add(link);
        await db.SaveChangesAsync();

        return link;
    }

    public async Task<List<DocumentAccessLink>> GetAccessLinksAsync(Guid documentId, bool? allowAnonymous = null)
    {
        var query = db.DocumentAccessLinks.Where(l => l.DocumentId == documentId);
        if (allowAnonymous.HasValue)
            query = query.Where(l => l.AllowAnonymous == allowAnonymous.Value);
        return await query.OrderByDescending(l => l.CreatedAt).ToListAsync();
    }

    // Atomically increments use_count. Returns false if the link has reached its usage limit.
    public async Task<bool> TryIncrementLinkUseCountAsync(Guid linkId)
    {
        var updated = await db.DocumentAccessLinks
            .Where(l => l.Id == linkId && l.IsActive && (l.MaxUses == null || l.UseCount < l.MaxUses))
            .ExecuteUpdateAsync(s => s.SetProperty(l => l.UseCount, l => l.UseCount + 1));
        return updated > 0;
    }

    public async Task<DocumentAccessLink?> GetAccessLinkByTokenAsync(string token)
    {
        return await db.DocumentAccessLinks
            .Include(l => l.Document)
                .ThenInclude(d => d.Owner)
            .Include(l => l.Document)
                .ThenInclude(d => d.Collaborators)
            .FirstOrDefaultAsync(l => l.Token == token);
    }

    public async Task RevokeAccessLinkAsync(DocumentAccessLink link)
    {
        link.IsActive = false;
        await db.SaveChangesAsync();
    }

    // Revokes an anonymous access link and cascade-deletes all grants. Returns the deleted grant IDs
    // so the caller can disconnect active WebSocket connections.
    public async Task<List<Guid>> RevokeAnonymousLinkWithCascadeAsync(DocumentAccessLink link)
    {
        link.IsActive = false;

        var grantIds = await db.AnonymousAccessGrants
            .Where(g => g.AccessLinkId == link.Id)
            .Select(g => g.Id)
            .ToListAsync();

        await db.AnonymousAccessGrants
            .Where(g => g.AccessLinkId == link.Id)
            .ExecuteDeleteAsync();

        await db.SaveChangesAsync();

        return grantIds;
    }

    // ── Anonymous Access Grants ─────────────────────────────────────

    public async Task<AnonymousAccessGrant> CreateAnonymousGrantAsync(Guid accessLinkId, Guid? userId, string displayName)
    {
        var grant = new AnonymousAccessGrant
        {
            AccessLinkId = accessLinkId,
            UserId = userId,
            DisplayName = displayName,
            LastSeenAt = DateTime.UtcNow,
        };

        db.AnonymousAccessGrants.Add(grant);
        await db.SaveChangesAsync();

        return grant;
    }

    public async Task<AnonymousAccessGrant?> GetAnonymousGrantByIdAsync(Guid grantId)
    {
        return await db.AnonymousAccessGrants
            .Include(g => g.AccessLink)
                .ThenInclude(l => l.Document)
                    .ThenInclude(d => d.Owner)
            .FirstOrDefaultAsync(g => g.Id == grantId);
    }

    // Finds an active anonymous grant for a logged-in user on a specific document.
    // Used by the WebSocket and REST auth fallback for logged-in users who joined via anonymous link.
    public async Task<AnonymousAccessGrant?> GetActiveGrantByUserAndDocumentAsync(Guid userId, Guid documentId)
    {
        return await db.AnonymousAccessGrants
            .Include(g => g.AccessLink)
            .FirstOrDefaultAsync(g =>
                g.UserId == userId &&
                g.AccessLink.DocumentId == documentId &&
                g.AccessLink.IsActive);
    }

    // Finds an existing grant for a logged-in user on a specific link (for idempotent joins).
    public async Task<AnonymousAccessGrant?> GetExistingGrantForUserAsync(Guid accessLinkId, Guid userId)
    {
        return await db.AnonymousAccessGrants
            .Include(g => g.AccessLink)
                .ThenInclude(l => l.Document)
                    .ThenInclude(d => d.Owner)
            .FirstOrDefaultAsync(g => g.AccessLinkId == accessLinkId && g.UserId == userId);
    }

    // Gets all active anonymous grants for a document (for the collaborator list).
    public async Task<List<AnonymousAccessGrant>> GetGrantsForDocumentAsync(Guid documentId)
    {
        return await db.AnonymousAccessGrants
            .Include(g => g.User)
            .Include(g => g.AccessLink)
            .Where(g => g.AccessLink.DocumentId == documentId && g.AccessLink.IsActive)
            .OrderByDescending(g => g.LastSeenAt)
            .ToListAsync();
    }

    public async Task UpdateGrantLastSeenAsync(Guid grantId)
    {
        await db.AnonymousAccessGrants
            .Where(g => g.Id == grantId)
            .ExecuteUpdateAsync(s => s.SetProperty(g => g.LastSeenAt, DateTime.UtcNow));
    }

    // ── Yjs State ─────────────────────────────────────────────────────

    // Get just the raw Yjs binary state for a document (used when editor loads)
    public async Task<byte[]?> GetStateAsync(Guid documentId)
    {
        return await db.Documents
            .Where(d => d.Id == documentId)
            .Select(d => d.YjsState)
            .FirstOrDefaultAsync();
    }

    // Mutates the Y.Doc for a document — used by file API endpoints to add/remove/clear Y.Texts.
    // Acquires a transient lifetime token on the room (creating one if no clients are connected),
    // applies the mutation, and releases. If we're the last holder, the room is persisted and
    // disposed on the way out — no leaked locks, no orphan rooms.
    //
    // Two-phase callback per the YDotNet API design (see github.com/y-crdt/ydotnet README):
    //   - `prepare(doc)` runs first, no transaction open — call `doc.Text()`/`doc.Map()` etc.
    //     here to get-or-create root types. These methods open implicit transactions internally.
    //   - `mutate(prepared, txn)` runs inside an explicit WriteTransaction.
    public async Task WithYDocAsync<T>(Guid documentId, Func<Doc, T> prepare, Action<T, YDotNet.Document.Transactions.Transaction> mutate)
    {
        var room = await WebSockets.YjsRelayMiddleware.EnsureRoomAsync(
            documentId,
            () => GetStateAsync(documentId));
        try
        {
            // Acquire room.SaveLock so a concurrent version restore can't ReplaceStateAsync
            // out from under our mutation. Without this gate, an upload landing during the
            // reconcile→EvictRoom window has its freshly-inserted Y.Text wiped (the new file
            // row remains, content disappears). Our lifetime token keeps the room alive while
            // we wait — SaveLock disposal can't race us until refcount drops to zero.
            await room.SaveLock.WaitAsync();
            try
            {
                await room.MutateAsync(prepare, mutate);
            }
            finally
            {
                room.SaveLock.Release();
            }
        }
        finally
        {
            await WebSockets.YjsRelayMiddleware.ReleaseRoomAsync(
                documentId, room,
                state => SaveStateAsync(documentId, state));
        }
    }

    // Read-only Y.Doc access — extracts a value without persisting. Used by compile / download
    // to pull Y.Text content for collaborative files. Same two-phase pattern as WithYDocAsync.
    // Acquires a transient room (or joins an existing one); does not mark dirty so refcount-zero
    // release won't persist (the room would be IsDirty=false anyway).
    public async Task<TResult> WithYDocReadAsync<TPrep, TResult>(
        Guid documentId,
        Func<Doc, TPrep> prepare,
        Func<TPrep, YDotNet.Document.Transactions.Transaction, TResult> reader)
    {
        var room = await WebSockets.YjsRelayMiddleware.EnsureRoomAsync(
            documentId,
            () => GetStateAsync(documentId));
        try
        {
            // Hold SaveLock for reads too so a concurrent version restore can't replace state
            // while we're reading — download / compile / save-as-template would otherwise see a
            // pre-restore snapshot that no longer reflects committed DB state.
            await room.SaveLock.WaitAsync();
            try
            {
                return await room.ReadAsync(prepare, reader);
            }
            finally
            {
                room.SaveLock.Release();
            }
        }
        finally
        {
            await WebSockets.YjsRelayMiddleware.ReleaseRoomAsync(
                documentId, room,
                state => SaveStateAsync(documentId, state));
        }
    }

    // Convenience wrapper: read the current text of a collaborative file from the Y.Doc.
    // Returns empty string if the Y.Text doesn't exist (just-created file, or stale fileId).
    public async Task<string> GetCollaborativeContentAsync(Guid documentId, Guid fileId)
    {
        return await WithYDocReadAsync(
            documentId,
            doc => doc.Text(fileId.ToString()),
            (yText, txn) => yText?.String(txn) ?? string.Empty);
    }

    // Reads live UTF-8 byte sizes for the collaborative files in `files` — ONLY if a Y.Doc
    // room is already loaded for this document. Cold rooms aren't rehydrated; their entry
    // is simply omitted from the returned dictionary (caller treats absence as "size unknown").
    //
    // One Y.Doc read transaction covers every requested file, so this is one lock acquire
    // regardless of how many collab files are in the document.
    //
    // Why this exists: DocumentFile.Size is set at upload time and never updated as Y.Text
    // content grows via WebSocket — so for live-edited collab files the stored value drifts
    // (an empty .tex stays Size=0 even after 50KB of edits). This is the file-list endpoint's
    // way of returning honest sizes for active docs without paying a rehydration cost on
    // cold ones.
    public Task<Dictionary<Guid, int>> TryReadCollabSizesAsync(
        Guid documentId,
        IReadOnlyList<DocumentFile> files)
    {
        var room = WebSockets.YjsRelayMiddleware.TryGetLoadedRoom(documentId);
        if (room is null) return Task.FromResult(new Dictionary<Guid, int>());

        var collabFileIds = files
            .Where(f => f.IsCollaborative)
            .Select(f => f.Id)
            .ToList();
        if (collabFileIds.Count == 0) return Task.FromResult(new Dictionary<Guid, int>());

        return room.ReadAsync(
            doc => collabFileIds.Select(id => (id, text: doc.Text(id.ToString()))).ToList(),
            (entries, txn) =>
            {
                var sizes = new Dictionary<Guid, int>(entries.Count);
                foreach (var (id, text) in entries)
                {
                    if (text is null) continue;
                    var s = text.String(txn) ?? string.Empty;
                    sizes[id] = System.Text.Encoding.UTF8.GetByteCount(s);
                }
                return sizes;
            });
    }

    // Persist the Yjs state from the editor back to DB, merging with existing state
    public async Task SaveStateAsync(Guid documentId, byte[] incomingState)
    {
        var document = await db.Documents.FindAsync(documentId);
        if (document is null) return;

        document.YjsState = MergeYjsState(document.YjsState, incomingState);
        document.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();

        if (document.YjsState.Length > StateAlarmThresholdBytes)
        {
            Console.WriteLine(
                $"[texmex] Y.Doc size alarm: document {documentId} state = {document.YjsState.Length / 1024} KB " +
                $"(threshold {StateAlarmThresholdBytes / 1024 / 1024} MB). Consider compaction.");
        }
    }

    // Merges incoming Yjs state with existing state. If either is corrupted, degrades gracefully.
    internal static byte[] MergeYjsState(byte[]? existingState, byte[] incomingState)
    {
        if (existingState is null || existingState.Length == 0)
            return incomingState;

        try
        {
            using var doc = NewYDoc();
            using (var writeTxn = doc.WriteTransaction())
            {
                try
                {
                    writeTxn.ApplyV1(existingState);
                }
                catch (Exception ex)
                {
                    // Existing state corrupted — overwrite with incoming as recovery
                    Console.WriteLine($"[texmex] Warning: Existing Yjs state corrupted, overwriting: {ex.Message}");
                    writeTxn.Commit();
                    return incomingState;
                }

                try
                {
                    writeTxn.ApplyV1(incomingState);
                }
                catch (Exception ex)
                {
                    // Incoming state corrupted — keep existing state
                    Console.WriteLine($"[texmex] Warning: Incoming Yjs state corrupted, discarding: {ex.Message}");
                    writeTxn.Commit();
                    return existingState;
                }

                writeTxn.Commit();
            }

            // Re-open a ReadTransaction to extract the merged state. YDotNet 0.6.0 rejects
            // null state vectors on a WriteTransaction's StateDiffV1 after ApplyV1 (throws
            // ArgumentNullException for parameter 'source'); the ReadTransaction overload is
            // the form that accepts null and returns the full diff. Same pattern as
            // RoomState.ExportStateAsync.
            using (var readTxn = doc.ReadTransaction())
            {
                return readTxn.StateDiffV1(null!);
            }
        }
        catch (Exception ex)
        {
            // Merge itself failed — fall back to incoming state
            Console.WriteLine($"[texmex] Warning: Yjs merge failed, using incoming state: {ex.Message}");
            return incomingState;
        }
    }

    // Decodes a Yjs V1 update and extracts the text of a specific Y.Text by key.
    // Returns null on corrupted state instead of crashing.
    private static string? DecodeYjsTextByKey(byte[] state, string yTextKey)
    {
        try
        {
            using var doc = NewYDoc();
            using (var loadTxn = doc.WriteTransaction())
            {
                loadTxn.ApplyV1(state);
                loadTxn.Commit();
            }
            // Acquire Y.Text reference OUTSIDE the read transaction (YDotNet 0.6.0 quirk).
            var yText = doc.Text(yTextKey);
            using var readTxn = doc.ReadTransaction();
            return yText?.String(readTxn);
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[texmex] Warning: Failed to decode Yjs state: {ex.Message}");
            return null;
        }
    }

    // Builds a fresh Yjs V1 state with one Y.Text per collaborative file. Each Y.Text is keyed
    // by the file's GUID (as a string) — using the stable GUID rather than the filename means
    // renames don't require touching the Y.Doc.
    //
    // Pattern notes (per the YDotNet README and unit tests at github.com/y-crdt/ydotnet):
    //   - `Doc.Text(name)` is get-or-create; it opens its own implicit transaction and cannot be
    //     called inside an open WriteTransaction. So we acquire all Y.Text refs first, then open
    //     the transaction. This is the documented canonical pattern.
    //   - `StateDiffV1` accepts the empty state vector as either `null` or `Array.Empty<byte>()`,
    //     but on a freshly-mutated doc with no prior ApplyV1, only `null` reliably returns the
    //     full state (the empty-array overload can return a null buffer in the wrapper). Pass null.
    public static byte[] CreateInitialYjsState(IEnumerable<(Guid fileId, string content)> files)
    {
        using var doc = NewYDoc();
        var seeds = files.Select(f => (yText: doc.Text(f.fileId.ToString()), content: f.content)).ToList();

        using var txn = doc.WriteTransaction();
        foreach (var (yText, content) in seeds)
        {
            if (!string.IsNullOrEmpty(content))
            {
                yText.Insert(txn, 0, content);
            }
        }
        var state = txn.StateDiffV1(null!);
        txn.Commit();
        return state;
    }

    // Decodes a snapshot once and returns file_id -> text for the given collaborative file ids.
    // Used by forward-delta restore to read each collaborative file's content out of a version's
    // Yjs snapshot. A branch not present in the snapshot decodes to "". The try/catch surfaces a
    // CorruptedYjsStateException for inputs that actually throw — note YDotNet's ApplyV1 is lenient
    // and silently ignores most malformed bytes (it won't reliably throw), so this is defense in
    // depth, not a guarantee. Snapshots are our own valid StateDiffV1 output and restore is
    // reversible (auto-snapshot before restore), so the residual risk is low.
    internal static Dictionary<Guid, string> DecodeCollaborativeTexts(
        byte[] snapshot, IReadOnlyCollection<Guid> collaborativeFileIds, Guid documentId)
    {
        var result = new Dictionary<Guid, string>();
        if (collaborativeFileIds.Count == 0) return result;

        try
        {
            using var doc = NewYDoc();
            using (var loadTxn = doc.WriteTransaction())
            {
                loadTxn.ApplyV1(snapshot);
                loadTxn.Commit();
            }
            // Acquire all Y.Text refs OUTSIDE the read transaction (YDotNet 0.6.0 quirk).
            var refs = collaborativeFileIds
                .Select(id => (id, yText: doc.Text(id.ToString())))
                .ToList();
            using var readTxn = doc.ReadTransaction();
            foreach (var (id, yText) in refs)
            {
                result[id] = yText?.String(readTxn) ?? string.Empty;
            }
            return result;
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[texmex] Warning: Failed to decode version snapshot for forward-delta: {ex.Message}");
            throw new CorruptedYjsStateException(documentId);
        }
    }

    // Builds the forward-delta restore state ("D2"): starting from the document's CURRENT Yjs state,
    // set each target branch's text to the snapshot value and clear each branch in branchesToClear,
    // then return the resulting full V1 state. This is a pure transform — it never touches a live
    // room. Because it loads currentState first and only adds delete+insert ops on top, the result
    // is causally AFTER currentState (state vector grows): the "revert" lives in history, so a
    // client that already holds the current items only needs to merge these new ops (no rewind, so
    // nothing to un-merge). Per-branch this mirrors CreateOrReplaceFileAsync's clear+insert.
    internal static byte[] ComputeForwardDeltaState(
        byte[] currentState,
        IReadOnlyDictionary<Guid, string> targetTexts,
        IReadOnlyCollection<Guid> branchesToClear)
    {
        using var doc = NewYDoc();
        if (currentState.Length > 0)
        {
            using var loadTxn = doc.WriteTransaction();
            loadTxn.ApplyV1(currentState);
            loadTxn.Commit();
        }

        // Acquire every Y.Text ref before opening the write transaction (YDotNet quirk), then do all
        // mutations in ONE transaction so the revert is a single coherent update.
        var setRefs = targetTexts.Keys.Select(id => (id, yText: doc.Text(id.ToString()))).ToList();
        var clearRefs = branchesToClear.Select(id => (id, yText: doc.Text(id.ToString()))).ToList();

        using (var txn = doc.WriteTransaction())
        {
            foreach (var (id, yText) in setRefs)
            {
                var len = yText.Length(txn);
                if (len > 0) yText.RemoveRange(txn, 0, len);
                var content = targetTexts[id];
                if (!string.IsNullOrEmpty(content)) yText.Insert(txn, 0, content);
            }
            foreach (var (_, yText) in clearRefs)
            {
                var len = yText.Length(txn);
                if (len > 0) yText.RemoveRange(txn, 0, len);
            }
            txn.Commit();
        }

        using var readTxn = doc.ReadTransaction();
        return readTxn.StateDiffV1(null!);
    }

    // ── Versions ────────────────────────────────────────────────────

    // Snapshots the current Yjs state as a version (empty byte array if no state yet)
    public async Task<DocumentVersion> CreateVersionAsync(Guid documentId, Guid createdBy, string? label, string? message)
    {
        // Flush in-memory Y.Doc to DB first so the version captures the current live state,
        // not the last 30s-stale auto-saved state. Export + ClearDirty must be atomic under the
        // doc lock — otherwise a concurrent edit between Export and ClearDirty would be marked
        // clean and could go unpersisted (fatal during version restore which evicts the room).
        //
        // Take a lifetime token so the room can't be disposed under us during CaptureForVersionAsync
        // (e.g., last WS client disconnecting). Release via ReleaseRoomAsync — if we were the last
        // holder, IsDirty is already cleared by CaptureForVersionAsync, so no re-save.
        if (WebSockets.YjsRelayMiddleware.Rooms.TryGetValue(documentId.ToString(), out var room)
            && room.TryAcquireLifetime())
        {
            try
            {
                var liveState = await room.CaptureForVersionAsync();
                if (liveState is not null)
                {
                    await SaveStateAsync(documentId, liveState);
                }
            }
            finally
            {
                await WebSockets.YjsRelayMiddleware.ReleaseRoomAsync(
                    documentId, room,
                    state => SaveStateAsync(documentId, state));
            }
        }

        var document = await db.Documents.FindAsync(documentId);

        // Pre-assign the version Id client-side so we can wire up DocumentVersionFile.VersionId
        // before any SaveChanges. The whole thing then commits in one atomic write.
        //
        // Why this matters: the previous shape was two separate SaveChanges (version row first,
        // then file rows), so a DB hiccup between them left a durable version row with zero
        // version_files. ReconcileFilesAndOverwriteStateAsync would then read snapshot = [] on
        // restore and soft-delete every active file in the document — catastrophic.
        var activeFiles = await db.DocumentFiles
            .IgnoreQueryFilters()
            .Where(f => f.DocumentId == documentId && f.DeletedAt == null)
            .ToListAsync();

        var version = new DocumentVersion
        {
            Id = Guid.NewGuid(),
            DocumentId = documentId,
            CreatedBy = createdBy,
            Label = label?.Trim(),
            Message = message?.Trim(),
            YjsSnapshot = document?.YjsState ?? [],
            // Capture the entrypoint by stable file_id (not filename) so a later rename can't break
            // reading this version's source text or resetting Document.Entrypoint on restore.
            // document can race to null if the row is hard-deleted between the endpoint's auth
            // check and the FindAsync above; FirstOrDefault on a null Entrypoint returns null,
            // which is the same fallback as "no matching active file" (acceptable per schema).
            EntrypointFileId = activeFiles
                .FirstOrDefault(f => f.Filename == document?.Entrypoint && f.IsCollaborative)?.Id,
        };
        db.DocumentVersions.Add(version);

        foreach (var f in activeFiles)
        {
            db.DocumentVersionFiles.Add(new DocumentVersionFile
            {
                VersionId = version.Id,
                FileId = f.Id,
                Filename = f.Filename,
                ContentType = f.ContentType,
                IsCollaborative = f.IsCollaborative,
            });
        }
        await db.SaveChangesAsync();

        await db.Entry(version).Reference(v => v.Creator).LoadAsync();

        return version;
    }

    // Returns the file metadata captured for a specific version. Used by version restore
    // to reconcile DocumentFile rows.
    public async Task<List<DocumentVersionFile>> GetVersionFilesAsync(Guid versionId)
    {
        return await db.DocumentVersionFiles
            .Where(vf => vf.VersionId == versionId)
            .ToListAsync();
    }

    // Builds the forward-delta restore state ("D2"): starting from the document's CURRENT Yjs
    // state, set each collaborative branch to its snapshot text, and clear any branch that
    // currently holds collaborative content but is NOT collaborative in the snapshot (a file added
    // since, or one whose category changed). This is the CRDT-correct "restore = forward edit"
    // model — the state only moves forward, so no client (connected, reconnecting, or offline) has
    // anything to un-merge. Pure: reads DB + currentState, mutates nothing. Throws
    // CorruptedYjsStateException if the snapshot can't be decoded so the caller aborts before any
    // DB/Y.Doc change.
    public async Task<byte[]> BuildForwardDeltaForRestoreAsync(Guid documentId, DocumentVersion version, byte[] currentState)
    {
        var versionFiles = await GetVersionFilesAsync(version.Id);
        var snapshotCollabIds = versionFiles.Where(vf => vf.IsCollaborative).Select(vf => vf.FileId).ToList();
        var snapshotCollabSet = snapshotCollabIds.ToHashSet();

        var currentActiveCollabIds = await db.DocumentFiles
            .IgnoreQueryFilters()
            .Where(f => f.DocumentId == documentId && f.DeletedAt == null && f.IsCollaborative)
            .Select(f => f.Id)
            .ToListAsync();

        // Branches to clear: collaborative content that exists now but shouldn't after restore.
        var clears = currentActiveCollabIds.Where(id => !snapshotCollabSet.Contains(id)).ToList();
        var targets = DecodeCollaborativeTexts(version.YjsSnapshot, snapshotCollabIds, documentId);

        return ComputeForwardDeltaState(currentState, targets, clears);
    }

    // Performs the DB-side of a version restore inside a single transaction:
    //   1. Two-phase rename: every touched file (in-snapshot OR currently-active) gets a temp name
    //      first, then settles to its target name. Handles A↔B filename swap cycles safely.
    //   2. Reconciles soft-delete state: files NOT in the snapshot get soft-deleted; files IN the
    //      snapshot get un-soft-deleted with their captured metadata (filename, content_type, is_collaborative).
    //   3. Overwrites Document.YjsState with `newYjsState` — the forward-delta state (D2) computed
    //      by BuildForwardDeltaForRestoreAsync, NOT the raw snapshot. Writing D2 (current + a forward
    //      "revert" edit) instead of rewinding to the snapshot bytes is what keeps restore correct
    //      for offline/reconnecting clients. Committing it in the same transaction as the file-row
    //      reconciliation preserves atomicity (files + state move together or not at all).
    // Caller is responsible for the save lock, auto-snapshot, and room eviction.
    public async Task ReconcileFilesAndOverwriteStateAsync(Guid documentId, DocumentVersion version, byte[] newYjsState)
    {
        var snapshot = await GetVersionFilesAsync(version.Id);
        var snapshotIds = snapshot.Select(s => s.FileId).ToHashSet();

        var currentActiveIds = await db.DocumentFiles
            .IgnoreQueryFilters()
            .Where(f => f.DocumentId == documentId && f.DeletedAt == null)
            .Select(f => f.Id)
            .ToListAsync();

        var allTouchedIds = snapshotIds.Union(currentActiveIds).Distinct().ToList();

        await using var transaction = await db.Database.BeginTransactionAsync();
        try
        {
            // Phase 1: rename every touched row to a temp name to avoid partial-unique-index collisions
            // on filename swaps (A→B, B→A).
            foreach (var fid in allTouchedIds)
            {
                var tempName = $"__restore_{fid}.tmp";
                await db.DocumentFiles
                    .IgnoreQueryFilters()
                    .Where(f => f.Id == fid)
                    .ExecuteUpdateAsync(s => s.SetProperty(f => f.Filename, tempName));
            }

            // Phase 2a: soft-delete files that were active but are NOT in the snapshot.
            var toSoftDelete = currentActiveIds.Where(id => !snapshotIds.Contains(id)).ToList();
            if (toSoftDelete.Count > 0)
            {
                var now = DateTime.UtcNow;
                await db.DocumentFiles
                    .IgnoreQueryFilters()
                    .Where(f => toSoftDelete.Contains(f.Id))
                    .ExecuteUpdateAsync(s => s.SetProperty(f => f.DeletedAt, (DateTime?)now));
            }

            // Phase 2b: un-soft-delete + restore metadata for files in the snapshot.
            foreach (var snap in snapshot)
            {
                await db.DocumentFiles
                    .IgnoreQueryFilters()
                    .Where(f => f.Id == snap.FileId)
                    .ExecuteUpdateAsync(s => s
                        .SetProperty(f => f.DeletedAt, (DateTime?)null)
                        .SetProperty(f => f.Filename, snap.Filename)
                        .SetProperty(f => f.ContentType, snap.ContentType)
                        .SetProperty(f => f.IsCollaborative, snap.IsCollaborative));
            }

            // Phase 3: write the forward-delta state (D2), NOT the raw snapshot — see method doc.
            // Also reset Document.Entrypoint to the entrypoint's filename AT VERSION TIME (resolved
            // by the stable EntrypointFileId), so a rename-then-restore doesn't leave Entrypoint
            // pointing at a filename that no longer exists (which would 422 on compile). Resolved
            // from the snapshot rows already loaded above. Legacy versions (no EntrypointFileId) or
            // an unresolvable id leave Entrypoint unchanged.
            var restoredEntrypoint = version.EntrypointFileId is { } epId
                ? snapshot.FirstOrDefault(s => s.FileId == epId)?.Filename
                : null;
            if (restoredEntrypoint is not null)
            {
                await db.Documents
                    .Where(d => d.Id == documentId)
                    .ExecuteUpdateAsync(s => s
                        .SetProperty(d => d.YjsState, newYjsState)
                        .SetProperty(d => d.Entrypoint, restoredEntrypoint)
                        .SetProperty(d => d.UpdatedAt, DateTime.UtcNow));
            }
            else
            {
                await db.Documents
                    .Where(d => d.Id == documentId)
                    .ExecuteUpdateAsync(s => s
                        .SetProperty(d => d.YjsState, newYjsState)
                        .SetProperty(d => d.UpdatedAt, DateTime.UtcNow));
            }

            await transaction.CommitAsync();
        }
        catch
        {
            await transaction.RollbackAsync();
            throw;
        }
    }

    public async Task<List<DocumentVersion>> GetVersionsAsync(Guid documentId)
    {
        return await db.DocumentVersions
            .Include(v => v.Creator)
            .Where(v => v.DocumentId == documentId)
            .OrderByDescending(v => v.CreatedAt)
            .ToListAsync();
    }

    public async Task<DocumentVersion?> GetVersionByIdAsync(Guid versionId)
    {
        return await db.DocumentVersions
            .Include(v => v.Creator)
            .FirstOrDefaultAsync(v => v.Id == versionId);
    }

    // Returns the entrypoint file's text content as captured in a specific version.
    // Looks up the entrypoint file_id in the version's snapshot of file metadata, then
    // extracts the corresponding Y.Text from the Y.Doc snapshot.
    public async Task<string?> GetVersionTextAsync(DocumentVersion version, string entrypointFilename)
    {
        if (version.YjsSnapshot is null || version.YjsSnapshot.Length == 0)
            return null;

        // Resolve the entrypoint by stable file_id captured at version time — this survives a rename
        // of the entrypoint (the filename in version_files reflects the name at snapshot time, which
        // may differ from the current Document.Entrypoint). Fall back to filename matching only for
        // legacy versions that predate EntrypointFileId (null).
        var versionFiles = await GetVersionFilesAsync(version.Id);
        var entrypointFileId = version.EntrypointFileId
            ?? versionFiles.FirstOrDefault(vf => vf.Filename == entrypointFilename && vf.IsCollaborative)?.FileId;
        if (entrypointFileId is null) return null;

        var text = DecodeYjsTextByKey(version.YjsSnapshot, entrypointFileId.Value.ToString());
        if (text is null)
            throw new CorruptedYjsStateException(version.DocumentId);

        return string.IsNullOrEmpty(text) ? null : text;
    }

    public async Task DeleteVersionAsync(DocumentVersion version)
    {
        db.DocumentVersions.Remove(version);
        await db.SaveChangesAsync();
    }

    // Files

    // Lists file metadata for a document, excluding binary data for performance.
    // Global query filter automatically excludes soft-deleted rows.
    public async Task<List<DocumentFile>> GetFilesAsync(Guid documentId)
    {
        return await db.DocumentFiles
            .Include(f => f.Uploader)
            .Where(f => f.DocumentId == documentId)
            .OrderBy(f => f.Filename)
            .Select(f => new DocumentFile
            {
                Id = f.Id,
                DocumentId = f.DocumentId,
                Filename = f.Filename,
                ContentType = f.ContentType,
                Size = f.Size,
                IsCollaborative = f.IsCollaborative,
                Data = null, // exclude binary data from listing
                UploadedBy = f.UploadedBy,
                CreatedAt = f.CreatedAt,
                Uploader = f.Uploader,
            })
            .ToListAsync();
    }

    // Single file with binary data, for downloads. Note: callers must branch on IsCollaborative —
    // for collab files Data is null and content should be read from the Y.Doc via GetCollaborativeContentAsync.
    public async Task<DocumentFile?> GetFileWithDataAsync(Guid fileId, Guid documentId)
    {
        return await db.DocumentFiles
            .Include(f => f.Uploader)
            .FirstOrDefaultAsync(f => f.Id == fileId && f.DocumentId == documentId);
    }

    // Result of an upload: the file row + whether it replaced an existing row (vs. created new).
    public record FileUpsertResult(DocumentFile File, bool WasReplaced);

    // Creates a new file or replaces an existing one with the same active name. For collaborative
    // file types (whitelisted extensions), the bytes are decoded as UTF-8 and inserted into the
    // Y.Doc as a Y.Text keyed by the file id; Data stays null. For static files, the bytes are
    // stored in Data and the Y.Doc is untouched.
    //
    // Ordering: for new collaborative files we mutate the Y.Doc BEFORE inserting the DB row, so a
    // failure between the two leaves a harmless orphan Y.Text (no row references it, so it's
    // invisible to the file list and garbage-collected by future compaction). The inverse order
    // would leave a phantom row pointing at a Y.Text that doesn't exist — downloads silently
    // return empty content with no error signalled.
    public async Task<FileUpsertResult> CreateOrReplaceFileAsync(
        Guid documentId, string filename, string contentType, byte[] data, Guid uploadedBy)
    {
        // Reject content that doesn't match the filename's declared type before we touch any
        // state — protects every upload path uniformly (regular upload, cross-type replace,
        // save-as-template). See ContentValidator for what's checked per extension.
        ContentValidator.Validate(filename, data);

        var isCollab = FileTypePolicy.IsCollaborativeFilename(filename);

        // Match against active rows only (global query filter)
        var existing = await db.DocumentFiles
            .FirstOrDefaultAsync(f => f.DocumentId == documentId && f.Filename == filename);

        DocumentFile file;
        var wasReplaced = existing is not null;
        if (existing is not null)
        {
            // Replace path: existing row's IsCollaborative is fixed at creation. We mutate the
            // Y.Text first (if collab), then update the DB row's metadata. Failure of either step
            // leaves the system observably consistent: either both updated or neither.
            if (existing.IsCollaborative)
            {
                var text = System.Text.Encoding.UTF8.GetString(data);
                await WithYDocAsync(
                    documentId,
                    doc => doc.Text(existing.Id.ToString()),
                    (yText, txn) =>
                    {
                        var len = yText.Length(txn);
                        if (len > 0) yText.RemoveRange(txn, 0, len);
                        if (!string.IsNullOrEmpty(text)) yText.Insert(txn, 0, text);
                    });
            }

            existing.ContentType = contentType;
            existing.Size = data.Length;
            existing.UploadedBy = uploadedBy;
            existing.CreatedAt = DateTime.UtcNow;
            existing.Data = existing.IsCollaborative ? null : data;
            file = existing;
        }
        else
        {
            // New row: pre-assign the Id so we can mutate the Y.Doc with the right key before
            // committing the row.
            file = new DocumentFile
            {
                Id = Guid.NewGuid(),
                DocumentId = documentId,
                Filename = filename,
                ContentType = contentType,
                Size = data.Length,
                IsCollaborative = isCollab,
                Data = isCollab ? null : data,
                UploadedBy = uploadedBy,
            };

            if (isCollab)
            {
                var text = System.Text.Encoding.UTF8.GetString(data);
                await WithYDocAsync(
                    documentId,
                    doc => doc.Text(file.Id.ToString()),
                    (yText, txn) =>
                    {
                        if (!string.IsNullOrEmpty(text)) yText.Insert(txn, 0, text);
                    });
            }

            db.DocumentFiles.Add(file);
        }

        await db.SaveChangesAsync();

        await db.Entry(file).Reference(f => f.Uploader).LoadAsync();
        return new FileUpsertResult(file, wasReplaced);
    }

    // Result of a rename attempt.
    public enum RenameResult { Ok, Conflict, CategoryMismatch }

    // Renames a file. Filename uniqueness is enforced by the partial unique index on
    // (document_id, filename) WHERE deleted_at IS NULL.
    // If the file is the document's entrypoint, Document.Entrypoint is updated atomically
    // to point at the new filename so compile / save-as-template / version text reads keep working.
    // Rejects renames that would change the file's category (collaborative/static_text/image/pdf/font)
    // — the row's storage shape is fixed at upload (Data column vs Y.Text branch, magic-byte format,
    // etc.) so crossing categories without a content rewrite leaves the row internally inconsistent.
    // Use the cross-type replace endpoint to actually change category.
    public async Task<RenameResult> RenameFileAsync(DocumentFile file, string newFilename)
    {
        // Compare CATEGORIES, not just the collaborative bool — a static_text→image rename
        // (e.g. data.csv → data.png) would otherwise slip through and leave text bytes in
        // the Data column under an image filename, which the frontend would try to render
        // as an image and fail. Blocking by category catches every cross-category transition.
        if (FileTypePolicy.Classify(file.Filename) != FileTypePolicy.Classify(newFilename))
        {
            return RenameResult.CategoryMismatch;
        }

        var conflict = await db.DocumentFiles
            .AnyAsync(f => f.DocumentId == file.DocumentId
                          && f.Filename == newFilename
                          && f.Id != file.Id);
        if (conflict)
            return RenameResult.Conflict;

        var document = await db.Documents.FindAsync(file.DocumentId);
        var wasEntrypoint = document is not null && file.Filename == document.Entrypoint;

        file.Filename = newFilename;
        if (wasEntrypoint && document is not null)
        {
            document.Entrypoint = newFilename;
        }
        await db.SaveChangesAsync();
        return RenameResult.Ok;
    }

    // Duplicates an existing file with a new "<base> copy[ N].<ext>" filename.
    // Collab content is extracted from the Y.Doc and re-seeded into the new file's Y.Text
    // (so the duplicate is a snapshot at the moment of duplication, not a live alias).
    // Static content is copied byte-for-byte.
    //
    // Naming: inserts " copy" before the extension; on collision walks " copy 2", " copy 3", ...
    // Stops at 9999 with a guard — astronomically unlikely in practice, but bounded to avoid an
    // infinite loop if some pathological state holds the entire suffix range.
    public async Task<DocumentFile> DuplicateFileAsync(DocumentFile source, Guid uploadedBy)
    {
        var newFilename = await GenerateUniqueDuplicateFilenameAsync(source.DocumentId, source.Filename);

        byte[] data;
        if (source.IsCollaborative)
        {
            var content = await GetCollaborativeContentAsync(source.DocumentId, source.Id);
            data = System.Text.Encoding.UTF8.GetBytes(content);
        }
        else
        {
            data = source.Data ?? Array.Empty<byte>();
        }

        var result = await CreateOrReplaceFileAsync(
            source.DocumentId, newFilename, source.ContentType, data, uploadedBy);
        return result.File;
    }

    private async Task<string> GenerateUniqueDuplicateFilenameAsync(Guid documentId, string sourceFilename)
    {
        // Split into (directory + base + extension). Directory is everything up to (and including)
        // the last '/'; extension is the part after the last '.' in the base segment. Files with
        // no extension (e.g. "Makefile") get the suffix appended to the whole base.
        var lastSlash = sourceFilename.LastIndexOf('/');
        var dir = lastSlash >= 0 ? sourceFilename[..(lastSlash + 1)] : "";
        var nameSegment = lastSlash >= 0 ? sourceFilename[(lastSlash + 1)..] : sourceFilename;
        var lastDot = nameSegment.LastIndexOf('.');
        string baseName, ext;
        if (lastDot > 0)
        {
            baseName = nameSegment[..lastDot];
            ext = nameSegment[lastDot..]; // includes the dot
        }
        else
        {
            baseName = nameSegment;
            ext = "";
        }

        // First candidate: "<base> copy<ext>". On collision: " copy 2", " copy 3", ...
        var candidate = $"{dir}{baseName} copy{ext}";
        var suffix = 2;
        while (await db.DocumentFiles.AnyAsync(f => f.DocumentId == documentId && f.Filename == candidate))
        {
            if (suffix > 9999)
                throw new InvalidOperationException("Could not generate a unique duplicate filename.");
            candidate = $"{dir}{baseName} copy {suffix}{ext}";
            suffix++;
        }
        return candidate;
    }

    // Atomic folder rename. Updates every active file with Filename starting with `fromPrefix`
    // to use `toPrefix` instead (in a single transaction). Pre-validates that no resulting path
    // collides with another active file in the same document — if any do, returns the conflicting
    // path and no DB write happens. This is the fix for the FE-side per-file PATCH loop that
    // could leave the document in a half-renamed state when one file in the middle hit a 409.
    //
    // fromPrefix / toPrefix are folder paths and MUST end with '/'. An empty toPrefix moves all
    // the files to the document root (e.g. "src/" → "" flattens src/ contents to the root).
    public record FolderRenameResult(bool Success, string? ConflictingPath, List<DocumentFile> Renamed);

    public async Task<FolderRenameResult> RenameFolderAsync(Guid documentId, string fromPrefix, string toPrefix)
    {
        var files = await db.DocumentFiles
            .Where(f => f.DocumentId == documentId && f.Filename.StartsWith(fromPrefix))
            .ToListAsync();

        if (files.Count == 0)
            return new FolderRenameResult(true, null, new List<DocumentFile>());

        // Build (file → newFilename) and pre-validate that none collides with an existing active
        // file OUTSIDE the moved set. Files INSIDE the moved set don't collide with each other
        // because the suffix after `fromPrefix` is unique per source row by the existing
        // per-document filename uniqueness invariant.
        var renames = files
            .Select(f => (file: f, newFilename: toPrefix + f.Filename[fromPrefix.Length..]))
            .ToList();

        var movedIds = files.Select(f => f.Id).ToHashSet();
        foreach (var (_, newFilename) in renames)
        {
            var collision = await db.DocumentFiles.AnyAsync(f =>
                f.DocumentId == documentId
                && f.Filename == newFilename
                && !movedIds.Contains(f.Id));
            if (collision)
                return new FolderRenameResult(false, newFilename, new List<DocumentFile>());
        }

        // Keep Document.Entrypoint pointing at the renamed entrypoint file (if any) — the per-file
        // rename method does this one at a time; here we do it once after the loop.
        var document = await db.Documents.FindAsync(documentId);

        foreach (var (file, newFilename) in renames)
        {
            var wasEntrypoint = document is not null && file.Filename == document.Entrypoint;
            file.Filename = newFilename;
            if (wasEntrypoint && document is not null)
            {
                document.Entrypoint = newFilename;
            }
        }

        await db.SaveChangesAsync();
        return new FolderRenameResult(true, null, files);
    }

    // Bulk-delete every active file under a folder prefix. Soft-deletes (sets DeletedAt) so
    // version restore can revive the files later, mirroring the per-file delete path. Refuses
    // to run if the entrypoint lives inside the folder — same reasoning as the per-file delete
    // refusing entrypoint removal (orphans Document.Entrypoint).
    public record FolderDeleteResult(bool Success, string? Reason, List<DocumentFile> Deleted);

    public async Task<FolderDeleteResult> DeleteFolderAsync(Guid documentId, string prefix)
    {
        var files = await db.DocumentFiles
            .Where(f => f.DocumentId == documentId && f.Filename.StartsWith(prefix))
            .ToListAsync();

        if (files.Count == 0)
            return new FolderDeleteResult(true, null, new List<DocumentFile>());

        var document = await db.Documents.FindAsync(documentId);
        var entrypoint = document?.Entrypoint;
        if (entrypoint is not null && files.Any(f => f.Filename == entrypoint))
        {
            return new FolderDeleteResult(false,
                "Cannot delete a folder containing the entrypoint file. Change the document's entrypoint first.",
                new List<DocumentFile>());
        }

        // Clear Y.Text content for each collab file (cosmetic — soft-delete is what hides them
        // from the file list). Mirrors DeleteFileAsync's per-file ordering: Y.Text first, then
        // DeletedAt, so a failure mid-loop leaves at most some empty Y.Texts behind, never
        // phantom rows referencing populated branches.
        foreach (var file in files)
        {
            if (file.IsCollaborative)
            {
                await WithYDocAsync(
                    file.DocumentId,
                    doc => doc.Text(file.Id.ToString()),
                    (yText, txn) =>
                    {
                        var len = yText.Length(txn);
                        if (len > 0) yText.RemoveRange(txn, 0, len);
                    });
            }
            file.DeletedAt = DateTime.UtcNow;
        }

        await db.SaveChangesAsync();
        return new FolderDeleteResult(true, null, files);
    }

    // True if this file is the document's entrypoint (i.e., deleting/renaming it would orphan
    // `Document.Entrypoint`). Callers should refuse the operation or sync the entrypoint reference.
    public async Task<bool> IsEntrypointAsync(DocumentFile file)
    {
        var entrypoint = await db.Documents
            .Where(d => d.Id == file.DocumentId)
            .Select(d => d.Entrypoint)
            .FirstOrDefaultAsync();
        return entrypoint == file.Filename;
    }

    // Soft-delete: sets deleted_at instead of removing the row. Preserves DocumentVersionFiles
    // references so version restore can revive the file. For collaborative files, clears the
    // Y.Text content in the Y.Doc.
    //
    // Ordering: clear the Y.Text BEFORE soft-deleting the DB row. Failure between leaves the
    // Y.Text empty but the row still active — the user sees an empty file and can re-upload.
    // The inverse order would leave the row hidden but the Y.Text content still in the Y.Doc,
    // which gets persisted into future version snapshots (bloat) and is less recoverable.
    public async Task DeleteFileAsync(DocumentFile file)
    {
        if (file.IsCollaborative)
        {
            await WithYDocAsync(
                file.DocumentId,
                doc => doc.Text(file.Id.ToString()),
                (yText, txn) =>
                {
                    var len = yText.Length(txn);
                    if (len > 0) yText.RemoveRange(txn, 0, len);
                });
        }

        file.DeletedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
    }

    // All active files for compile flow. Collab content lives in Y.Doc; static content in Data.
    // Use GetCollaborativeContentAsync to extract collab content.
    public async Task<List<DocumentFile>> GetAllFileDataAsync(Guid documentId)
    {
        return await db.DocumentFiles
            .Where(f => f.DocumentId == documentId)
            .Select(f => new DocumentFile
            {
                Id = f.Id,
                DocumentId = f.DocumentId,
                Filename = f.Filename,
                ContentType = f.ContentType,
                Size = f.Size,
                IsCollaborative = f.IsCollaborative,
                Data = f.Data,
                UploadedBy = f.UploadedBy,
                CreatedAt = f.CreatedAt,
            })
            .ToListAsync();
    }

    // Returns the subset of files matching the given IDs, scoped to a specific document
    // so callers can't reference files from other documents. Used by save-as-template.
    public async Task<List<DocumentFile>> GetFilesByIdsAsync(Guid documentId, List<Guid> fileIds)
    {
        if (fileIds.Count == 0) return new List<DocumentFile>();

        return await db.DocumentFiles
            .Where(f => f.DocumentId == documentId && fileIds.Contains(f.Id))
            .ToListAsync();
    }

    // Filename validation

    // Segments must start with a letter or digit, then allow dots, hyphens, underscores, spaces
    private static readonly Regex SegmentPattern = new(
        @"^[a-zA-Z0-9][a-zA-Z0-9._\- ]*$", RegexOptions.Compiled);

    // JS-prototype names cause subtle frontend bugs when filenames are used as object keys
    // (the FE keeps a Map<filename, FileMetadata> in many places). Blocklisted per segment.
    // Pattern borrowed from Overleaf's SafePath.mjs.
    private static readonly HashSet<string> BlockedSegmentNames = new(StringComparer.OrdinalIgnoreCase)
    {
        "prototype",
        "__proto__",
        "constructor",
        "hasOwnProperty",
        "isPrototypeOf",
        "propertyIsEnumerable",
        "toString",
        "valueOf",
    };

    // Validates a filename (may contain / for virtual folders). Returns null if valid, or an error message.
    public static string? ValidateFilename(string? filename, string entrypoint)
    {
        if (filename is null)
            return "Filename is required";

        // Null bytes can truncate strings at the OS level, bypassing later checks
        if (filename.Contains('\0'))
            return "Filename contains illegal characters";

        if (filename.Contains('\\'))
            return "Use forward slashes for paths";

        // Reject percent-encoded sequences so %2F or %00 can't slip past validation
        if (filename.Contains('%'))
            return "Filename must not contain percent-encoded characters";

        // ASCII only — prevents unicode homograph and RTL override tricks
        if (filename.Any(c => c > 127))
            return "Filename must contain only ASCII characters";

        if (filename.Any(c => char.IsControl(c)))
            return "Filename contains control characters";

        if (filename.Length == 0 || filename.Length > 255)
            return "Filename must be 1-255 characters";

        if (filename.StartsWith('/') || filename.EndsWith('/'))
            return "Filename must not start or end with a slash";

        if (filename.Contains("//"))
            return "Filename must not contain empty path segments";

        var segments = filename.Split('/');

        foreach (var segment in segments)
        {
            if (segment.Length == 0)
                return "Filename must not contain empty path segments";

            if (segment is "." or "..")
                return "Filename must not contain . or .. segments";

            if (segment.Trim() is "." or "..")
                return "Filename must not contain . or .. segments";

            if (segment.StartsWith('.'))
                return "Path segments must not start with a dot";

            if (segment.EndsWith('.') || segment.EndsWith(' '))
                return "Path segments must not end with a dot or space";

            if (!SegmentPattern.IsMatch(segment))
                return "Filename may only contain letters, digits, dots, hyphens, underscores, and spaces";

            // Reject reserved JS-prototype names (case-insensitive). Match against the segment
            // both with and without its extension — `prototype.tex` is just as problematic as `prototype`.
            var stem = Path.GetFileNameWithoutExtension(segment);
            if (BlockedSegmentNames.Contains(segment) || BlockedSegmentNames.Contains(stem))
                return $"Filename segment '{segment}' uses a reserved name";
        }

        // Note: with multi-file collab, the entrypoint is a regular DocumentFile (collaborative)
        // so uploading to its filename simply replaces its content. No reservation needed.

        // Final gate: the extension must be in the closed allowlist (FileTypePolicy.Classify).
        // This blocks executable types (.exe / .sh / .py / .dll) and anything else outside our
        // supported set — see FileTypePolicy for the full list with categories.
        if (!FileTypePolicy.IsAllowedFilename(filename))
            return "File extension is not supported. See API docs for the list of allowed types.";

        return null;
    }
}
