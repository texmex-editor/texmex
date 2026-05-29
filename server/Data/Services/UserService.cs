using Isopoh.Cryptography.Argon2;
using Microsoft.EntityFrameworkCore;
using TexMex.Data.Schemas;

namespace TexMex.Data.Services;

/// Central holder for session duration, populated from configuration at startup
/// (Program.cs). Static so it can be read without changing method signatures that
/// would ripple into other Api/ files.
public static class SessionConfig
{
    public static int DurationDays { get; set; } = 30;
}

public class UserService(TexMexDbContext db)
{
    public async Task<User> CreateUserAsync(string email, string displayName, string password)
    {
        // Argon2.Hash is synchronous and CPU-heavy — offload to the thread pool so it
        // doesn't block the async request pipeline under concurrent registrations.
        var hash = await Task.Run(() => Argon2.Hash(password));
        var user = new User
        {
            Email = email.Trim().ToLowerInvariant(),
            DisplayName = displayName.Trim(),
            PasswordHash = hash,
        };

        db.Users.Add(user);
        await db.SaveChangesAsync();

        return user;
    }

    public async Task<User?> ValidateCredentialsAsync(string email, string password)
    {
        var user = await db.Users
            .FirstOrDefaultAsync(u => u.Email == email.Trim().ToLowerInvariant());

        if (user?.PasswordHash is null)
            return null;

        // Offload the CPU-bound verify to the thread pool to avoid blocking under concurrent logins.
        var ok = await Task.Run(() => Argon2.Verify(user.PasswordHash, password));
        return ok ? user : null;
    }

    public async Task<UserSession> CreateSessionAsync(Guid userId)
    {
        var session = new UserSession
        {
            UserId = userId,
            ExpiresAt = DateTime.UtcNow.AddDays(SessionConfig.DurationDays),
        };

        db.UserSessions.Add(session);
        await db.SaveChangesAsync();

        return session;
    }

    public async Task<User?> GetByEmailAsync(string email)
    {
        return await db.Users
            .FirstOrDefaultAsync(u => u.Email == email.Trim().ToLowerInvariant());
    }

    public async Task<UserSession?> GetSessionAsync(Guid sessionId)
    {
        return await db.UserSessions
            .Include(s => s.User)
            .FirstOrDefaultAsync(s => s.Id == sessionId && s.ExpiresAt > DateTime.UtcNow);
    }

    public async Task DeleteSessionAsync(Guid sessionId)
    {
        var session = await db.UserSessions.FindAsync(sessionId);

        if (session is not null)
        {
            db.UserSessions.Remove(session);
            await db.SaveChangesAsync();
        }
    }

    /// Deletes every session for a user EXCEPT the one to keep (the caller's current session).
    /// Used by change-password / change-email to log the account out everywhere else.
    public async Task DeleteOtherSessionsAsync(Guid userId, Guid keepSessionId)
    {
        await db.UserSessions
            .Where(s => s.UserId == userId && s.Id != keepSessionId)
            .ExecuteDeleteAsync();
    }

    /// Verifies a plaintext password against a known user's stored hash. Returns false for
    /// external/OAuth users (no PasswordHash). Offloads the CPU-bound Argon2 verify off the request thread.
    public async Task<bool> VerifyPasswordAsync(User user, string password)
    {
        if (user.PasswordHash is null)
            return false;
        return await Task.Run(() => Argon2.Verify(user.PasswordHash, password));
    }

    public async Task UpdateDisplayNameAsync(User user, string displayName)
    {
        user.DisplayName = displayName.Trim();
        await db.SaveChangesAsync();
    }

    public async Task ChangePasswordAsync(User user, string newPassword)
    {
        user.PasswordHash = await Task.Run(() => Argon2.Hash(newPassword));
        await db.SaveChangesAsync();
    }

    /// Sets the user's email to the given ALREADY-NORMALIZED (trimmed + lowercased) value.
    /// May throw DbUpdateException with Postgres 23505 if the email is taken (unique index) —
    /// the caller pre-checks but must also catch this for the check-then-save race.
    public async Task ChangeEmailAsync(User user, string normalizedEmail)
    {
        user.Email = normalizedEmail;
        await db.SaveChangesAsync();
    }
}
