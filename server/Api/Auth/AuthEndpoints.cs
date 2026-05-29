using Microsoft.EntityFrameworkCore;
using Npgsql;
using TexMex.Api.Models;
using TexMex.Data.Services;

namespace TexMex.Api.Auth;

public static class AuthEndpoints
{
    private const string CookieName = "texmex_session";
    private static readonly TimeSpan SessionDuration = TimeSpan.FromDays(SessionConfig.DurationDays);

    public static void MapAuthEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/auth");

        group.MapPost("/register", async (RegisterRequest request, UserService userService, HttpContext context) =>
        {
            try
            {
                var user = await userService.CreateUserAsync(request.Email, request.DisplayName, request.Password);
                var session = await userService.CreateSessionAsync(user.Id);

                SetSessionCookie(context, session.Id);

                return Results.Ok(new AuthResponse(user.Id, user.Email, user.DisplayName));
            }
            catch (DbUpdateException ex) when (ex.InnerException is PostgresException { SqlState: "23505" })
            {
                return Results.Problem(detail: "Email already registered", statusCode: 409);
            }
        }).WithTags("Auth")
          .WithSummary("Registers a new user.")
          .Produces<AuthResponse>(StatusCodes.Status200OK)
          .Produces(StatusCodes.Status409Conflict);

        group.MapPost("/login", async (LoginRequest request, UserService userService, HttpContext context) =>
        {
            var user = await userService.ValidateCredentialsAsync(request.Email, request.Password);

            if (user is null)
                return Results.Problem(detail: "Invalid email or password", statusCode: 401);

            var session = await userService.CreateSessionAsync(user.Id);

            SetSessionCookie(context, session.Id);

            return Results.Ok(new AuthResponse(user.Id, user.Email, user.DisplayName));
        }).WithTags("Auth")
          .WithSummary("Logs in a user.")
          .Produces<AuthResponse>(StatusCodes.Status200OK)
          .Produces(StatusCodes.Status401Unauthorized);

        group.MapGet("/me", async (UserService userService, HttpContext context) =>
        {
            var user = await AuthHelper.GetCurrentUserAsync(context, userService);

            if (user is null)
                return Results.Problem(detail: "Not authenticated", statusCode: 401);

            return Results.Ok(new AuthResponse(user.Id, user.Email, user.DisplayName));
        }).WithTags("Auth")
          .WithSummary("Returns the currently logged in user.")
          .Produces<AuthResponse>(StatusCodes.Status200OK)
          .Produces(StatusCodes.Status401Unauthorized);

        // PATCH /api/auth/me — update the current user's display name.
        group.MapPatch("/me", async (UpdateMeRequest request, UserService userService, HttpContext context) =>
        {
            var user = await AuthHelper.GetCurrentUserAsync(context, userService);
            if (user is null)
                return Results.Problem(detail: "Not authenticated", statusCode: 401);

            // The validator enforces MinLength(3) on the raw string, but a value of all spaces would
            // pass and trim to empty — guard the trimmed length explicitly.
            if (request.DisplayName.Trim().Length < 3)
                return Results.Problem(detail: "Display name must be at least 3 characters", statusCode: 400);

            await userService.UpdateDisplayNameAsync(user, request.DisplayName);
            return Results.Ok(new AuthResponse(user.Id, user.Email, user.DisplayName));
        }).WithTags("Auth")
          .WithSummary("Updates the current user's display name.")
          .Produces<AuthResponse>(StatusCodes.Status200OK)
          .Produces(StatusCodes.Status400BadRequest)
          .Produces(StatusCodes.Status401Unauthorized);

        // POST /api/auth/change-password — requires the current password; logs out other sessions.
        group.MapPost("/change-password", async (ChangePasswordRequest request, UserService userService, HttpContext context) =>
        {
            var user = await AuthHelper.GetCurrentUserAsync(context, userService);
            if (user is null)
                return Results.Problem(detail: "Not authenticated", statusCode: 401);
            if (user.PasswordHash is null)
                return Results.Problem(detail: "This account has no password (external login)", statusCode: 400);
            if (!await userService.VerifyPasswordAsync(user, request.CurrentPassword))
                return Results.Problem(detail: "Current password is incorrect", statusCode: 401);

            await userService.ChangePasswordAsync(user, request.NewPassword);

            // Invalidate every other session (keep the caller's) so a leaked/old session can't persist.
            if (GetCurrentSessionId(context) is { } sid)
                await userService.DeleteOtherSessionsAsync(user.Id, sid);

            return Results.Ok(new { message = "Password changed" });
        }).WithTags("Auth")
          .WithSummary("Changes the current user's password (requires the current password).")
          .Produces(StatusCodes.Status200OK)
          .Produces(StatusCodes.Status400BadRequest)
          .Produces(StatusCodes.Status401Unauthorized);

        // POST /api/auth/change-email — requires the current password; logs out other sessions.
        group.MapPost("/change-email", async (ChangeEmailRequest request, UserService userService, HttpContext context) =>
        {
            var user = await AuthHelper.GetCurrentUserAsync(context, userService);
            if (user is null)
                return Results.Problem(detail: "Not authenticated", statusCode: 401);
            if (user.PasswordHash is null)
                return Results.Problem(detail: "This account has no password (external login)", statusCode: 400);
            if (!await userService.VerifyPasswordAsync(user, request.CurrentPassword))
                return Results.Problem(detail: "Current password is incorrect", statusCode: 401);

            var newEmail = request.NewEmail.Trim().ToLowerInvariant();
            if (newEmail == user.Email)
                return Results.Ok(new AuthResponse(user.Id, user.Email, user.DisplayName)); // no-op

            // Pre-check, then catch the unique-violation for the check-then-save race.
            var existing = await userService.GetByEmailAsync(newEmail);
            if (existing is not null && existing.Id != user.Id)
                return Results.Problem(detail: "Email already registered", statusCode: 409);

            try
            {
                await userService.ChangeEmailAsync(user, newEmail);
            }
            catch (DbUpdateException ex) when (ex.InnerException is PostgresException { SqlState: "23505" })
            {
                return Results.Problem(detail: "Email already registered", statusCode: 409);
            }

            // Email is the login identifier — log out other sessions, symmetric with password change.
            if (GetCurrentSessionId(context) is { } sid)
                await userService.DeleteOtherSessionsAsync(user.Id, sid);

            return Results.Ok(new AuthResponse(user.Id, user.Email, user.DisplayName));
        }).WithTags("Auth")
          .WithSummary("Changes the current user's email (requires the current password).")
          .Produces<AuthResponse>(StatusCodes.Status200OK)
          .Produces(StatusCodes.Status400BadRequest)
          .Produces(StatusCodes.Status401Unauthorized)
          .Produces(StatusCodes.Status409Conflict);

        group.MapPost("/logout", async (UserService userService, HttpContext context) =>
        {
            var cookieValue = context.Request.Cookies[CookieName];

            if (cookieValue is not null && Guid.TryParse(cookieValue, out var sessionId))
            {
                await userService.DeleteSessionAsync(sessionId);
            }

            var isDevelopment = context.RequestServices.GetRequiredService<IWebHostEnvironment>().IsDevelopment();
            var deleteOptions = new CookieOptions
            {
                HttpOnly = true,
                SameSite = SameSiteMode.Strict,
                Secure = !isDevelopment,
                Path = "/",
            };

            context.Response.Cookies.Delete(CookieName, deleteOptions);
            context.Response.Cookies.Delete("texmex_anonymous_grant", deleteOptions);

            return Results.Ok(new { message = "Logged out" });
        }).WithTags("Auth")
          .WithSummary("Logs out the current user.")
          .Produces(StatusCodes.Status200OK);
    }

    private static Guid? GetCurrentSessionId(HttpContext context)
    {
        var cookieValue = context.Request.Cookies[CookieName];
        return cookieValue is not null && Guid.TryParse(cookieValue, out var id) ? id : null;
    }

    private static void SetSessionCookie(HttpContext context, Guid sessionId)
    {
        var isDevelopment = context.RequestServices.GetRequiredService<IWebHostEnvironment>().IsDevelopment();

        context.Response.Cookies.Append(CookieName, sessionId.ToString(), new CookieOptions
        {
            HttpOnly = true,
            SameSite = SameSiteMode.Strict,
            Secure = !isDevelopment,
            Path = "/",
            MaxAge = SessionDuration,
        });
    }
}
