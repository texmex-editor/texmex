using System.ComponentModel.DataAnnotations;

namespace TexMex.Api.Models;

// Title is optional on create — defaults to "Untitled" in the service.
// TemplateId is optional — when provided, the new doc is seeded from that template's content + files.
public record CreateDocumentRequest(
    [property: MinLength(1, ErrorMessage = "Title cannot be empty."),
               MaxLength(255, ErrorMessage = "Title is too long.")]
    string? Title,
    Guid? TemplateId = null
);

// Both fields optional — only provided fields get updated (partial update)
public record UpdateDocumentRequest(
    [property: MinLength(1, ErrorMessage = "Title cannot be empty."),
               MaxLength(255, ErrorMessage = "Title is too long.")]
    string? Title,
    [property: MinLength(1, ErrorMessage = "Entrypoint cannot be empty."),
               MaxLength(255, ErrorMessage = "Entrypoint filename is too long.")]
    string? Entrypoint
);

// Full doc detail — used for single doc responses
public record DocumentResponse(
    Guid Id,
    string Title,
    string OwnerDisplayName,
    string Entrypoint,
    DateTime CreatedAt,
    DateTime UpdatedAt,
    string Role,
    string? AccessorDisplayName = null
);

// Active user in a document room (connected via WebSocket)
public record ActiveUserResponse(
    string DisplayName,
    string Role
);

// Lighter response for the doc list — includes Role ("owner"/"editor"/"viewer") so the frontend knows what to show
public record DocumentListResponse(
    Guid Id,
    string Title,
    string OwnerDisplayName,
    DateTime UpdatedAt,
    string Role
);
