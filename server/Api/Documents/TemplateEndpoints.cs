using TexMex.Api.Auth;
using TexMex.Api.Models;
using TexMex.Data.Schemas;
using TexMex.Data.Services;

namespace TexMex.Api.Documents;

// Templates — system presets and user-created reusable starting points for new documents.
// All template endpoints require an authenticated user (no anonymous access).
public static class TemplateEndpoints
{
    public static void MapTemplateEndpoints(this WebApplication app)
    {
        // GET /api/templates — list visible templates (system + own + public from others)
        app.MapGet("/api/templates", async (string? category, TemplateService templateService, UserService userService, HttpContext context) =>
        {
            var user = await AuthHelper.GetCurrentUserAsync(context, userService);
            if (user is null)
                return Results.Problem(detail: "Not authenticated", statusCode: 401);

            var templates = await templateService.GetVisibleToUserAsync(user.Id, category);

            var response = templates.Select(t => new TemplateListResponse(
                t.Id,
                t.Slug,
                t.Title,
                t.Description,
                t.Category,
                IsSystem: t.OwnerId is null,
                t.IsPublic,
                t.Owner?.DisplayName,
                t.CreatedAt
            ));

            return Results.Ok(response);
        }).WithTags("Templates")
          .WithSummary("Lists templates visible to the current user (system + own + public).")
          .Produces<IEnumerable<TemplateListResponse>>(StatusCodes.Status200OK)
          .Produces(StatusCodes.Status401Unauthorized);

        // GET /api/templates/{id} — full template detail including content + file metadata
        app.MapGet("/api/templates/{id:guid}", async (Guid id, TemplateService templateService, UserService userService, HttpContext context) =>
        {
            var user = await AuthHelper.GetCurrentUserAsync(context, userService);
            if (user is null)
                return Results.Problem(detail: "Not authenticated", statusCode: 401);

            var template = await templateService.GetByIdAsync(id);
            if (template is null)
                return Results.Problem(detail: "Template not found", statusCode: 404);

            // Visibility check — same rules as listing
            var isVisible = template.OwnerId is null
                || template.OwnerId == user.Id
                || template.IsPublic;
            if (!isVisible)
                return Results.Problem(detail: "Template not found", statusCode: 404);

            var files = template.Files
                .OrderBy(f => f.Filename)
                .Select(f => new TemplateFileResponse(f.Id, f.Filename, f.ContentType, f.Data.Length))
                .ToList();

            return Results.Ok(new TemplateResponse(
                template.Id,
                template.Slug,
                template.Title,
                template.Description,
                template.Category,
                IsSystem: template.OwnerId is null,
                template.IsPublic,
                template.Owner?.DisplayName,
                template.CreatedAt,
                template.Content,
                files
            ));
        }).WithTags("Templates")
          .WithSummary("Gets a single template with content and file metadata.")
          .Produces<TemplateResponse>(StatusCodes.Status200OK)
          .Produces(StatusCodes.Status401Unauthorized)
          .Produces(StatusCodes.Status404NotFound);

        // DELETE /api/templates/{id} — owner only. System templates can't be deleted via API.
        app.MapDelete("/api/templates/{id:guid}", async (Guid id, TemplateService templateService, UserService userService, HttpContext context) =>
        {
            var user = await AuthHelper.GetCurrentUserAsync(context, userService);
            if (user is null)
                return Results.Problem(detail: "Not authenticated", statusCode: 401);

            var template = await templateService.GetByIdAsync(id);
            if (template is null)
                return Results.Problem(detail: "Template not found", statusCode: 404);

            // Only the owner can delete. System templates have OwnerId NULL — never deletable here.
            if (template.OwnerId != user.Id)
                return Results.Problem(detail: "Forbidden", statusCode: 403);

            await templateService.DeleteAsync(template);
            return Results.Ok(new { message = "Template deleted" });
        }).WithTags("Templates")
          .WithSummary("Deletes a user-owned template.")
          .Produces(StatusCodes.Status200OK)
          .Produces(StatusCodes.Status401Unauthorized)
          .Produces(StatusCodes.Status403Forbidden)
          .Produces(StatusCodes.Status404NotFound);

        // GET /api/templates/categories — the fixed allowlist the FE renders as a dropdown.
        // No auth required; the list is a static set, harmless to expose.
        app.MapGet("/api/templates/categories", () =>
            Results.Ok(TexMex.Api.Models.TemplateCategories.Allowed))
          .WithTags("Templates")
          .WithSummary("Lists the allowed template category slugs.")
          .Produces<IReadOnlyList<string>>(StatusCodes.Status200OK);

        // PATCH /api/templates/{id} — owner-only edit of title/description/category/isPublic.
        // System templates (OwnerId == null) are not editable through this endpoint.
        app.MapPatch("/api/templates/{id:guid}", async (
            Guid id,
            TexMex.Api.Models.UpdateTemplateRequest request,
            TemplateService templateService,
            UserService userService,
            HttpContext context) =>
        {
            var user = await AuthHelper.GetCurrentUserAsync(context, userService);
            if (user is null)
                return Results.Problem(detail: "Not authenticated", statusCode: 401);

            var template = await templateService.GetByIdAsync(id);
            if (template is null)
                return Results.Problem(detail: "Template not found", statusCode: 404);

            if (template.OwnerId != user.Id)
                return Results.Problem(detail: "Forbidden", statusCode: 403);

            if (request.Category is not null &&
                !TexMex.Api.Models.TemplateCategories.IsAllowed(request.Category))
                return Results.Problem(
                    detail: $"Unknown category '{request.Category}'. Allowed: {string.Join(", ", TexMex.Api.Models.TemplateCategories.Allowed)}.",
                    statusCode: 400);

            var updated = await templateService.UpdateUserTemplateAsync(template, request);

            return Results.Ok(new TexMex.Api.Models.TemplateListResponse(
                updated.Id, updated.Slug, updated.Title, updated.Description, updated.Category,
                updated.OwnerId is null, updated.IsPublic, updated.Owner?.DisplayName, updated.CreatedAt
            ));
        }).WithTags("Templates")
          .WithSummary("Updates a user-owned template's title, description, category, or visibility.")
          .Produces<TexMex.Api.Models.TemplateListResponse>(StatusCodes.Status200OK)
          .Produces(StatusCodes.Status400BadRequest)
          .Produces(StatusCodes.Status401Unauthorized)
          .Produces(StatusCodes.Status403Forbidden)
          .Produces(StatusCodes.Status404NotFound);

        // POST /api/documents/{id}/save-as-template — turn an existing document into a user template
        app.MapPost("/api/documents/{id:guid}/save-as-template", async (
            Guid id,
            SaveAsTemplateRequest request,
            DocumentService documentService,
            TemplateService templateService,
            UserService userService,
            HttpContext context) =>
        {
            var user = await AuthHelper.GetCurrentUserAsync(context, userService);
            if (user is null)
                return Results.Problem(detail: "Not authenticated", statusCode: 401);

            var document = await documentService.GetByIdAsync(id);
            if (document is null)
                return Results.Problem(detail: "Document not found", statusCode: 404);

            // Must be at least an editor on the source document to save it as a template
            var isOwner = document.OwnerId == user.Id;
            var isEditor = document.Collaborators.Any(c => c.UserId == user.Id && c.Role == "editor");
            if (!isOwner && !isEditor)
                return Results.Problem(detail: "Forbidden", statusCode: 403);

            if (!TexMex.Api.Models.TemplateCategories.IsAllowed(request.Category))
                return Results.Problem(
                    detail: $"Unknown category '{request.Category}'. Allowed: {string.Join(", ", TexMex.Api.Models.TemplateCategories.Allowed)}.",
                    statusCode: 400);

            // Find the entrypoint file. Its current Y.Text content becomes Template.Content.
            var allFiles = await documentService.GetFilesAsync(id);
            var entrypointFile = allFiles.FirstOrDefault(f => f.Filename == document.Entrypoint && f.IsCollaborative);
            if (entrypointFile is null)
                return Results.Problem(detail: $"Entrypoint '{document.Entrypoint}' not found as a collaborative file", statusCode: 422);

            var content = await documentService.GetCollaborativeContentAsync(id, entrypointFile.Id);
            if (string.IsNullOrWhiteSpace(content))
                return Results.Problem(detail: "Document has no content to save as a template", statusCode: 422);

            // Only include the files the caller explicitly picked. Scope to this document
            // so the request can't be used to leak files from other documents.
            var selectedFiles = await documentService.GetFilesByIdsAsync(id, request.FileIds);
            if (selectedFiles.Count != request.FileIds.Count)
                return Results.Problem(detail: "One or more file IDs do not belong to this document", statusCode: 400);

            // Reject upfront if a non-entrypoint file shares the source doc's entrypoint
            // filename — that's the name CreateFromTemplateAsync will use for the new doc's
            // entrypoint file too, so a template file with the same name would collide on the
            // partial unique index when instantiated. (In practice this only triggers in the
            // exotic case where two files share a name across collab/static categories.)
            var collidingFile = selectedFiles.FirstOrDefault(f =>
                f.Id != entrypointFile.Id &&
                string.Equals(f.Filename, document.Entrypoint, StringComparison.Ordinal));
            if (collidingFile is not null)
            {
                return Results.Problem(
                    detail: $"File '{collidingFile.Filename}' has the same name as the document's entrypoint. " +
                            "Rename or exclude it before saving as a template.",
                    statusCode: 400);
            }

            // The entrypoint goes into Template.Content, not into the files list — exclude it if selected.
            // For collab files: extract content from Y.Doc, store as UTF-8 bytes in TemplateFile.Data.
            // For static files: copy Data directly.
            var fileTuples = new List<(string filename, string contentType, byte[] data)>();
            foreach (var f in selectedFiles)
            {
                if (f.Id == entrypointFile.Id) continue;

                byte[] bytes;
                if (f.IsCollaborative)
                {
                    var text = await documentService.GetCollaborativeContentAsync(id, f.Id);
                    bytes = System.Text.Encoding.UTF8.GetBytes(text);
                }
                else
                {
                    bytes = f.Data ?? Array.Empty<byte>();
                }
                fileTuples.Add((f.Filename, f.ContentType, bytes));
            }

            // Size caps — per-file 10 MB matches the regular file-upload cap (FileEndpoints.cs);
            // total 50 MB protects against pathological templates that would bloat the DB row
            // and cost everyone instantiating from them. Check entrypoint content first since
            // it's the most likely overflow vector for prose-heavy projects.
            const int MaxPerFileBytes = 10 * 1024 * 1024;
            const int MaxTotalBytes = 50 * 1024 * 1024;
            var contentBytes = System.Text.Encoding.UTF8.GetByteCount(content);
            if (contentBytes > MaxPerFileBytes)
                return Results.Problem(
                    detail: $"Entrypoint file is too large for a template (max {MaxPerFileBytes / 1024 / 1024} MB).",
                    statusCode: 413);
            var oversizeFile = fileTuples.FirstOrDefault(t => t.data.Length > MaxPerFileBytes);
            if (oversizeFile.filename is not null)
                return Results.Problem(
                    detail: $"File '{oversizeFile.filename}' is too large for a template (max {MaxPerFileBytes / 1024 / 1024} MB).",
                    statusCode: 413);
            var totalBytes = contentBytes + fileTuples.Sum(t => (long)t.data.Length);
            if (totalBytes > MaxTotalBytes)
                return Results.Problem(
                    detail: $"Template total size {totalBytes / 1024 / 1024} MB exceeds the {MaxTotalBytes / 1024 / 1024} MB limit. Deselect some files.",
                    statusCode: 413);

            Template template;
            try
            {
                template = await templateService.CreateUserTemplateAsync(
                    ownerId: user.Id,
                    title: request.Title,
                    description: request.Description,
                    category: request.Category,
                    isPublic: request.IsPublic,
                    content: content,
                    entrypointFilename: document.Entrypoint,
                    files: fileTuples);
            }
            catch (Microsoft.EntityFrameworkCore.DbUpdateException ex)
                when (ex.InnerException is Npgsql.PostgresException pg && pg.SqlState == "23505")
            {
                // Two concurrent save-as-template requests with the same title both passed the
                // check-then-act slug-uniqueness loop and the second insert hit idx_templates_slug.
                // Mirror the upload endpoint's 409+retry pattern instead of surfacing 500.
                return Results.Problem(detail: "Template slug collision — please retry.", statusCode: 409);
            }

            var fileResponses = template.Files
                .OrderBy(f => f.Filename)
                .Select(f => new TemplateFileResponse(f.Id, f.Filename, f.ContentType, f.Data.Length))
                .ToList();

            return Results.Created($"/api/templates/{template.Id}", new TemplateResponse(
                template.Id,
                template.Slug,
                template.Title,
                template.Description,
                template.Category,
                IsSystem: false,
                template.IsPublic,
                template.Owner?.DisplayName,
                template.CreatedAt,
                template.Content,
                fileResponses
            ));
        }).WithTags("Templates")
          .WithSummary("Saves an existing document (with selected files) as a new user template.")
          .Produces<TemplateResponse>(StatusCodes.Status201Created)
          .Produces(StatusCodes.Status400BadRequest)
          .Produces(StatusCodes.Status401Unauthorized)
          .Produces(StatusCodes.Status403Forbidden)
          .Produces(StatusCodes.Status404NotFound)
          .Produces(StatusCodes.Status413PayloadTooLarge)
          .Produces(StatusCodes.Status422UnprocessableEntity);
    }
}
