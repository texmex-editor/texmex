using Microsoft.EntityFrameworkCore;

namespace TexMex.Data.Services;

/// Background service that periodically purges expired user sessions from the DB.
/// Runs hourly; deletes UserSession rows whose ExpiresAt has passed.
/// Pattern mirrors RoomPersistenceService: uses IServiceScopeFactory to obtain a
/// scoped DbContext and ExecuteDeleteAsync for an efficient set-based delete.
public class SessionGcService(IServiceScopeFactory scopeFactory, ILogger<SessionGcService> logger) : BackgroundService
{
    private static readonly TimeSpan SweepInterval = TimeSpan.FromHours(1);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await Task.Delay(SweepInterval, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                break; // Shutdown requested
            }

            try
            {
                using var scope = scopeFactory.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<TexMexDbContext>();

                var now = DateTime.UtcNow;
                var deleted = await db.UserSessions
                    .Where(s => s.ExpiresAt < now)
                    .ExecuteDeleteAsync(stoppingToken);

                if (deleted > 0)
                    logger.LogDebug("Session GC removed {Count} expired session(s)", deleted);
            }
            catch (OperationCanceledException)
            {
                break; // Shutdown requested mid-sweep
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Session GC sweep failed");
            }
        }
    }
}
