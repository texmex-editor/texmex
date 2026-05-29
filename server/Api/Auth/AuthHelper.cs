using TexMex.Data.Schemas;
using TexMex.Data.Services;

namespace TexMex.Api.Auth;

/// Shared helper used by all authenticated endpoints to get the logged-in user from the session cookie.
public static class AuthHelper
{
    private const string CookieName = "texmex_session";
    private const string AnonymousGrantCookieName = "texmex_anonymous_grant";

    /// Reads the session cookie, validates it, and returns the user or null if not logged in.
    public static async Task<User?> GetCurrentUserAsync(HttpContext context, UserService userService)
    {
        var cookieValue = context.Request.Cookies[CookieName];

        if (cookieValue is null || !Guid.TryParse(cookieValue, out var sessionId))
            return null;

        var session = await userService.GetSessionAsync(sessionId);
        return session?.User;
    }

    /// Reads the anonymous grant cookie and returns the grant if valid.
    public static async Task<AnonymousAccessGrant?> GetAnonymousGrantAsync(
        HttpContext context, DocumentService documentService)
    {
        var cookieValue = context.Request.Cookies[AnonymousGrantCookieName];

        if (cookieValue is null || !Guid.TryParse(cookieValue, out var grantId))
            return null;

        var grant = await documentService.GetAnonymousGrantByIdAsync(grantId);
        if (grant is null || !grant.AccessLink.IsActive)
            return null;

        return grant;
    }

    /// Sets the anonymous grant cookie.
    public static void SetAnonymousGrantCookie(HttpContext context, Guid grantId)
    {
        var isDevelopment = context.RequestServices.GetRequiredService<IWebHostEnvironment>().IsDevelopment();

        context.Response.Cookies.Append(AnonymousGrantCookieName, grantId.ToString(), new CookieOptions
        {
            HttpOnly = true,
            SameSite = SameSiteMode.Strict,
            Secure = !isDevelopment,
            Path = "/",
            MaxAge = TimeSpan.FromDays(SessionConfig.DurationDays),
        });
    }

    /// Resolves document access for any user type (owner, collaborator, anonymous grant).
    /// Returns null if not authenticated at all (→ 401).
    /// Returns a result with Role = null if authenticated but no access to this document (→ 403).
    public static async Task<DocumentAccessInfo?> ResolveAccessAsync(
        HttpContext context, Document document,
        UserService userService, DocumentService documentService)
    {
        // Path 1: Regular session auth
        var user = await GetCurrentUserAsync(context, userService);
        if (user is not null)
        {
            if (document.OwnerId == user.Id)
                return new DocumentAccessInfo(user, null, "owner");

            var collab = document.Collaborators.FirstOrDefault(c => c.UserId == user.Id);
            if (collab is not null)
                return new DocumentAccessInfo(user, null, collab.Role);

            // Logged-in user might have an anonymous access grant for this document
            var grant = await documentService.GetActiveGrantByUserAndDocumentAsync(user.Id, document.Id);
            if (grant is not null)
                return new DocumentAccessInfo(user, grant, grant.AccessLink.Permission);

            return new DocumentAccessInfo(user, null, null); // Authenticated but no access → 403
        }

        // Path 2: Anonymous grant cookie
        var anonGrant = await GetAnonymousGrantAsync(context, documentService);
        if (anonGrant is not null && anonGrant.AccessLink.DocumentId == document.Id)
            return new DocumentAccessInfo(null, anonGrant, anonGrant.AccessLink.Permission);

        return null; // Not authenticated at all → 401
    }
}

/// Result of document access resolution.
/// User is non-null if logged in. Grant is non-null if accessing via anonymous link.
/// Role is null if the user is authenticated but has no access to the document (→ 403).
public record DocumentAccessInfo(User? User, AnonymousAccessGrant? Grant, string? Role);
