using System.Text.Json;
using TexMex.Api.Auth;
using TexMex.Data.Services;

namespace TexMex.Api.Compile;

public static class CompileEndpoints
{
    public static void MapCompileEndpoints(this WebApplication app, string latexCompilerUrl)
    {
        // Document compile — assembles all active files (collaborative + static) and sends to compiler.
        // Collab content comes from the Y.Doc (live, reflects unsaved edits if a room is loaded).
        // Static content comes from DocumentFile.Data.
        app.MapPost("/api/documents/{id:guid}/compile", async (Guid id, DocumentService documentService, UserService userService, HttpClient httpClient, HttpContext context) =>
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
            if (documentFiles.Count == 0)
                return Results.Problem(detail: "Document has no files to compile", statusCode: 422);

            // Snapshot the file-set identity at compile start. We re-check at the end to detect
            // file add/delete/rename that happened concurrently while we read content from the
            // Y.Doc and DocumentFile.Data — without this, the compiler can receive a mismatched
            // mix of stale filenames and current content. Pattern from Overleaf (ClsiStateManager).
            var initialSignature = ComputeFileSetSignature(documentFiles);

            // Build the files payload: collab content from Y.Doc, static content from Data.
            var files = new List<object>();
            string? entrypointSource = null;
            foreach (var f in documentFiles)
            {
                byte[] contentBytes;
                if (f.IsCollaborative)
                {
                    var text = await documentService.GetCollaborativeContentAsync(id, f.Id);
                    contentBytes = System.Text.Encoding.UTF8.GetBytes(text);
                    if (f.Filename == document.Entrypoint)
                    {
                        entrypointSource = text;
                    }
                }
                else
                {
                    contentBytes = f.Data ?? Array.Empty<byte>();
                }

                // Skip the entrypoint from the files array — it's passed via the source field
                if (f.Filename == document.Entrypoint && f.IsCollaborative) continue;

                files.Add(new
                {
                    filename = f.Filename,
                    data = Convert.ToBase64String(contentBytes),
                });
            }

            if (entrypointSource is null)
                return Results.Problem(detail: $"Entrypoint '{document.Entrypoint}' not found among files", statusCode: 422);
            if (string.IsNullOrWhiteSpace(entrypointSource))
                return Results.Problem(detail: "Document has no content to compile", statusCode: 422);

            // Verify the file set didn't drift while we were reading content. Use the lighter
            // GetFilesAsync (no binary data) — we only need metadata to compare signatures.
            var finalFiles = await documentService.GetFilesAsync(id);
            var finalSignature = ComputeFileSetSignature(finalFiles);
            if (initialSignature != finalSignature)
            {
                return Results.Problem(
                    detail: "Project files changed during compile. Please retry.",
                    statusCode: 409);
            }

            return await SendToCompiler(httpClient, latexCompilerUrl, entrypointSource, document.Entrypoint, files.ToArray());
        }).WithTags("Compile")
          .WithSummary("Compiles a document to a PDF.")
          .Produces<IResult>(StatusCodes.Status200OK, "application/pdf")
          .Produces(StatusCodes.Status401Unauthorized)
          .Produces(StatusCodes.Status403Forbidden)
          .Produces(StatusCodes.Status404NotFound)
          .Produces(StatusCodes.Status422UnprocessableEntity);
    }

    // Stable signature of the file set: id + filename + collab flag, sorted by id.
    // Used to detect file add/delete/rename between the start and end of a compile run.
    private static string ComputeFileSetSignature(IEnumerable<TexMex.Data.Schemas.DocumentFile> files)
    {
        var parts = files
            .OrderBy(f => f.Id)
            .Select(f => $"{f.Id}:{f.Filename}:{(f.IsCollaborative ? 1 : 0)}");
        return string.Join("|", parts);
    }

    // Sends source + files to the compiler and returns the PDF or an error
    private static async Task<IResult> SendToCompiler(
        HttpClient httpClient, string latexCompilerUrl, string source,
        string? entrypoint = null, object[]? files = null)
    {
        try
        {
            var payload = JsonSerializer.Serialize(new { source, entrypoint, files });
            using var content = new StringContent(payload, System.Text.Encoding.UTF8, "application/json");

            using var response = await httpClient.PostAsync($"{latexCompilerUrl}/compile", content);

            if (response.IsSuccessStatusCode)
            {
                var pdf = await response.Content.ReadAsByteArrayAsync();
                return Results.File(pdf, "application/pdf");
            }
            else
            {
                var errorBody = await response.Content.ReadAsStringAsync();
                try
                {
                    var parsed = JsonSerializer.Deserialize<JsonElement>(errorBody);
                    var msg = parsed.GetProperty("error").GetString();
                    return Results.Problem(detail: msg, statusCode: 422);
                }
                catch
                {
                    return Results.Problem(detail: errorBody, statusCode: 422);
                }
            }
        }
        catch (Exception ex)
        {
            return Results.Problem(detail: $"Compiler unreachable: {ex.Message}", statusCode: 500);
        }
    }
}
