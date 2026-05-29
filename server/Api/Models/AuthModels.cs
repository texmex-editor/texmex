using System.ComponentModel.DataAnnotations;

namespace TexMex.Api.Models;

public record RegisterRequest(
    [property: Required(ErrorMessage = "Email is required."),
               EmailAddress(ErrorMessage = "Enter a valid email address."),
               MaxLength(255, ErrorMessage = "Email is too long.")]
    string Email,
    [property: Required(ErrorMessage = "Display name is required."),
               MinLength(3, ErrorMessage = "Display name must be at least 3 characters."),
               MaxLength(30, ErrorMessage = "Display name can be at most 30 characters."),
               RegularExpression(@"^[a-zA-Z0-9._ ]+$",
                   ErrorMessage = "Display name can only contain letters, numbers, dots, spaces and underscores.")]
    string DisplayName,
    [property: Required(ErrorMessage = "Password is required."),
               MinLength(8, ErrorMessage = "Password must be at least 8 characters."),
               MaxLength(128, ErrorMessage = "Password is too long.")]
    string Password
);

public record LoginRequest(
    [property: Required(ErrorMessage = "Email is required."),
               EmailAddress(ErrorMessage = "Enter a valid email address."),
               MaxLength(255, ErrorMessage = "Email is too long.")]
    string Email,
    [property: Required(ErrorMessage = "Password is required."),
               MinLength(8, ErrorMessage = "Password must be at least 8 characters."),
               MaxLength(128, ErrorMessage = "Password is too long.")]
    string Password
);

public record AuthResponse(Guid Id, string Email, string DisplayName);

public record UpdateMeRequest(
    [property: Required(ErrorMessage = "Display name is required."),
               MinLength(3, ErrorMessage = "Display name must be at least 3 characters."),
               MaxLength(30, ErrorMessage = "Display name can be at most 30 characters."),
               RegularExpression(@"^[a-zA-Z0-9._ ]+$",
                   ErrorMessage = "Display name can only contain letters, numbers, dots, spaces and underscores.")]
    string DisplayName
);

public record ChangePasswordRequest(
    [property: Required(ErrorMessage = "Current password is required.")]
    string CurrentPassword,
    [property: Required(ErrorMessage = "New password is required."),
               MinLength(8, ErrorMessage = "New password must be at least 8 characters."),
               MaxLength(128, ErrorMessage = "New password is too long.")]
    string NewPassword
);

public record ChangeEmailRequest(
    [property: Required(ErrorMessage = "Email is required."),
               EmailAddress(ErrorMessage = "Enter a valid email address."),
               MaxLength(255, ErrorMessage = "Email is too long.")]
    string NewEmail,
    [property: Required(ErrorMessage = "Current password is required.")]
    string CurrentPassword
);
