using System.ComponentModel.DataAnnotations;

namespace TexMex.Api.Models;

// Label = short name, Message = longer description (like a git commit message)
public record CreateVersionRequest(
    [property: MinLength(1, ErrorMessage = "Label cannot be empty (or omit it)."),
               MaxLength(512, ErrorMessage = "Label is too long.")]
    string? Label,
    [property: MaxLength(2000, ErrorMessage = "Message is too long.")]
    string? Message
);

public record VersionResponse(
    Guid Id,
    string? Label,
    string? Message,
    string CreatorDisplayName,
    DateTime CreatedAt,
    string? SourceText = null
);
