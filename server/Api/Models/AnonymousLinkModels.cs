using System.ComponentModel.DataAnnotations;

namespace TexMex.Api.Models;

public record CreateAnonymousLinkRequest(
    [property: Required(ErrorMessage = "Permission is required."),
               RegularExpression("^(editor|viewer)$",
                   ErrorMessage = "Permission must be 'editor' or 'viewer'.")]
    string Permission
);

public record AnonymousLinkResponse(
    Guid Id,
    string Token,
    string Permission,
    bool IsActive,
    DateTime CreatedAt
);

public record AnonymousJoinResponse(
    Guid DocumentId,
    string Title,
    string OwnerDisplayName,
    string Role,
    Guid GrantId
);

public record AnonymousGrantResponse(
    Guid GrantId,
    string DisplayName,
    string? Email,
    string Permission,
    DateTime LastSeenAt,
    Guid ViaLinkId
);
