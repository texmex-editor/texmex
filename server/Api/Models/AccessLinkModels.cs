using System.ComponentModel.DataAnnotations;

namespace TexMex.Api.Models;

public record CreateAccessLinkRequest(
    [property: Required(ErrorMessage = "Permission is required."),
               RegularExpression("^(editor|viewer)$",
                   ErrorMessage = "Permission must be 'editor' or 'viewer'.")]
    string Permission,
    [property: Range(1, int.MaxValue, ErrorMessage = "Max uses must be at least 1.")]
    int? MaxUses
);

public record AccessLinkResponse(
    Guid Id,
    string Token,
    string Permission,
    bool IsActive,
    DateTime CreatedAt,
    int? MaxUses,
    int UseCount
);

public record JoinResponse(
    Guid DocumentId,
    string Title,
    string OwnerDisplayName,
    string Role
);
