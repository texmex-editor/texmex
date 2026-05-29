using TexMex.Api.Auth;
using TexMex.Api.Models;
using TexMex.Data.Schemas;
using TexMex.Data.Services;
using TexMex.WebSockets;

namespace TexMex.Api.Documents;

/// Document CRUD. All endpoints require a valid session cookie.
/// Access: create/list = any user, get = owner or collaborator, update = owner or editor, delete = owner only.
public static class DocumentEndpoints
{
    public static void MapDocumentEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/documents");

        // Create a new document (defaults to "Untitled" + main.tex)
        group.MapPost("/", async (CreateDocumentRequest request, DocumentService documentService, TemplateService templateService, UserService userService, HttpContext context) =>
        {
            var user = await AuthHelper.GetCurrentUserAsync(context, userService);
            if (user is null)
                return Results.Problem(detail: "Not authenticated", statusCode: 401);

            Document document;
            if (request.TemplateId is Guid templateId)
            {
                var template = await templateService.GetByIdAsync(templateId);
                if (template is null)
                    return Results.Problem(detail: "Template not found", statusCode: 404);

                // Visibility check — same rules as the templates listing endpoint
                var isVisible = template.OwnerId is null
                    || template.OwnerId == user.Id
                    || template.IsPublic;
                if (!isVisible)
                    return Results.Problem(detail: "Template not found", statusCode: 404);

                document = await documentService.CreateFromTemplateAsync(user.Id, request.Title, template);
            }
            else
            {
                document = await documentService.CreateAsync(user.Id, request.Title);
            }

            return Results.Created($"/api/documents/{document.Id}", new DocumentResponse(
                document.Id,
                document.Title,
                document.Owner.DisplayName,
                document.Entrypoint,
                document.CreatedAt,
                document.UpdatedAt,
                "owner"
            ));
        }).WithTags("Documents")
          .WithSummary("Creates a new document, optionally seeded from a template.")
          .Produces<DocumentResponse>(StatusCodes.Status201Created)
          .Produces(StatusCodes.Status401Unauthorized)
          .Produces(StatusCodes.Status404NotFound);

        // List all docs the user owns or collaborates on, sorted by most recent
        group.MapGet("/", async (DocumentService documentService, UserService userService, HttpContext context) =>
        {
            var user = await AuthHelper.GetCurrentUserAsync(context, userService);
            if (user is null)
                return Results.Problem(detail: "Not authenticated", statusCode: 401);

            var documents = await documentService.GetUserDocumentsAsync(user.Id);

            var response = documents.Select(x => new DocumentListResponse(
                x.Document.Id,
                x.Document.Title,
                x.Document.Owner.DisplayName,
                x.Document.UpdatedAt,
                x.Role
            ));

            return Results.Ok(response);
        }).WithTags("Documents")
          .WithSummary("Lists all documents for the current user.")
          .Produces<IEnumerable<DocumentListResponse>>(StatusCodes.Status200OK)
          .Produces(StatusCodes.Status401Unauthorized);

        // Get single doc — owner, collaborator, or anonymous access grant
        group.MapGet("/{id:guid}", async (Guid id, DocumentService documentService, UserService userService, HttpContext context) =>
        {
            var document = await documentService.GetByIdAsync(id);
            if (document is null)
                return Results.Problem(detail: "Document not found", statusCode: 404);

            var access = await AuthHelper.ResolveAccessAsync(context, document, userService, documentService);
            if (access is null)
                return Results.Problem(detail: "Not authenticated", statusCode: 401);
            if (access.Role is null)
                return Results.Problem(detail: "Forbidden", statusCode: 403);

            return Results.Ok(new DocumentResponse(
                document.Id,
                document.Title,
                document.Owner.DisplayName,
                document.Entrypoint,
                document.CreatedAt,
                document.UpdatedAt,
                access.Role,
                access.User?.DisplayName ?? access.Grant?.DisplayName
            ));
        }).WithTags("Documents")
          .WithSummary("Gets a single document by ID.")
          .Produces<DocumentResponse>(StatusCodes.Status200OK)
          .Produces(StatusCodes.Status401Unauthorized)
          .Produces(StatusCodes.Status403Forbidden)
          .Produces(StatusCodes.Status404NotFound);

        // Update title/entrypoint — owner or editor only
        group.MapPut("/{id:guid}", async (Guid id, UpdateDocumentRequest request, DocumentService documentService, UserService userService, HttpContext context) =>
        {
            var user = await AuthHelper.GetCurrentUserAsync(context, userService);
            if (user is null)
                return Results.Problem(detail: "Not authenticated", statusCode: 401);

            var document = await documentService.GetByIdAsync(id);
            if (document is null)
                return Results.Problem(detail: "Document not found", statusCode: 404);

            var isOwner = document.OwnerId == user.Id;
            var isEditor = document.Collaborators.Any(c => c.UserId == user.Id && c.Role == "editor");
            if (!isOwner && !isEditor)
                return Results.Problem(detail: "Forbidden", statusCode: 403);

            if (request.Title is not null)
                document.Title = request.Title.Trim();

            if (request.Entrypoint is not null)
            {
                var newEntrypoint = request.Entrypoint.Trim();
                // Validate: the new entrypoint must reference an active collaborative file.
                // Otherwise compile, save-as-template, and version text reads silently fail.
                var files = await documentService.GetFilesAsync(id);
                var match = files.FirstOrDefault(f => f.Filename == newEntrypoint && f.IsCollaborative);
                if (match is null)
                    return Results.Problem(detail: $"Entrypoint '{newEntrypoint}' must match an active collaborative file in this document.", statusCode: 400);
                document.Entrypoint = newEntrypoint;
            }

            await documentService.UpdateAsync(document);

            var updateRole = isOwner ? "owner" : "editor"; // viewers can't reach this code

            return Results.Ok(new DocumentResponse(
                document.Id,
                document.Title,
                document.Owner.DisplayName,
                document.Entrypoint,
                document.CreatedAt,
                document.UpdatedAt,
                updateRole
            ));
        }).WithTags("Documents")
          .WithSummary("Updates a document.")
          .Produces<DocumentResponse>(StatusCodes.Status200OK)
          .Produces(StatusCodes.Status401Unauthorized)
          .Produces(StatusCodes.Status403Forbidden)
          .Produces(StatusCodes.Status404NotFound);

        // Delete doc — owner only (cascade deletes collaborators, versions, files, etc.)
        group.MapDelete("/{id:guid}", async (Guid id, DocumentService documentService, UserService userService, HttpContext context) =>
        {
            var user = await AuthHelper.GetCurrentUserAsync(context, userService);
            if (user is null)
                return Results.Problem(detail: "Not authenticated", statusCode: 401);

            var document = await documentService.GetByIdAsync(id);
            if (document is null)
                return Results.Problem(detail: "Document not found", statusCode: 404);

            if (document.OwnerId != user.Id)
                return Results.Problem(detail: "Forbidden", statusCode: 403);

            await documentService.DeleteAsync(document);

            return Results.Ok(new { message = "Document deleted" });
        }).WithTags("Documents")
          .WithSummary("Deletes a document.")
          .Produces(StatusCodes.Status200OK)
          .Produces(StatusCodes.Status401Unauthorized)
          .Produces(StatusCodes.Status403Forbidden)
          .Produces(StatusCodes.Status404NotFound);

        // List active users in a document (connected via WebSocket)
        group.MapGet("/{id:guid}/active-users", async (Guid id, DocumentService documentService, UserService userService, HttpContext context) =>
        {
            var document = await documentService.GetByIdAsync(id);
            if (document is null)
                return Results.Problem(detail: "Document not found", statusCode: 404);

            var access = await AuthHelper.ResolveAccessAsync(context, document, userService, documentService);
            if (access is null)
                return Results.Problem(detail: "Not authenticated", statusCode: 401);
            if (access.Role is null)
                return Results.Problem(detail: "Forbidden", statusCode: 403);

            var roomName = id.ToString();
            if (!YjsRelayMiddleware.Rooms.TryGetValue(roomName, out var roomState))
                return Results.Ok(Array.Empty<ActiveUserResponse>());

            // Deduplicate by userId/grantId (a user with multiple tabs should appear once)
            var seen = new HashSet<string>();
            var activeUsers = new List<ActiveUserResponse>();

            foreach (var (ws, clientInfo) in roomState.Clients)
            {
                if (ws.State != System.Net.WebSockets.WebSocketState.Open) continue;

                var key = clientInfo.UserId?.ToString() ?? clientInfo.GrantId?.ToString() ?? clientInfo.DisplayName;
                if (!seen.Add(key)) continue;

                var role = clientInfo.IsReadOnly ? "viewer" : "editor";
                activeUsers.Add(new ActiveUserResponse(clientInfo.DisplayName, role));
            }

            return Results.Ok(activeUsers);
        }).WithTags("Documents")
          .WithSummary("Lists active users connected to a document.")
          .Produces<List<ActiveUserResponse>>(StatusCodes.Status200OK)
          .Produces(StatusCodes.Status401Unauthorized)
          .Produces(StatusCodes.Status403Forbidden)
          .Produces(StatusCodes.Status404NotFound);
    }
}
