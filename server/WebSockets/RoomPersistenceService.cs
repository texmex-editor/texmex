using TexMex.Data.Services;

namespace TexMex.WebSockets;

/// Background service that periodically saves dirty room state to DB.
/// Safety net for server crashes — ensures edits are persisted even if the server dies mid-session.
public class RoomPersistenceService(IServiceScopeFactory scopeFactory, ILogger<RoomPersistenceService> logger) : BackgroundService
{
    private static readonly TimeSpan SaveInterval = TimeSpan.FromSeconds(30);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await Task.Delay(SaveInterval, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                break; // Shutdown requested
            }

            foreach (var (roomName, roomState) in YjsRelayMiddleware.Rooms)
            {
                if (!roomState.IsDirty)
                    continue;

                try
                {
                    if (!Guid.TryParse(roomName, out var documentId))
                        continue;

                    // SaveLock now lives on the room itself (no separate master dict). Try to
                    // acquire without waiting — if a version restore is mid-flight, skip this
                    // room, the restore will overwrite the state anyway.
                    if (!await roomState.SaveLock.WaitAsync(0))
                    {
                        logger.LogDebug("Skipping save for room '{RoomName}' — version restore in progress", roomName);
                        continue;
                    }

                    try
                    {
                        var state = await roomState.ExportStateAsync();

                        // Room might have been evicted (version restore) or disposed (refcount=0
                        // teardown) between our foreach snapshot and now. Bail out either way.
                        if (!YjsRelayMiddleware.Rooms.ContainsKey(roomName))
                            continue;

                        using var scope = scopeFactory.CreateScope();
                        var documentService = scope.ServiceProvider.GetRequiredService<DocumentService>();
                        await documentService.SaveStateAsync(documentId, state);
                        roomState.ClearDirty();

                        logger.LogDebug("Auto-saved room '{RoomName}' state to DB", roomName);
                    }
                    finally
                    {
                        try { roomState.SaveLock.Release(); } catch (ObjectDisposedException) { }
                    }
                }
                catch (ObjectDisposedException)
                {
                    // The room transitioned to dying and was disposed between our snapshot
                    // and the operation. Safe to skip; ReleaseRoomAsync handled persistence.
                }
                catch (Exception ex)
                {
                    logger.LogWarning(ex, "Failed to auto-save room '{RoomName}'", roomName);
                }
            }
        }
    }
}
