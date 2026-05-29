using System.ComponentModel.DataAnnotations;
using TexMex.Data.Schemas;
using TexMex.Data.Services;

namespace TexMex.Api.Models;

public record FileResponse(
    Guid Id,
    string Filename,
    string ContentType,
    // Nullable so collaborative files can omit a stale upload-time value when no room
    // is loaded. For static files this is always the stored byte count; for collab
    // files the file-list endpoint passes a live byte count when the Y.Doc room is
    // hot, null when it isn't (the FE renders null as "—" via formatBytes).
    int? Size,
    bool IsCollaborative,
    string Category,     // FileTypePolicy.FileCategory as a lowercase string (e.g. "collaborative",
                         // "static_text", "image", "pdf", "font"). Frontend drives its rendering
                         // off this — see FILES_API.md for the per-category UX guide.
    string UploadedByDisplayName,
    DateTime CreatedAt
)
{
    /// One projection from DocumentFile to FileResponse so the category derivation lives in
    /// exactly one place. Category falls back to "unknown" for legacy rows whose extensions
    /// were valid when uploaded but later removed from the allowlist — frontend should treat
    /// "unknown" as download-only (same as Font category).
    ///
    /// For collab files, the stored `file.Size` is stale (set once at upload, never updated
    /// as Y.Text content grows) — so we omit it (null) unless the caller passes an explicit
    /// `liveSize` they computed from a hot Y.Doc room. For static files, `file.Size` is the
    /// real on-disk byte count.
    public static FileResponse From(DocumentFile file, int? liveSize = null) => new(
        file.Id,
        file.Filename,
        file.ContentType,
        file.IsCollaborative ? liveSize : file.Size,
        file.IsCollaborative,
        FileTypePolicy.Classify(file.Filename) is { } cat
            ? cat.ToString().ToSnakeCase()
            : "unknown",
        file.Uploader?.DisplayName ?? "Unknown",
        file.CreatedAt
    );
}

internal static class CategoryNameExtensions
{
    /// Converts "StaticText" -> "static_text", "Pdf" -> "pdf", etc. Matches the lowercase
    /// snake-case convention the rest of the API uses for enum-ish strings.
    public static string ToSnakeCase(this string s)
    {
        var sb = new System.Text.StringBuilder(s.Length + 4);
        for (int i = 0; i < s.Length; i++)
        {
            var c = s[i];
            if (i > 0 && char.IsUpper(c)) sb.Append('_');
            sb.Append(char.ToLowerInvariant(c));
        }
        return sb.ToString();
    }
}

public record RenameFileRequest(
    [property: Required(ErrorMessage = "New filename is required."),
               MinLength(1, ErrorMessage = "New filename is required."),
               MaxLength(255, ErrorMessage = "Filename is too long.")]
    string NewFilename
);
