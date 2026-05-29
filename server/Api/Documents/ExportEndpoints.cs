using System.IO.Compression;
using System.Text;
using System.Text.RegularExpressions;
using TexMex.Api.Auth;
using TexMex.Data.Services;

namespace TexMex.Api.Documents;

public static class ExportEndpoints
{
    // Anything other than alnum/dash/underscore becomes a dash; mirrors the
    // FE's handleExportPdf safe-filename pattern so the downloaded zip name
    // matches what the user sees in the toolbar.
    private static readonly Regex UnsafeFilenameChars = new(@"[^a-zA-Z0-9\-_]+", RegexOptions.Compiled);

    public static void MapExportEndpoints(this WebApplication app)
    {
        // Bundle the entire project into a zip and return it. Live-extracts
        // collaborative file content from the Y.Doc room (so unsaved keystrokes
        // are included), copies static files from DocumentFile.Data. Filenames
        // preserve virtual folders — '/' in a ZipArchiveEntry name is the
        // standard folder separator, so foo/bar.tex unzips into a foo/ dir.
        app.MapGet("/api/documents/{id:guid}/export", async (
            Guid id,
            DocumentService documentService,
            UserService userService,
            HttpContext context) =>
        {
            var document = await documentService.GetByIdAsync(id);
            if (document is null)
                return Results.Problem(detail: "Document not found", statusCode: 404);

            var access = await AuthHelper.ResolveAccessAsync(context, document, userService, documentService);
            if (access is null)
                return Results.Problem(detail: "Not authenticated", statusCode: 401);
            if (access.Role is null)
                return Results.Problem(detail: "Forbidden", statusCode: 403);

            var documentFiles = await documentService.GetAllFileDataAsync(id);

            // Build the zip in memory. Typical LaTeX projects are well under
            // the few-MB range; a streaming impl would only be worth it for
            // multi-megabyte image-heavy docs, which we don't have here.
            using var buffer = new MemoryStream();
            using (var zip = new ZipArchive(buffer, ZipArchiveMode.Create, leaveOpen: true))
            {
                foreach (var file in documentFiles)
                {
                    var entry = zip.CreateEntry(file.Filename, CompressionLevel.Optimal);
                    await using var entryStream = entry.Open();

                    if (file.IsCollaborative)
                    {
                        var text = await documentService.GetCollaborativeContentAsync(id, file.Id);
                        var bytes = Encoding.UTF8.GetBytes(text);
                        await entryStream.WriteAsync(bytes);
                    }
                    else if (file.Data is not null)
                    {
                        await entryStream.WriteAsync(file.Data);
                    }
                    // else: empty file — zip entry exists but with zero bytes.
                }
            }

            var trimmedTitle = (document.Title ?? string.Empty).Trim();
            var safeName = string.IsNullOrEmpty(trimmedTitle)
                ? id.ToString()
                : UnsafeFilenameChars.Replace(trimmedTitle, "-");
            var filename = $"{safeName}.zip";

            return Results.File(buffer.ToArray(), "application/zip", filename);
        }).WithTags("Documents")
          .WithSummary("Downloads the entire project as a zip archive.")
          .Produces<IResult>(StatusCodes.Status200OK, "application/zip")
          .Produces(StatusCodes.Status401Unauthorized)
          .Produces(StatusCodes.Status403Forbidden)
          .Produces(StatusCodes.Status404NotFound);
    }
}
