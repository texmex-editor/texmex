using System.ComponentModel.DataAnnotations;

namespace TexMex.Api.Models;

public record TemplateFileResponse(
    Guid Id,
    string Filename,
    string ContentType,
    int Size
);

public record TemplateListResponse(
    Guid Id,
    string Slug,
    string Title,
    string? Description,
    string Category,
    bool IsSystem,
    bool IsPublic,
    string? OwnerDisplayName,
    DateTime CreatedAt
);

public record TemplateResponse(
    Guid Id,
    string Slug,
    string Title,
    string? Description,
    string Category,
    bool IsSystem,
    bool IsPublic,
    string? OwnerDisplayName,
    DateTime CreatedAt,
    string Content,
    List<TemplateFileResponse> Files
);

public record SaveAsTemplateRequest(
    [property: Required(ErrorMessage = "Title is required."),
               MinLength(1, ErrorMessage = "Title is required."),
               MaxLength(255, ErrorMessage = "Title is too long.")]
    string Title,
    [property: MaxLength(2000, ErrorMessage = "Description is too long.")]
    string? Description,
    // No length validators — the endpoint's TemplateCategories.IsAllowed check
    // gates the value against the fixed allowlist, so any length-based rule
    // would be a redundant second gate (and a different error message if hit).
    [property: Required(ErrorMessage = "Pick a category.")]
    string Category,
    bool IsPublic,
    [property: Required(ErrorMessage = "File selection is required (use an empty list to include none).")]
    List<Guid> FileIds
);

public record UpdateTemplateRequest(
    [property: MinLength(1, ErrorMessage = "Title is required."),
               MaxLength(255, ErrorMessage = "Title is too long.")]
    string? Title,
    [property: MaxLength(2000, ErrorMessage = "Description is too long.")]
    string? Description,
    // No length validators — see SaveAsTemplateRequest.Category.
    string? Category,
    bool? IsPublic
);

/// Fixed set of categories accepted by the API. Keeps the taxonomy from
/// fragmenting on typos (article vs articel) and lets the frontend render a
/// real dropdown instead of a free-text input. Add new ones here when needed —
/// the system-template seed and FE dropdown both reference this list.
public static class TemplateCategories
{
    public static readonly IReadOnlyList<string> Allowed = new[]
    {
        "article",
        "report",
        "book",
        "presentation",
        "letter",
        "cv",
        "other",
    };

    public static bool IsAllowed(string? category) =>
        category is not null && Allowed.Contains(category.Trim().ToLowerInvariant());
}
