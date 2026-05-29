using System.ComponentModel.DataAnnotations;
using TexMex.Api.Auth;
using TexMex.Api.Models;
using TexMex.Data.Services;
using TexMex.WebSockets;

namespace TexMex.Api.Documents;

// Virtual folder operations. Folders aren't stored as DB rows — they exist only as filename
// prefixes on DocumentFile (e.g. "src/main.tex" implies a "src/" folder). These endpoints
// provide atomic bulk operations across all files under a prefix, replacing the FE-side loop
// of per-file PATCHes that could leave the document in a half-renamed state on mid-loop conflict.
public static class FolderEndpoints
{
    public static void MapFolderEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/documents/{id:guid}/folders");

        // POST /folders/rename — move every file under `from` to `to` in one transaction.
        // Pre-validates no collision; returns 409 with the conflicting target path on failure.
        group.MapPost("/rename", async (Guid id, FolderRenameRequest request,
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

            var fromPrefix = NormalizeFolderPrefix(request.From);
            var toPrefix = NormalizeFolderPrefix(request.To);

            if (string.IsNullOrEmpty(fromPrefix))
                return Results.Problem(detail: "Source folder cannot be empty.", statusCode: 400);
            if (fromPrefix == toPrefix)
                return Results.Problem(detail: "Source and destination folder are the same.", statusCode: 400);

            // Reject moving a folder INTO itself or one of its descendants (would create a path
            // like "a/a/x.tex" with the rule, but more importantly is almost always a UI mistake).
            if (toPrefix.StartsWith(fromPrefix))
                return Results.Problem(detail: "Cannot move a folder into itself.", statusCode: 400);

            DocumentService.FolderRenameResult result;
            try
            {
                result = await documentService.RenameFolderAsync(id, fromPrefix, toPrefix);
            }
            catch (Microsoft.EntityFrameworkCore.DbUpdateException ex)
                when (ex.InnerException is Npgsql.PostgresException pg && pg.SqlState == "23505")
            {
                // Two concurrent folder renames raced past the in-memory collision pre-check and
                // both passed it; the second SaveChanges hit the partial unique index on
                // (document_id, filename). Treat as a conflict (client can retry to see updated
                // state).
                return Results.Problem(detail: "A concurrent folder rename hit a conflict. Refresh and retry.", statusCode: 409);
            }
            if (!result.Success)
                return Results.Problem(
                    detail: $"A file named '{result.ConflictingPath}' already exists. Pick a different destination.",
                    statusCode: 409);

            // Broadcast a 'renamed' event per file so connected clients update their file lists.
            // Per-file events keep the FE's existing file_event handler simple — no new shape.
            foreach (var file in result.Renamed)
            {
                var response = FileResponse.From(file);
                await YjsRelayMiddleware.BroadcastFileEventAsync(id, new
                {
                    type = "file_event",
                    action = "renamed",
                    fileId = response.Id,
                    filename = response.Filename,
                    category = response.Category,
                });
            }

            return Results.Ok(new { renamedCount = result.Renamed.Count });
        }).WithTags("Folders")
          .WithSummary("Atomically renames/moves a virtual folder (every file under the prefix).")
          .Produces(StatusCodes.Status200OK)
          .Produces(StatusCodes.Status400BadRequest)
          .Produces(StatusCodes.Status401Unauthorized)
          .Produces(StatusCodes.Status403Forbidden)
          .Produces(StatusCodes.Status404NotFound)
          .Produces(StatusCodes.Status409Conflict);

        // POST /folders/delete — soft-delete every file under the prefix.
        // Refuses if the entrypoint lives inside the folder (mirrors per-file delete protection).
        group.MapPost("/delete", async (Guid id, FolderDeleteRequest request,
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

            var prefix = NormalizeFolderPrefix(request.Path);
            if (string.IsNullOrEmpty(prefix))
                return Results.Problem(detail: "Folder path cannot be empty.", statusCode: 400);

            var result = await documentService.DeleteFolderAsync(id, prefix);
            if (!result.Success)
                return Results.Problem(detail: result.Reason ?? "Folder delete refused.", statusCode: 409);

            foreach (var file in result.Deleted)
            {
                await YjsRelayMiddleware.BroadcastFileEventAsync(id, new
                {
                    type = "file_event",
                    action = "deleted",
                    fileId = file.Id,
                });
            }

            return Results.Ok(new { deletedCount = result.Deleted.Count });
        }).WithTags("Folders")
          .WithSummary("Soft-deletes every file under a virtual folder prefix.")
          .Produces(StatusCodes.Status200OK)
          .Produces(StatusCodes.Status400BadRequest)
          .Produces(StatusCodes.Status401Unauthorized)
          .Produces(StatusCodes.Status403Forbidden)
          .Produces(StatusCodes.Status404NotFound)
          .Produces(StatusCodes.Status409Conflict);
    }

    // Normalises a folder path to a trailing-slash prefix. Accepts both "src" and "src/" as
    // input; empty/whitespace becomes the root (""). Multiple trailing slashes collapse to one.
    // An empty *output* prefix is meaningful for the move-to-root case in rename (use "" as `to`
    // to flatten a folder's contents into the document root) — callers that don't want that
    // (e.g. /delete) should reject the empty result themselves.
    private static string NormalizeFolderPrefix(string? path)
    {
        if (string.IsNullOrWhiteSpace(path)) return "";
        var trimmed = path.Trim().TrimEnd('/');
        return trimmed.Length == 0 ? "" : trimmed + "/";
    }
}
