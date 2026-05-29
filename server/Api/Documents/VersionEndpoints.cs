using TexMex.Api.Auth;
using TexMex.Api.Models;
using TexMex.Data.Services;
using TexMex.WebSockets;

namespace TexMex.Api.Documents;

/// Version snapshots for a document — like git commits for your LaTeX project.
/// Create = owner or editor, list/get = any collaborator, delete = owner only.
public static class VersionEndpoints
{
    public static void MapVersionEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/documents/{documentId:guid}/versions");

        // POST /api/documents/{documentId}/versions — create a snapshot
        group.MapPost("/", async (Guid documentId, CreateVersionRequest request, DocumentService documentService, UserService userService, HttpContext context) =>
        {
            var user = await AuthHelper.GetCurrentUserAsync(context, userService);
            if (user is null)
                return Results.Problem(detail: "Not authenticated", statusCode: 401);

            var document = await documentService.GetByIdAsync(documentId);
            if (document is null)
                return Results.Problem(detail: "Document not found", statusCode: 404);

            var isOwner = document.OwnerId == user.Id;
            var isEditor = document.Collaborators.Any(c => c.UserId == user.Id && c.Role == "editor");
            if (!isOwner && !isEditor)
                return Results.Problem(detail: "Forbidden", statusCode: 403);

            var version = await documentService.CreateVersionAsync(documentId, user.Id, request.Label, request.Message);

            return Results.Created($"/api/documents/{documentId}/versions/{version.Id}", new VersionResponse(
                version.Id,
                version.Label,
                version.Message,
                version.Creator.DisplayName,
                version.CreatedAt,
                null
            ));
        }).WithTags("Versions")
          .WithSummary("Creates a new version for a document.")
          .Produces<VersionResponse>(StatusCodes.Status201Created)
          .Produces(StatusCodes.Status401Unauthorized)
          .Produces(StatusCodes.Status403Forbidden)
          .Produces(StatusCodes.Status404NotFound);

        // GET /api/documents/{documentId}/versions — list all versions
        group.MapGet("/", async (Guid documentId, DocumentService documentService, UserService userService, HttpContext context) =>
        {
            var document = await documentService.GetByIdAsync(documentId);
            if (document is null)
                return Results.Problem(detail: "Document not found", statusCode: 404);

            var access = await AuthHelper.ResolveAccessAsync(context, document, userService, documentService);
            if (access is null)
                return Results.Problem(detail: "Not authenticated", statusCode: 401);
            if (access.Role is null)
                return Results.Problem(detail: "Forbidden", statusCode: 403);

            var versions = await documentService.GetVersionsAsync(documentId);

            var response = versions.Select(v => new VersionResponse(
                v.Id,
                v.Label,
                v.Message,
                v.Creator.DisplayName,
                v.CreatedAt,
                null
            ));

            return Results.Ok(response);
        }).WithTags("Versions")
          .WithSummary("Lists all versions for a document.")
          .Produces<IEnumerable<VersionResponse>>(StatusCodes.Status200OK)
          .Produces(StatusCodes.Status401Unauthorized)
          .Produces(StatusCodes.Status403Forbidden)
          .Produces(StatusCodes.Status404NotFound);

        // GET /api/documents/{documentId}/versions/{versionId} — get a single version
        group.MapGet("/{versionId:guid}", async (Guid documentId, Guid versionId, DocumentService documentService, UserService userService, HttpContext context) =>
        {
            var document = await documentService.GetByIdAsync(documentId);
            if (document is null)
                return Results.Problem(detail: "Document not found", statusCode: 404);

            var access = await AuthHelper.ResolveAccessAsync(context, document, userService, documentService);
            if (access is null)
                return Results.Problem(detail: "Not authenticated", statusCode: 401);
            if (access.Role is null)
                return Results.Problem(detail: "Forbidden", statusCode: 403);

            // Make sure the version actually belongs to this document
            var version = await documentService.GetVersionByIdAsync(versionId);
            if (version is null || version.DocumentId != documentId)
                return Results.Problem(detail: "Version not found", statusCode: 404);

            string? sourceText;
            try
            {
                sourceText = await documentService.GetVersionTextAsync(version, document.Entrypoint);
            }
            catch (CorruptedYjsStateException)
            {
                return Results.Problem(detail: "Version snapshot is corrupted and cannot be compared.", statusCode: 422);
            }

            return Results.Ok(new VersionResponse(
                version.Id,
                version.Label,
                version.Message,
                version.Creator.DisplayName,
                version.CreatedAt,
                sourceText
            ));
        }).WithTags("Versions")
          .WithSummary("Gets a single version by ID.")
          .Produces<VersionResponse>(StatusCodes.Status200OK)
          .Produces(StatusCodes.Status401Unauthorized)
          .Produces(StatusCodes.Status403Forbidden)
          .Produces(StatusCodes.Status404NotFound)
          .Produces(StatusCodes.Status422UnprocessableEntity);

        // Restore a version — replaces the document state and kicks all connected editors
        group.MapPost("/{versionId:guid}/restore", async (Guid documentId, Guid versionId, DocumentService documentService, UserService userService, HttpContext context) =>
        {
            var user = await AuthHelper.GetCurrentUserAsync(context, userService);
            if (user is null)
                return Results.Problem(detail: "Not authenticated", statusCode: 401);

            var document = await documentService.GetByIdAsync(documentId);
            if (document is null)
                return Results.Problem(detail: "Document not found", statusCode: 404);

            var isOwner = document.OwnerId == user.Id;
            var isEditor = document.Collaborators.Any(c => c.UserId == user.Id && c.Role == "editor");
            if (!isOwner && !isEditor)
                return Results.Problem(detail: "Forbidden", statusCode: 403);

            var version = await documentService.GetVersionByIdAsync(versionId);
            if (version is null || version.DocumentId != documentId)
                return Results.Problem(detail: "Version not found", statusCode: 404);

            if (version.YjsSnapshot is null || version.YjsSnapshot.Length == 0)
                return Results.Problem(detail: "Version snapshot is empty, nothing to restore", statusCode: 422);

            // Acquire a lifetime token on the room so it cannot be disposed under us while we
            // hold SaveLock — SaveLock now lives on RoomState. EnsureRoomAsync creates the room
            // if no clients are connected (transient room for the duration of restore).
            var room = await YjsRelayMiddleware.EnsureRoomAsync(
                documentId,
                () => documentService.GetStateAsync(documentId));

            try
            {
                // Hold SaveLock across the ENTIRE restore (auto-snapshot + reconcile + evict).
                // Holding it only over reconcile+evict left a window where a file uploaded
                // between auto-snapshot and reconcile was missing from the auto-snapshot AND
                // soft-deleted by reconcile (the user's upload silently vanished). With SaveLock
                // held earlier the auto-snapshot and reconcile see a consistent room view.
                //
                // WithYDocAsync calls (concurrent REST file writes) also serialize because they
                // acquire a lifetime token on this same room and their mutations go through the
                // room's _docLock — which our reconcile/replace also uses below via
                // EvictRoom -> ReplaceStateAsync.
                await room.SaveLock.WaitAsync();
                try
                {
                    // Auto-snapshot the current state so the restore is reversible. Inside
                    // SaveLock so the snapshot and the subsequent reconcile see the same state.
                    // CreateVersionAsync flushes the in-memory Y.Doc to DB first so the snapshot
                    // is fresh.
                    await documentService.CreateVersionAsync(documentId, user.Id,
                        "Before restore", $"Auto-saved before restoring to \"{version.Label ?? version.Id.ToString()[..8]}\"");

                    // Gate live WebSocket edits for the rest of the restore. SaveLock alone
                    // doesn't block ApplyUpdateAsync (it only takes _docLock), so without this
                    // an edit landing between the currentState export and EvictRoom would be
                    // lost server-side. Clients keep their local edit and re-push via the
                    // sync-step-1 handshake after eviction.
                    room.BeginRestore();
                    try
                    {
                        // Compute the forward-delta state (D2) from the CURRENT in-memory state.
                        // D2 = currentState + a forward "revert" edit that sets each branch to its
                        // snapshot text. Done before reconcile so a corrupted snapshot fails early
                        // with nothing changed. SaveLock is held + IsRestoring is set, so
                        // currentState is stable for the duration.
                        var currentState = await room.ExportStateAsync();
                    byte[] d2;
                    try
                    {
                        d2 = await documentService.BuildForwardDeltaForRestoreAsync(documentId, version, currentState);
                    }
                    catch (CorruptedYjsStateException)
                    {
                        return Results.Problem(detail: "Version snapshot is corrupted and cannot be restored.", statusCode: 422);
                    }

                    // Reconcile FIRST inside a DB transaction. If it throws, no clients have been
                    // kicked and the user-visible error matches the actual state (nothing changed).
                    try
                    {
                        await documentService.ReconcileFilesAndOverwriteStateAsync(documentId, version, d2);
                    }
                    catch (Exception ex)
                    {
                        Console.WriteLine($"[texmex] Version restore reconcile failed for doc {documentId}: {ex.Message}");
                        return Results.Problem(detail: "Version restore failed; the document was not changed.", statusCode: 500);
                    }

                    // Reconcile committed. Evict so connected clients reconnect against the
                    // restored DB state. Pass D2 so any stale in-memory references (e.g.,
                    // persistence service mid-iteration) export the forward-delta state rather
                    // than the raw snapshot. EvictRoom does NOT dispose the room — disposal
                    // happens when the last lifetime token (including ours, released below) is
                    // released.
                    await YjsRelayMiddleware.EvictRoom(documentId, d2);
                    }
                    finally
                    {
                        // Always clear the restoring gate, including on the early-return paths
                        // above (corrupted-snapshot 422, reconcile-failure 500). EvictRoom has
                        // already kicked any connected clients so no edits are landing right now,
                        // but a brand-new connect taken after EvictRoom + before EndRestore would
                        // otherwise have its initial sync drop. Clearing inside SaveLock is also
                        // fine; the next client connect re-syncs from scratch.
                        room.EndRestore();
                    }
                }
                finally
                {
                    room.SaveLock.Release();
                }
            }
            finally
            {
                // Release our lifetime token. If we were the last holder (no other clients), this
                // triggers disposal. The room's IsDirty was cleared by ReplaceStateAsync, so no
                // stale state is re-saved over the restore.
                await YjsRelayMiddleware.ReleaseRoomAsync(
                    documentId, room,
                    state => documentService.SaveStateAsync(documentId, state));
            }

            return Results.Ok(new { message = "Version restored" });
        }).WithTags("Versions")
          .WithSummary("Restores a document to a previous version. Disconnects all active editors.")
          .Produces(StatusCodes.Status200OK)
          .Produces(StatusCodes.Status401Unauthorized)
          .Produces(StatusCodes.Status403Forbidden)
          .Produces(StatusCodes.Status404NotFound)
          .Produces(StatusCodes.Status422UnprocessableEntity);

        // DELETE /api/documents/{documentId}/versions/{versionId} — owner only
        group.MapDelete("/{versionId:guid}", async (Guid documentId, Guid versionId, DocumentService documentService, UserService userService, HttpContext context) =>
        {
            var user = await AuthHelper.GetCurrentUserAsync(context, userService);
            if (user is null)
                return Results.Problem(detail: "Not authenticated", statusCode: 401);

            var document = await documentService.GetByIdAsync(documentId);
            if (document is null)
                return Results.Problem(detail: "Document not found", statusCode: 404);

            if (document.OwnerId != user.Id)
                return Results.Problem(detail: "Forbidden", statusCode: 403);

            var version = await documentService.GetVersionByIdAsync(versionId);
            if (version is null || version.DocumentId != documentId)
                return Results.Problem(detail: "Version not found", statusCode: 404);

            await documentService.DeleteVersionAsync(version);

            return Results.Ok(new { message = "Version deleted" });
        }).WithTags("Versions")
          .WithSummary("Deletes a version.")
          .Produces(StatusCodes.Status200OK)
          .Produces(StatusCodes.Status401Unauthorized)
          .Produces(StatusCodes.Status403Forbidden)
          .Produces(StatusCodes.Status404NotFound);
    }
}
