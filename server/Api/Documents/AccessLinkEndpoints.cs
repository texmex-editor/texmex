using TexMex.Api.Auth;
using TexMex.Api.Models;
using TexMex.Data.Services;

namespace TexMex.Api.Documents;

public static class AccessLinkEndpoints
{
    public static void MapAccessLinkEndpoints(this WebApplication app)
    {
        // ── Document-scoped invite link management (owner only) ─────────

        var group = app.MapGroup("/api/documents/{documentId:guid}/links");

        // Create an invite link
        group.MapPost("/", async (Guid documentId, CreateAccessLinkRequest request, DocumentService documentService, UserService userService, HttpContext context) =>
        {
            var user = await AuthHelper.GetCurrentUserAsync(context, userService);
            if (user is null)
                return Results.Problem(detail: "Not authenticated", statusCode: 401);

            var document = await documentService.GetByIdAsync(documentId);
            if (document is null)
                return Results.Problem(detail: "Document not found", statusCode: 404);

            if (document.OwnerId != user.Id)
                return Results.Problem(detail: "Forbidden", statusCode: 403);

            var link = await documentService.CreateAccessLinkAsync(
                documentId, user.Id, request.Permission,
                allowAnonymous: false, maxUses: request.MaxUses);

            return Results.Created($"/api/documents/{documentId}/links/{link.Id}", new AccessLinkResponse(
                link.Id,
                link.Token,
                link.Permission,
                link.IsActive,
                link.CreatedAt,
                link.MaxUses,
                link.UseCount
            ));
        }).WithTags("Invite Links")
          .WithSummary("Creates a shareable invite link for a document.")
          .Produces<AccessLinkResponse>(StatusCodes.Status201Created)
          .Produces(StatusCodes.Status401Unauthorized)
          .Produces(StatusCodes.Status403Forbidden)
          .Produces(StatusCodes.Status404NotFound);

        // List all invite links (active + inactive)
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

            var links = await documentService.GetAccessLinksAsync(documentId, allowAnonymous: false);

            var response = links.Select(l => new AccessLinkResponse(
                l.Id,
                l.Token,
                l.Permission,
                l.IsActive,
                l.CreatedAt,
                l.MaxUses,
                l.UseCount
            ));

            return Results.Ok(response);
        }).WithTags("Invite Links")
          .WithSummary("Lists all invite links for a document.")
          .Produces<IEnumerable<AccessLinkResponse>>(StatusCodes.Status200OK)
          .Produces(StatusCodes.Status401Unauthorized)
          .Produces(StatusCodes.Status403Forbidden)
          .Produces(StatusCodes.Status404NotFound);

        // Revoke an invite link
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

            var links = await documentService.GetAccessLinksAsync(documentId, allowAnonymous: false);
            var link = links.FirstOrDefault(l => l.Id == linkId);
            if (link is null)
                return Results.Problem(detail: "Invite link not found", statusCode: 404);

            await documentService.RevokeAccessLinkAsync(link);

            return Results.Ok(new { message = "Invite link revoked" });
        }).WithTags("Invite Links")
          .WithSummary("Revokes an invite link.")
          .Produces(StatusCodes.Status200OK)
          .Produces(StatusCodes.Status401Unauthorized)
          .Produces(StatusCodes.Status403Forbidden)
          .Produces(StatusCodes.Status404NotFound);

        // ── Top-level join endpoint (requires account) ──────────────────

        app.MapPost("/api/join/{token}", async (string token, DocumentService documentService, UserService userService, HttpContext context) =>
        {
            var user = await AuthHelper.GetCurrentUserAsync(context, userService);
            if (user is null)
                return Results.Problem(detail: "Not authenticated", statusCode: 401);

            var link = await documentService.GetAccessLinkByTokenAsync(token);
            if (link is null || !link.IsActive)
                return Results.Problem(detail: "Access link not found or inactive", statusCode: 404);

            // Reject anonymous link tokens used on this endpoint
            if (link.AllowAnonymous)
                return Results.Problem(detail: "Access link not found or inactive", statusCode: 404);

            var document = link.Document;

            // Owner clicking their own link — just return info, no use_count increment
            if (document.OwnerId == user.Id)
            {
                return Results.Ok(new JoinResponse(document.Id, document.Title, document.Owner.DisplayName, "owner"));
            }

            // Existing collaborator — no use_count increment
            var existing = document.Collaborators.FirstOrDefault(c => c.UserId == user.Id);
            if (existing is not null)
            {
                // Upgrade role if the link grants higher permission
                if (link.Permission == "editor" && existing.Role == "viewer")
                {
                    await documentService.UpdateCollaboratorRoleAsync(existing, "editor");
                    return Results.Ok(new JoinResponse(document.Id, document.Title, document.Owner.DisplayName, "editor"));
                }

                return Results.Ok(new JoinResponse(document.Id, document.Title, document.Owner.DisplayName, existing.Role));
            }

            // New collaborator — atomic increment to prevent race conditions at the limit
            if (link.MaxUses is not null)
            {
                var incremented = await documentService.TryIncrementLinkUseCountAsync(link.Id);
                if (!incremented)
                    return Results.Problem(detail: "This invite link has reached its usage limit", statusCode: 410);
            }

            await documentService.AddCollaboratorAsync(document.Id, user.Id, link.Permission);

            return Results.Ok(new JoinResponse(document.Id, document.Title, document.Owner.DisplayName, link.Permission));
        }).WithTags("Invite Links")
          .WithSummary("Joins a document via an invite link.")
          .Produces<JoinResponse>(StatusCodes.Status200OK)
          .Produces(StatusCodes.Status401Unauthorized)
          .Produces(StatusCodes.Status404NotFound)
          .Produces(StatusCodes.Status410Gone);
    }
}
