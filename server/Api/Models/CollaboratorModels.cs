using System.ComponentModel.DataAnnotations;

namespace TexMex.Api.Models;

public record AddCollaboratorRequest(
    [property: Required(ErrorMessage = "Email is required."),
               EmailAddress(ErrorMessage = "Enter a valid email address."),
               MaxLength(255, ErrorMessage = "Email is too long.")]
    string Email,
    [property: Required(ErrorMessage = "Role is required."),
               RegularExpression("^(editor|viewer)$",
                   ErrorMessage = "Role must be 'editor' or 'viewer'.")]
    string Role
);

public record UpdateCollaboratorRoleRequest(
    [property: Required(ErrorMessage = "Role is required."),
               RegularExpression("^(editor|viewer)$",
                   ErrorMessage = "Role must be 'editor' or 'viewer'.")]
    string Role
);

public record CollaboratorResponse(
    Guid UserId,
    string Email,
    string DisplayName,
    string Role,
    DateTime AddedAt
);

public record CollaboratorListResponse(
    IEnumerable<CollaboratorResponse> Collaborators,
    IEnumerable<AnonymousGrantResponse> AnonymousUsers
);
