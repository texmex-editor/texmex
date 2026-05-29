using Microsoft.EntityFrameworkCore;
using TexMex.Api.Auth;
using TexMex.Api.Models;
using TexMex.Data.Services;
using TexMex.WebSockets;

namespace TexMex.Api.Documents;

public static class AnonymousLinkEndpoints
{
    public static void MapAnonymousLinkEndpoints(this WebApplication app)
    {
        // ── Document-scoped anonymous link management (owner only) ──────

        var group = app.MapGroup("/api/documents/{documentId:guid}/anonymous-links");

        // Create an anonymous access link
        group.MapPost("/", async (Guid documentId, CreateAnonymousLinkRequest request, DocumentService documentService, UserService userService, HttpContext context) =>
        {
            var user = await AuthHelper.GetCurrentUserAsync(context, userService);
            if (user is null)
                return Results.Problem(detail: "Not authenticated", statusCode: 401);

            var document = await documentService.GetByIdAsync(documentId);
            if (document is null)
                return Results.Problem(detail: "Document not found", statusCode: 404);

            if (document.OwnerId != user.Id)
                return Results.Problem(detail: "Forbidden", statusCode: 403);

            var link = await documentService.CreateAccessLinkAsync(documentId, user.Id, request.Permission, allowAnonymous: true);

            return Results.Created($"/api/documents/{documentId}/anonymous-links/{link.Id}", new AnonymousLinkResponse(
                link.Id,
                link.Token,
                link.Permission,
                link.IsActive,
                link.CreatedAt
            ));
        }).WithTags("Anonymous Links")
          .WithSummary("Creates an anonymous access link for a document.")
          .Produces<AnonymousLinkResponse>(StatusCodes.Status201Created)
          .Produces(StatusCodes.Status401Unauthorized)
          .Produces(StatusCodes.Status403Forbidden)
          .Produces(StatusCodes.Status404NotFound);

        // List all anonymous links (active + inactive)
        group.MapGet("/", async (Guid documentId, DocumentService documentService, UserService userService, HttpContext context) =>
        {
            var user = await AuthHelper.GetCurrentUserAsync(context, userService);
            if (user is null)
                return Results.Problem(detail: "Not authenticated", statusCode: 401);

            var document = await documentService.GetByIdAsync(documentId);
            if (document is null)
                return Results.Problem(detail: "Document not found", statusCode: 404);

            if (document.OwnerId != user.Id)
                return Results.Problem(detail: "Forbidden", statusCode: 403);

            var links = await documentService.GetAccessLinksAsync(documentId, allowAnonymous: true);

            var response = links.Select(l => new AnonymousLinkResponse(
                l.Id,
                l.Token,
                l.Permission,
                l.IsActive,
                l.CreatedAt
            ));

            return Results.Ok(response);
        }).WithTags("Anonymous Links")
          .WithSummary("Lists all anonymous access links for a document.")
          .Produces<IEnumerable<AnonymousLinkResponse>>(StatusCodes.Status200OK)
          .Produces(StatusCodes.Status401Unauthorized)
          .Produces(StatusCodes.Status403Forbidden)
          .Produces(StatusCodes.Status404NotFound);

        // Revoke an anonymous link — cascade-deletes all grants and disconnects users
        group.MapDelete("/{linkId:guid}", async (Guid documentId, Guid linkId, DocumentService documentService, UserService userService, HttpContext context) =>
        {
            var user = await AuthHelper.GetCurrentUserAsync(context, userService);
            if (user is null)
                return Results.Problem(detail: "Not authenticated", statusCode: 401);

            var document = await documentService.GetByIdAsync(documentId);
            if (document is null)
                return Results.Problem(detail: "Document not found", statusCode: 404);

            if (document.OwnerId != user.Id)
                return Results.Problem(detail: "Forbidden", statusCode: 403);

            var links = await documentService.GetAccessLinksAsync(documentId, allowAnonymous: true);
            var link = links.FirstOrDefault(l => l.Id == linkId);
            if (link is null)
                return Results.Problem(detail: "Anonymous access link not found", statusCode: 404);

            var revokedGrantIds = await documentService.RevokeAnonymousLinkWithCascadeAsync(link);

            // Disconnect all WebSocket connections tied to the revoked grants
            await YjsRelayMiddleware.DisconnectByGrantIds(documentId, revokedGrantIds);

            return Results.Ok(new { message = "Anonymous access link revoked", disconnectedUsers = revokedGrantIds.Count });
        }).WithTags("Anonymous Links")
          .WithSummary("Revokes an anonymous access link and disconnects all users.")
          .Produces(StatusCodes.Status200OK)
          .Produces(StatusCodes.Status401Unauthorized)
          .Produces(StatusCodes.Status403Forbidden)
          .Produces(StatusCodes.Status404NotFound);

        // ── Top-level anonymous join endpoint ───────────────────────────

        app.MapPost("/api/join/anonymous/{token}", async (string token, DocumentService documentService, UserService userService, HttpContext context) =>
        {
            var link = await documentService.GetAccessLinkByTokenAsync(token);
            if (link is null || !link.IsActive)
                return Results.Problem(detail: "Access link not found or inactive", statusCode: 404);

            // Reject invite link tokens used on this endpoint
            if (!link.AllowAnonymous)
                return Results.Problem(detail: "Access link not found or inactive", statusCode: 404);

            var document = link.Document;

            // Check if user is logged in
            var user = await AuthHelper.GetCurrentUserAsync(context, userService);

            if (user is not null)
            {
                // Logged-in user — create grant with their identity (idempotent)
                var existing = await documentService.GetExistingGrantForUserAsync(link.Id, user.Id);
                if (existing is not null)
                {
                    return Results.Ok(new AnonymousJoinResponse(
                        document.Id, document.Title, document.Owner.DisplayName,
                        existing.AccessLink.Permission, existing.Id
                    ));
                }

                try
                {
                    var grant = await documentService.CreateAnonymousGrantAsync(link.Id, user.Id, user.DisplayName);

                    return Results.Ok(new AnonymousJoinResponse(
                        document.Id, document.Title, document.Owner.DisplayName,
                        link.Permission, grant.Id
                    ));
                }
                catch (DbUpdateException)
                {
                    // Race condition: another request created the grant concurrently
                    var raced = await documentService.GetExistingGrantForUserAsync(link.Id, user.Id);
                    if (raced is null)
                        return Results.Problem(detail: "Failed to create grant", statusCode: 500);

                    return Results.Ok(new AnonymousJoinResponse(
                        document.Id, document.Title, document.Owner.DisplayName,
                        raced.AccessLink.Permission, raced.Id
                    ));
                }
            }
            else
            {
                // Anonymous user — check if they already have a grant via cookie (page refresh)
                var existingGrant = await AuthHelper.GetAnonymousGrantAsync(context, documentService);
                if (existingGrant is not null && existingGrant.AccessLinkId == link.Id)
                {
                    return Results.Ok(new AnonymousJoinResponse(
                        document.Id, document.Title, document.Owner.DisplayName,
                        existingGrant.AccessLink.Permission, existingGrant.Id
                    ));
                }

                // Create new anonymous grant with a unique display name
                var existingGrants = await documentService.GetGrantsForDocumentAsync(document.Id);
                var existingNames = existingGrants.Select(g => g.DisplayName);
                var displayName = AnonymousNameGenerator.GenerateUnique(existingNames);
                var grant = await documentService.CreateAnonymousGrantAsync(link.Id, null, displayName);

                // Set the anonymous grant cookie
                AuthHelper.SetAnonymousGrantCookie(context, grant.Id);

                return Results.Ok(new AnonymousJoinResponse(
                    document.Id, document.Title, document.Owner.DisplayName,
                    link.Permission, grant.Id
                ));
            }
        }).WithTags("Anonymous Links")
          .WithSummary("Joins a document via an anonymous access link.")
          .Produces<AnonymousJoinResponse>(StatusCodes.Status200OK)
          .Produces(StatusCodes.Status404NotFound);
    }
}
