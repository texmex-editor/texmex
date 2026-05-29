using TexMex.Api.Auth;
using TexMex.Api.Models;
using TexMex.Data.Services;
using TexMex.WebSockets;

namespace TexMex.Api.Documents;

// File management. Virtual folder paths are encoded in the filename (e.g. "images/photo.png").
// Files are classified at upload time as collaborative (text content lives in the Y.Doc as a Y.Text)
// or static (binary content lives in DocumentFile.Data). After every write, a file_event WS message
// is broadcast to connected clients so they can refresh their file list without polling.
public static class FileEndpoints
{
    private const int MaxFileSizeBytes = 10 * 1024 * 1024; // 10 MB

    public static void MapFileEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/documents/{id:guid}/files");

        // Upload a file (replaces if a file with the same name already exists)
        group.MapPost("/", async (Guid id, IFormFile file, DocumentService documentService, UserService userService, HttpContext context) =>
        {
            var user = await AuthHelper.GetCurrentUserAsync(context, userService);
            if (user is null)
                return Results.Problem(detail: "Not authenticated", statusCode: 401);

            var document = await documentService.GetByIdAsync(id);
            if (document is null)
                return Results.Problem(detail: "Document not found", statusCode: 404);

            var access = await AuthHelper.ResolveAccessAsync(context, document, userService, documentService);
            if (access is null)
                return Results.Problem(detail: "Not authenticated", statusCode: 401);
            if (access.Role is null || (access.Role != "owner" && access.Role != "editor"))
                return Results.Problem(detail: "Forbidden", statusCode: 403);

            if (file.Length > MaxFileSizeBytes)
                return Results.Problem(detail: $"File too large (max {MaxFileSizeBytes / 1024 / 1024} MB)", statusCode: 413);

            // Use the "filename" form field if provided, otherwise fall back to the uploaded file's name
            var filename = context.Request.Form["filename"].FirstOrDefault()
                ?? file.FileName;

            var validationError = DocumentService.ValidateFilename(filename, document.Entrypoint);
            if (validationError is not null)
                return Results.Problem(detail: validationError, statusCode: 400);

            byte[] data;
            if (file.Length == 0)
            {
                // Allow empty file creation — useful for "new file" UX where the user picks a name
                // before typing any content. Only allowed for collaborative file types.
                if (!FileTypePolicy.IsCollaborativeFilename(filename))
                    return Results.Problem(detail: "Empty static files are not allowed", statusCode: 400);
                data = Array.Empty<byte>();
            }
            else
            {
                using var ms = new MemoryStream();
                await file.CopyToAsync(ms);
                data = ms.ToArray();
            }

            DocumentService.FileUpsertResult result;
            try
            {
                result = await documentService.CreateOrReplaceFileAsync(
                    id, filename, file.ContentType ?? "application/octet-stream", data, user.Id);
            }
            catch (InvalidContentException ex)
            {
                return Results.Problem(detail: ex.Message, statusCode: 415);
            }
            catch (Microsoft.EntityFrameworkCore.DbUpdateException ex)
                when (ex.InnerException is Npgsql.PostgresException pg && pg.SqlState == "23505")
            {
                // Concurrent upload with the same filename hit the partial unique index after we
                // passed the existence check (rare race). The client can retry; the second attempt
                // will see the row as existing and follow the replace path.
                return Results.Problem(detail: "A concurrent upload for that filename is in progress. Retry.", statusCode: 409);
            }
            var created = result.File;

            // Broadcast file_event so connected clients update their file list without polling.
            // Distinguish "created" (new file) from "replaced" (existing file's content overwritten).
            // Replace is destructive for collaborative files — any clients editing get their Y.Text wiped.
            var createdResponse = FileResponse.From(created);
            await YjsRelayMiddleware.BroadcastFileEventAsync(id, new
            {
                type = "file_event",
                action = result.WasReplaced ? "replaced" : "created",
                fileId = createdResponse.Id,
                filename = createdResponse.Filename,
                contentType = createdResponse.ContentType,
                isCollaborative = createdResponse.IsCollaborative,
                category = createdResponse.Category,
                uploadedByDisplayName = createdResponse.UploadedByDisplayName,
            });

            return Results.Created($"/api/documents/{id}/files/{created.Id}", createdResponse);
        }).WithTags("Files")
          .WithSummary("Uploads a file to a document (or replaces an existing file with the same name).")
          .Accepts<IFormFile>("multipart/form-data")
          .Produces<FileResponse>(StatusCodes.Status201Created)
          .Produces(StatusCodes.Status400BadRequest)
          .Produces(StatusCodes.Status401Unauthorized)
          .Produces(StatusCodes.Status403Forbidden)
          .Produces(StatusCodes.Status404NotFound)
          .Produces(StatusCodes.Status413PayloadTooLarge)
          .Produces(StatusCodes.Status415UnsupportedMediaType)
          .DisableAntiforgery();

        // Cross-type replace: soft-deletes an existing file and creates a new one in one atomic
        // operation. Used when the user wants to swap a collaborative file for a static one (or
        // vice versa) — the regular upload endpoint can't do this because filename → type is a
        // function of extension, so changing the type requires a new file with a new file_id.
        //
        // Why an explicit endpoint rather than rename + reupload: the rename endpoint blocks
        // cross-type renames (would orphan Y.Text branches / mismatch storage), and a two-step
        // delete + reupload leaves a window where the file is gone, and isn't atomic in WebSocket
        // event delivery — concurrent clients would see "deleted" then "created" with a flash of
        // file-list churn between. This endpoint emits a single `replaced_cross_type` event so
        // clients can render the transition cleanly.
        group.MapPost("/{oldFileId:guid}/replace", async (Guid id, Guid oldFileId, IFormFile file,
            DocumentService documentService, UserService userService, HttpContext context) =>
        {
            var user = await AuthHelper.GetCurrentUserAsync(context, userService);
            if (user is null)
                return Results.Problem(detail: "Not authenticated", statusCode: 401);

            var document = await documentService.GetByIdAsync(id);
            if (document is null)
                return Results.Problem(detail: "Document not found", statusCode: 404);

            var access = await AuthHelper.ResolveAccessAsync(context, document, userService, documentService);
            if (access is null)
                return Results.Problem(detail: "Not authenticated", statusCode: 401);
            if (access.Role is null || (access.Role != "owner" && access.Role != "editor"))
                return Results.Problem(detail: "Forbidden", statusCode: 403);

            if (file.Length > MaxFileSizeBytes)
                return Results.Problem(detail: $"File too large (max {MaxFileSizeBytes / 1024 / 1024} MB)", statusCode: 413);

            var oldFile = await documentService.GetFileWithDataAsync(oldFileId, id);
            if (oldFile is null)
                return Results.Problem(detail: "File to replace not found", statusCode: 404);

            // Refuse to replace the entrypoint — would orphan Document.Entrypoint and break
            // compile / save-as-template. Same guard as DELETE — user must change the entrypoint
            // via PUT /api/documents/{id} first if they truly want to retire the original .tex.
            if (await documentService.IsEntrypointAsync(oldFile))
                return Results.Problem(detail: "Cannot replace the entrypoint file. Change the document's entrypoint first.", statusCode: 409);

            var newFilename = context.Request.Form["filename"].FirstOrDefault() ?? file.FileName;

            var validationError = DocumentService.ValidateFilename(newFilename, document.Entrypoint);
            if (validationError is not null)
                return Results.Problem(detail: validationError, statusCode: 400);

            // Reject if the new filename collides with a DIFFERENT active file (the file we're
            // replacing is allowed to share the same name post-replace because it'll be soft-deleted).
            var activeFiles = await documentService.GetFilesAsync(id);
            if (activeFiles.Any(f => f.Filename == newFilename && f.Id != oldFileId))
                return Results.Problem(detail: "A different file already has that filename", statusCode: 409);

            byte[] data;
            if (file.Length == 0)
            {
                if (!FileTypePolicy.IsCollaborativeFilename(newFilename))
                    return Results.Problem(detail: "Empty static files are not allowed", statusCode: 400);
                data = Array.Empty<byte>();
            }
            else
            {
                using var ms = new MemoryStream();
                await file.CopyToAsync(ms);
                data = ms.ToArray();
            }

            // Validate the upload BEFORE soft-deleting — we don't want to wipe the old file
            // just to discover the new one is rejected. ContentValidator is also called inside
            // CreateOrReplaceFileAsync, but the eager call here lets us 415 without side effects.
            try
            {
                ContentValidator.Validate(newFilename, data);
            }
            catch (InvalidContentException ex)
            {
                return Results.Problem(detail: ex.Message, statusCode: 415);
            }

            // Soft-delete the old file first. For collab files this clears the Y.Text branch
            // and frees its filename in the partial unique index for the create that follows.
            await documentService.DeleteFileAsync(oldFile);

            DocumentService.FileUpsertResult result;
            try
            {
                result = await documentService.CreateOrReplaceFileAsync(
                    id, newFilename, file.ContentType ?? "application/octet-stream", data, user.Id);
            }
            catch (Microsoft.EntityFrameworkCore.DbUpdateException ex)
                when (ex.InnerException is Npgsql.PostgresException pg && pg.SqlState == "23505")
            {
                return Results.Problem(detail: "A concurrent upload for that filename is in progress. Retry.", statusCode: 409);
            }
            var created = result.File;

            // Single atomic broadcast with both fileIds so the frontend can render the swap
            // without a flicker between "old gone" and "new arrived". See MULTI_FILE_COLLAB.md
            // for the editor-side lock-and-banner UX pattern this enables.
            var createdResponse = FileResponse.From(created);
            await YjsRelayMiddleware.BroadcastFileEventAsync(id, new
            {
                type = "file_event",
                action = "replaced_cross_type",
                oldFileId = oldFile.Id,
                oldIsCollaborative = oldFile.IsCollaborative,
                oldCategory = FileTypePolicy.Classify(oldFile.Filename)?.ToString().ToSnakeCase() ?? "unknown",
                fileId = createdResponse.Id,
                filename = createdResponse.Filename,
                contentType = createdResponse.ContentType,
                isCollaborative = createdResponse.IsCollaborative,
                category = createdResponse.Category,
                uploadedByDisplayName = createdResponse.UploadedByDisplayName,
            });

            return Results.Created($"/api/documents/{id}/files/{created.Id}", createdResponse);
        }).WithTags("Files")
          .WithSummary("Replaces an existing file with a new upload, atomically. Used to swap between collaborative and static file types — the new file gets a new file_id and the old one is soft-deleted.")
          .Accepts<IFormFile>("multipart/form-data")
          .Produces<FileResponse>(StatusCodes.Status201Created)
          .Produces(StatusCodes.Status400BadRequest)
          .Produces(StatusCodes.Status401Unauthorized)
          .Produces(StatusCodes.Status403Forbidden)
          .Produces(StatusCodes.Status404NotFound)
          .Produces(StatusCodes.Status409Conflict)
          .Produces(StatusCodes.Status413PayloadTooLarge)
          .Produces(StatusCodes.Status415UnsupportedMediaType)
          .DisableAntiforgery();

        // List all files in a document (metadata only, no binary data).
        // Soft-deleted rows are excluded automatically by the global query filter.
        group.MapGet("/", async (Guid id, DocumentService documentService, UserService userService, HttpContext context) =>
        {
            var document = await documentService.GetByIdAsync(id);
            if (document is null)
                return Results.Problem(detail: "Document not found", statusCode: 404);

            var access = await AuthHelper.ResolveAccessAsync(context, document, userService, documentService);
            if (access is null)
                return Results.Problem(detail: "Not authenticated", statusCode: 401);
            if (access.Role is null)
                return Results.Problem(detail: "Forbidden", statusCode: 403);

            var files = await documentService.GetFilesAsync(id);

            // Live-compute sizes for collab files when the Y.Doc room is hot.
            // Cold rooms aren't rehydrated — those collab files get null size
            // (FE renders "—"). One Y.Doc read transaction covers all files.
            var liveSizes = await documentService.TryReadCollabSizesAsync(id, files);
            var response = files.Select(f =>
                f.IsCollaborative && liveSizes.TryGetValue(f.Id, out var s)
                    ? FileResponse.From(f, s)
                    : FileResponse.From(f));

            return Results.Ok(response);
        }).WithTags("Files")
          .WithSummary("Lists all files in a document (metadata only, no binary data).")
          .Produces<IEnumerable<FileResponse>>(StatusCodes.Status200OK)
          .Produces(StatusCodes.Status401Unauthorized)
          .Produces(StatusCodes.Status403Forbidden)
          .Produces(StatusCodes.Status404NotFound);

        // Download a file. For collaborative files, content is extracted live from the Y.Doc.
        // For static files, content comes from DocumentFile.Data.
        group.MapGet("/{fileId:guid}", async (Guid id, Guid fileId, DocumentService documentService, UserService userService, HttpContext context) =>
        {
            var document = await documentService.GetByIdAsync(id);
            if (document is null)
                return Results.Problem(detail: "Document not found", statusCode: 404);

            var access = await AuthHelper.ResolveAccessAsync(context, document, userService, documentService);
            if (access is null)
                return Results.Problem(detail: "Not authenticated", statusCode: 401);
            if (access.Role is null)
                return Results.Problem(detail: "Forbidden", statusCode: 403);

            var file = await documentService.GetFileWithDataAsync(fileId, id);
            if (file is null)
                return Results.Problem(detail: "File not found", statusCode: 404);

            // Strip the folder path from the Content-Disposition filename so a
            // download of "src/main.tex" lands in the user's Downloads as just
            // "main.tex" rather than the mangled "src_main.tex" Firefox would
            // produce or the silently-truncated "main.tex" Chrome already does.
            // The DB row keeps its full virtual path; only the disposition is
            // sanitised.
            var lastSlash = file.Filename.LastIndexOf('/');
            var downloadName = lastSlash >= 0 ? file.Filename[(lastSlash + 1)..] : file.Filename;

            if (file.IsCollaborative)
            {
                // Collab content lives in the Y.Doc; extract live (will reflect unsaved edits if a room is loaded).
                var text = await documentService.GetCollaborativeContentAsync(id, fileId);
                var bytes = System.Text.Encoding.UTF8.GetBytes(text);
                return Results.File(bytes, file.ContentType, downloadName);
            }

            // Static file — Data holds the bytes.
            return Results.File(file.Data ?? Array.Empty<byte>(), file.ContentType, downloadName);
        }).WithTags("Files")
          .WithSummary("Downloads a file by ID.")
          .Produces<IResult>(StatusCodes.Status200OK)
          .Produces(StatusCodes.Status401Unauthorized)
          .Produces(StatusCodes.Status403Forbidden)
          .Produces(StatusCodes.Status404NotFound);

        // Duplicate a file. Creates a new file with "<base> copy[ N].<ext>" naming, snapshotting
        // the source's current content (for collab files: a moment-in-time Y.Text extract, not a
        // live alias). Broadcasts a regular "created" file_event so connected clients refresh.
        group.MapPost("/{fileId:guid}/duplicate", async (Guid id, Guid fileId,
            DocumentService documentService, UserService userService, HttpContext context) =>
        {
            var user = await AuthHelper.GetCurrentUserAsync(context, userService);
            if (user is null)
                return Results.Problem(detail: "Not authenticated", statusCode: 401);

            var document = await documentService.GetByIdAsync(id);
            if (document is null)
                return Results.Problem(detail: "Document not found", statusCode: 404);

            var access = await AuthHelper.ResolveAccessAsync(context, document, userService, documentService);
            if (access is null)
                return Results.Problem(detail: "Not authenticated", statusCode: 401);
            if (access.Role is null || (access.Role != "owner" && access.Role != "editor"))
                return Results.Problem(detail: "Forbidden", statusCode: 403);

            var source = await documentService.GetFileWithDataAsync(fileId, id);
            if (source is null)
                return Results.Problem(detail: "File not found", statusCode: 404);

            var duplicate = await documentService.DuplicateFileAsync(source, user.Id);
            var response = FileResponse.From(duplicate);

            await YjsRelayMiddleware.BroadcastFileEventAsync(id, new
            {
                type = "file_event",
                action = "created",
                fileId = response.Id,
                filename = response.Filename,
                contentType = response.ContentType,
                isCollaborative = response.IsCollaborative,
                category = response.Category,
                uploadedByDisplayName = response.UploadedByDisplayName,
            });

            return Results.Created($"/api/documents/{id}/files/{duplicate.Id}", response);
        }).WithTags("Files")
          .WithSummary("Duplicates a file with a fresh '<name> copy.<ext>' filename.")
          .Produces<FileResponse>(StatusCodes.Status201Created)
          .Produces(StatusCodes.Status401Unauthorized)
          .Produces(StatusCodes.Status403Forbidden)
          .Produces(StatusCodes.Status404NotFound);

        // Rename or move a file by changing its virtual path. Y.Text key is the file_id GUID,
        // so renames are pure metadata operations — no Y.Doc mutation needed.
        group.MapPatch("/{fileId:guid}", async (Guid id, Guid fileId, RenameFileRequest request,
            DocumentService documentService, UserService userService, HttpContext context) =>
        {
            var user = await AuthHelper.GetCurrentUserAsync(context, userService);
            if (user is null)
                return Results.Problem(detail: "Not authenticated", statusCode: 401);

            var document = await documentService.GetByIdAsync(id);
            if (document is null)
                return Results.Problem(detail: "Document not found", statusCode: 404);

            var access = await AuthHelper.ResolveAccessAsync(context, document, userService, documentService);
            if (access is null)
                return Results.Problem(detail: "Not authenticated", statusCode: 401);
            if (access.Role is null || (access.Role != "owner" && access.Role != "editor"))
                return Results.Problem(detail: "Forbidden", statusCode: 403);

            var file = await documentService.GetFileWithDataAsync(fileId, id);
            if (file is null)
                return Results.Problem(detail: "File not found", statusCode: 404);

            var validationError = DocumentService.ValidateFilename(request.NewFilename, document.Entrypoint);
            if (validationError is not null)
                return Results.Problem(detail: validationError, statusCode: 400);

            DocumentService.RenameResult renameResult;
            try
            {
                renameResult = await documentService.RenameFileAsync(file, request.NewFilename);
            }
            catch (Microsoft.EntityFrameworkCore.DbUpdateException ex)
                when (ex.InnerException is Npgsql.PostgresException pg && pg.SqlState == "23505")
            {
                // Two concurrent renames raced past the in-memory uniqueness check
                // and both passed it; the second SaveChangesAsync hit the partial
                // unique index on (document_id, filename) WHERE deleted_at IS NULL.
                // Without this catch the endpoint returned 500; now it mirrors the
                // upload + folder-rename endpoints by translating to 409.
                return Results.Problem(detail: "A file with that name already exists. Refresh and retry.", statusCode: 409);
            }
            if (renameResult == DocumentService.RenameResult.Conflict)
                return Results.Problem(detail: "A file with that name already exists", statusCode: 409);
            if (renameResult == DocumentService.RenameResult.CategoryMismatch)
                return Results.Problem(detail: "Cannot rename across file categories (collaborative/text/image/pdf/font). Use the cross-type replace endpoint instead.", statusCode: 400);

            // Category never changes on rename (cross-category renames are rejected above),
            // but include it in the payload for shape-consistency with other file_event types
            // so the frontend can drive its rendering off a single field.
            var renamedResponse = FileResponse.From(file);
            await YjsRelayMiddleware.BroadcastFileEventAsync(id, new
            {
                type = "file_event",
                action = "renamed",
                fileId = renamedResponse.Id,
                filename = renamedResponse.Filename,
                category = renamedResponse.Category,
            });

            return Results.Ok(renamedResponse);
        }).WithTags("Files")
          .WithSummary("Renames or moves a file (changes its virtual path).")
          .Produces<FileResponse>(StatusCodes.Status200OK)
          .Produces(StatusCodes.Status400BadRequest)
          .Produces(StatusCodes.Status401Unauthorized)
          .Produces(StatusCodes.Status403Forbidden)
          .Produces(StatusCodes.Status404NotFound)
          .Produces(StatusCodes.Status409Conflict);

        // Soft-delete a file. The DocumentFile row stays in the DB with deleted_at set so that
        // version restore can revive it. For collaborative files, the Y.Text content is cleared
        // in the Y.Doc (cosmetic — the row's invisibility is what actually hides the file).
        group.MapDelete("/{fileId:guid}", async (Guid id, Guid fileId, DocumentService documentService, UserService userService, HttpContext context) =>
        {
            var user = await AuthHelper.GetCurrentUserAsync(context, userService);
            if (user is null)
                return Results.Problem(detail: "Not authenticated", statusCode: 401);

            var document = await documentService.GetByIdAsync(id);
            if (document is null)
                return Results.Problem(detail: "Document not found", statusCode: 404);

            var access = await AuthHelper.ResolveAccessAsync(context, document, userService, documentService);
            if (access is null)
                return Results.Problem(detail: "Not authenticated", statusCode: 401);
            if (access.Role is null || (access.Role != "owner" && access.Role != "editor"))
                return Results.Problem(detail: "Forbidden", statusCode: 403);

            var file = await documentService.GetFileWithDataAsync(fileId, id);
            if (file is null)
                return Results.Problem(detail: "File not found", statusCode: 404);

            // Refuse to delete the entrypoint — it would orphan Document.Entrypoint and break
            // compile / save-as-template / version text reads with no UI path to recover.
            if (await documentService.IsEntrypointAsync(file))
                return Results.Problem(detail: "Cannot delete the entrypoint file. Change the document's entrypoint first.", statusCode: 409);

            await documentService.DeleteFileAsync(file);

            await YjsRelayMiddleware.BroadcastFileEventAsync(id, new
            {
                type = "file_event",
                action = "deleted",
                fileId = file.Id,
            });

            return Results.Ok(new { message = "File deleted" });
        }).WithTags("Files")
          .WithSummary("Deletes a file from a document (soft delete).")
          .Produces(StatusCodes.Status200OK)
          .Produces(StatusCodes.Status401Unauthorized)
          .Produces(StatusCodes.Status403Forbidden)
          .Produces(StatusCodes.Status404NotFound);
    }
}
