using TexMex.Api.Auth;
using TexMex.Api.Models;
using TexMex.Data.Services;
using TexMex.WebSockets;

namespace TexMex.Api.Documents;

public static class CollaboratorEndpoints
{
    public static void MapCollaboratorEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/documents/{documentId:guid}/collaborators");

        // Add a collaborator by email — owner only
        group.MapPost("/", async (Guid documentId, AddCollaboratorRequest request, DocumentService documentService, UserService userService, HttpContext context) =>
        {
            var user = await AuthHelper.GetCurrentUserAsync(context, userService);
            if (user is null)
                return Results.Problem(detail: "Not authenticated", statusCode: 401);

            var document = await documentService.GetByIdAsync(documentId);
            if (document is null)
                return Results.Problem(detail: "Document not found", statusCode: 404);

            if (document.OwnerId != user.Id)
                return Results.Problem(detail: "Forbidden", statusCode: 403);

            var targetUser = await userService.GetByEmailAsync(request.Email);
            if (targetUser is null)
                return Results.Problem(detail: "User not found", statusCode: 404);

            if (targetUser.Id == user.Id)
                return Results.Problem(detail: "Cannot add yourself as a collaborator", statusCode: 400);

            if (targetUser.Id == document.OwnerId)
                return Results.Problem(detail: "Cannot add the document owner as a collaborator", statusCode: 400);

            if (document.Collaborators.Any(c => c.UserId == targetUser.Id))
                return Results.Problem(detail: "User is already a collaborator", statusCode: 409);

            var collaborator = await documentService.AddCollaboratorAsync(documentId, targetUser.Id, request.Role);

            return Results.Created($"/api/documents/{documentId}/collaborators/{targetUser.Id}", new CollaboratorResponse(
                collaborator.UserId,
                collaborator.User.Email,
                collaborator.User.DisplayName,
                collaborator.Role,
                collaborator.AddedAt
            ));
        }).WithTags("Collaborators")
          .WithSummary("Adds a collaborator to a document.")
          .Produces<CollaboratorResponse>(StatusCodes.Status201Created)
          .Produces(StatusCodes.Status400BadRequest)
          .Produces(StatusCodes.Status401Unauthorized)
          .Produces(StatusCodes.Status403Forbidden)
          .Produces(StatusCodes.Status404NotFound)
          .Produces(StatusCodes.Status409Conflict);

        // List all collaborators + anonymous users — anyone with access can view
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

            var collaborators = await documentService.GetCollaboratorsAsync(documentId);

            // Include the owner as a synthetic entry with role "owner"
            var ownerEntry = new CollaboratorResponse(
                document.Owner.Id,
                document.Owner.Email,
                document.Owner.DisplayName,
                "owner",
                document.CreatedAt
            );

            var collabList = new[] { ownerEntry }.Concat(collaborators.Select(c => new CollaboratorResponse(
                c.UserId,
                c.User.Email,
                c.User.DisplayName,
                c.Role,
                c.AddedAt
            )));

            // Anonymous users from active anonymous access links
            var grants = await documentService.GetGrantsForDocumentAsync(documentId);
            var anonList = grants.Select(g => new AnonymousGrantResponse(
                g.Id,
                g.DisplayName,
                g.User?.Email,
                g.AccessLink.Permission,
                g.LastSeenAt,
                g.AccessLinkId
            ));

            return Results.Ok(new CollaboratorListResponse(collabList, anonList));
        }).WithTags("Collaborators")
          .WithSummary("Lists all collaborators and anonymous users for a document.")
          .Produces<CollaboratorListResponse>(StatusCodes.Status200OK)
          .Produces(StatusCodes.Status401Unauthorized)
          .Produces(StatusCodes.Status403Forbidden)
          .Produces(StatusCodes.Status404NotFound);

        // Update a collaborator's role — owner only
        group.MapPut("/{userId:guid}", async (Guid documentId, Guid userId, UpdateCollaboratorRoleRequest request, DocumentService documentService, UserService userService, HttpContext context) =>
        {
            var user = await AuthHelper.GetCurrentUserAsync(context, userService);
            if (user is null)
                return Results.Problem(detail: "Not authenticated", statusCode: 401);

            var document = await documentService.GetByIdAsync(documentId);
            if (document is null)
                return Results.Problem(detail: "Document not found", statusCode: 404);

            if (document.OwnerId != user.Id)
                return Results.Problem(detail: "Forbidden", statusCode: 403);

            if (userId == document.OwnerId)
                return Results.Problem(detail: "Cannot change the owner's role", statusCode: 400);

            var collaborator = await documentService.GetCollaboratorAsync(documentId, userId);
            if (collaborator is null)
                return Results.Problem(detail: "Collaborator not found", statusCode: 404);

            await documentService.UpdateCollaboratorRoleAsync(collaborator, request.Role);

            // Update any active WebSocket connection's permission in real time
            YjsRelayMiddleware.UpdateClientPermission(documentId, userId, request.Role == "viewer");

            return Results.Ok(new CollaboratorResponse(
                collaborator.UserId,
                collaborator.User.Email,
                collaborator.User.DisplayName,
                collaborator.Role,
                collaborator.AddedAt
            ));
        }).WithTags("Collaborators")
          .WithSummary("Updates a collaborator's role.")
          .Produces<CollaboratorResponse>(StatusCodes.Status200OK)
          .Produces(StatusCodes.Status400BadRequest)
          .Produces(StatusCodes.Status401Unauthorized)
          .Produces(StatusCodes.Status403Forbidden)
          .Produces(StatusCodes.Status404NotFound);

        // Remove a collaborator — owner can remove anyone, users can self-remove
        group.MapDelete("/{userId:guid}", async (Guid documentId, Guid userId, DocumentService documentService, UserService userService, HttpContext context) =>
        {
            var user = await AuthHelper.GetCurrentUserAsync(context, userService);
            if (user is null)
                return Results.Problem(detail: "Not authenticated", statusCode: 401);

            var document = await documentService.GetByIdAsync(documentId);
            if (document is null)
                return Results.Problem(detail: "Document not found", statusCode: 404);

            var isOwner = document.OwnerId == user.Id;
            var isSelfRemove = user.Id == userId;
            if (!isOwner && !isSelfRemove)
                return Results.Problem(detail: "Forbidden", statusCode: 403);

            if (userId == document.OwnerId)
                return Results.Problem(detail: "Cannot remove the document owner", statusCode: 400);

            var collaborator = await documentService.GetCollaboratorAsync(documentId, userId);
            if (collaborator is null)
                return Results.Problem(detail: "Collaborator not found", statusCode: 404);

            await documentService.RemoveCollaboratorAsync(collaborator);

            // Close any active WebSocket connections for the removed user
            await YjsRelayMiddleware.DisconnectClient(documentId, userId);

            return Results.Ok(new { message = "Collaborator removed" });
        }).WithTags("Collaborators")
          .WithSummary("Removes a collaborator from a document.")
          .Produces(StatusCodes.Status200OK)
          .Produces(StatusCodes.Status400BadRequest)
          .Produces(StatusCodes.Status401Unauthorized)
          .Produces(StatusCodes.Status403Forbidden)
          .Produces(StatusCodes.Status404NotFound);
    }
}
