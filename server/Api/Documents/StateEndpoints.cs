using TexMex.Api.Auth;
using TexMex.Data.Services;

namespace TexMex.Api.Documents;

/// Yjs state load/save — the editor calls these when opening a document and when persisting changes.
/// The state is raw binary (application/octet-stream), not JSON.
public static class StateEndpoints
{
    public static void MapStateEndpoints(this WebApplication app)
    {
        // GET /api/documents/{id}/state — load the Yjs binary state for the editor
        app.MapGet("/api/documents/{id:guid}/state", async (Guid id, DocumentService documentService, UserService userService, HttpContext context) =>
        {
            var document = await documentService.GetByIdAsync(id);
            if (document is null)
                return Results.Problem(detail: "Document not found", statusCode: 404);

            var access = await AuthHelper.ResolveAccessAsync(context, document, userService, documentService);
            if (access is null)
                return Results.Problem(detail: "Not authenticated", statusCode: 401);
            if (access.Role is null)
                return Results.Problem(detail: "Forbidden", statusCode: 403);

            var state = await documentService.GetStateAsync(id);

            // No state yet — doc was just created, editor starts empty
            if (state is null || state.Length == 0)
                return Results.NoContent();

            return Results.File(state, "application/octet-stream");
        }).WithTags("Document State")
          .WithSummary("Gets the Yjs binary state for a document.")
          .Produces<IResult>(StatusCodes.Status200OK, "application/octet-stream")
          .Produces(StatusCodes.Status204NoContent)
          .Produces(StatusCodes.Status401Unauthorized)
          .Produces(StatusCodes.Status403Forbidden)
          .Produces(StatusCodes.Status404NotFound);

        // PUT /api/documents/{id}/state — save the Yjs binary state from the editor
        app.MapPut("/api/documents/{id:guid}/state", async (Guid id, DocumentService documentService, UserService userService, HttpContext context) =>
        {
            var document = await documentService.GetByIdAsync(id);
            if (document is null)
                return Results.Problem(detail: "Document not found", statusCode: 404);

            var access = await AuthHelper.ResolveAccessAsync(context, document, userService, documentService);
            if (access is null)
                return Results.Problem(detail: "Not authenticated", statusCode: 401);
            if (access.Role is null || (access.Role != "owner" && access.Role != "editor"))
                return Results.Problem(detail: "Forbidden", statusCode: 403);

            const int maxBodySize = 5 * 1024 * 1024; // 5 MB

            // Read the raw binary body — this is a Yjs update, not JSON
            // Enforce size limit to prevent OOM from huge uploads
            using var ms = new MemoryStream();
            var buffer = new byte[64 * 1024];
            int totalRead = 0, bytesRead;
            while ((bytesRead = await context.Request.Body.ReadAsync(buffer)) > 0)
            {
                totalRead += bytesRead;
                if (totalRead > maxBodySize)
                    return Results.Problem(detail: "State too large (max 5 MB)", statusCode: 413);
                ms.Write(buffer, 0, bytesRead);
            }
            var state = ms.ToArray();

            if (state.Length == 0)
                return Results.Problem(detail: "State body is empty", statusCode: 400);

            await documentService.SaveStateAsync(id, state);

            return Results.Ok(new { message = "State saved" });
        }).WithTags("Document State")
          .WithSummary("Saves the Yjs binary state for a document.")
          .Produces(StatusCodes.Status200OK)
          .Produces(StatusCodes.Status400BadRequest)
          .Produces(StatusCodes.Status401Unauthorized)
          .Produces(StatusCodes.Status403Forbidden)
          .Produces(StatusCodes.Status404NotFound)
          .Produces(StatusCodes.Status413PayloadTooLarge);
    }
}
