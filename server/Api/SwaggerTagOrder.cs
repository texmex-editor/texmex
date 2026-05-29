using Microsoft.OpenApi.Models;
using Swashbuckle.AspNetCore.SwaggerGen;

namespace TexMex.Api;

/// Defines tag order and descriptions for Swagger UI.
/// Tags appear in the order listed here; unlisted tags are appended at the end.
public class SwaggerTagOrder : IDocumentFilter
{
    public void Apply(OpenApiDocument swaggerDoc, DocumentFilterContext context)
    {
        swaggerDoc.Tags =
        [
            new() { Name = "Auth", Description = "Registration, login, and session management." },
            new() { Name = "Documents", Description = "Document CRUD and real-time presence." },
            new() { Name = "Templates", Description = "System and user templates — starting points for new documents." },
            new() { Name = "Files", Description = "Upload, download, rename, and delete auxiliary files (images, .bib, .sty, etc.)." },
            new() { Name = "Collaborators", Description = "Manage permanent document collaborators by email or user ID." },
            new() { Name = "Invite Links", Description = "Shareable links that add the joining user as a permanent collaborator." },
            new() { Name = "Anonymous Links", Description = "Links that grant temporary, revocable access without requiring an account." },
            new() { Name = "Document State", Description = "Raw Yjs binary state persistence for the collaborative editor." },
            new() { Name = "Versions", Description = "Named snapshots of document state, similar to git tags." },
            new() { Name = "Compile", Description = "LaTeX to PDF compilation." },
            new() { Name = "Health", Description = "Service health check." },
        ];
    }
}
