using System.Collections.Concurrent;
using System.Net.WebSockets;
using TexMex.Api.Auth;
using TexMex.Data.Services;

namespace TexMex.WebSockets;

public static class YjsRelayMiddleware
{
    internal static readonly ConcurrentDictionary<string, RoomState> Rooms = new();

    /// Returns the loaded RoomState for a document, or null if no room is currently
    /// loaded. Does NOT rehydrate from disk — use this when the caller wants a cheap
    /// "is the doc hot?" check (e.g., computing live file sizes for the file-list
    /// endpoint without paying the rehydration tax for cold docs).
    public static RoomState? TryGetLoadedRoom(Guid documentId)
    {
        return Rooms.TryGetValue(documentId.ToString(), out var room) ? room : null;
    }

    // ── Room lifecycle ──────────────────────────────────────────────
    // EnsureRoomAsync / ReleaseRoomAsync are the single entry points for room acquisition.
    // SaveLock now lives on RoomState (no separate master dict — no unbounded growth).

    /// Atomically gets-or-creates a room and acquires one lifetime token on it. Returns a
    /// RoomState with refcount incremented; caller MUST eventually call ReleaseRoomAsync.
    ///
    /// If the room found in the dict is dying (refcount already drove to zero somewhere else),
    /// this method removes that stale entry and loops to create a fresh one — so callers never
    /// see a removed-from-dict or about-to-be-disposed room.
    ///
    /// `loadStateAsync` is invoked once, only on the caller that actually creates the room.
    /// Subsequent acquirers skip the load — their later operations serialize against the
    /// load via the room's _docLock (LoadFromDbAsync is idempotent and holds _docLock).
    internal static async Task<RoomState> EnsureRoomAsync(Guid documentId, Func<Task<byte[]?>> loadStateAsync)
    {
        var roomName = documentId.ToString();
        while (true)
        {
            bool isCreator = false;
            var room = Rooms.GetOrAdd(roomName, _ =>
            {
                isCreator = true;
                return new RoomState();
            });

            if (room.TryAcquireLifetime())
            {
                if (isCreator)
                {
                    try
                    {
                        var dbState = await loadStateAsync();
                        await room.LoadFromDbAsync(dbState);
                    }
                    catch
                    {
                        // Release the lifetime we just acquired so the room disposes cleanly
                        // instead of leaking — caller won't get a reference to release through.
                        if (room.ReleaseLifetime())
                        {
                            Rooms.TryRemove(new KeyValuePair<string, RoomState>(roomName, room));
                            room.Dispose();
                        }
                        throw;
                    }
                }
                return room;
            }

            // The room is dying. Remove its (now stale) entry from the dict so the next loop
            // iteration's GetOrAdd creates a fresh room. TryRemove with the key+value overload
            // ensures we only remove if it's still the same instance — if another thread has
            // already swapped it, our removal is a no-op and the retry will see the new room.
            Rooms.TryRemove(new KeyValuePair<string, RoomState>(roomName, room));
        }
    }

    /// Releases one lifetime token. If this release drives refcount to zero, this method
    /// owns teardown: it removes the room from the dict, persists pending dirty state via
    /// `saveStateAsync`, and disposes the room. `saveStateAsync` may be null when persistence
    /// is undesirable (e.g., immediately after version restore which already wrote DB state).
    internal static async Task ReleaseRoomAsync(Guid documentId, RoomState room, Func<byte[], Task>? saveStateAsync)
    {
        if (!room.ReleaseLifetime()) return;

        var roomName = documentId.ToString();

        // Drove refcount to zero. ReleaseLifetime already marked dying so no new acquirers
        // can join. Remove from the dict and run teardown.
        Rooms.TryRemove(new KeyValuePair<string, RoomState>(roomName, room));

        try
        {
            if (room.IsDirty && saveStateAsync is not null)
            {
                var state = await room.ExportStateAsync();
                await saveStateAsync(state);
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[texmex] Warning: Failed to persist room '{roomName}' state on release: {ex.Message}");
        }
        finally
        {
            room.Dispose();
        }
    }

    public static void MapYjsRelay(this WebApplication app)
    {
        // Room name = document ID. Auth: session cookie → owner/collaborator/anonymous grant.
        app.Map("/ws/{documentId:guid}", async (HttpContext context, Guid documentId, UserService userService, DocumentService documentService, IServiceScopeFactory scopeFactory) =>
        {
            if (!context.WebSockets.IsWebSocketRequest)
            {
                context.Response.StatusCode = 400;
                await context.Response.WriteAsync("WebSocket requests only");
                return;
            }

            // Check identity first — prevents document enumeration via 404 vs 401
            var user = await AuthHelper.GetCurrentUserAsync(context, userService);
            var hasAnonymousGrant = context.Request.Cookies.ContainsKey("texmex_anonymous_grant");
            if (user is null && !hasAnonymousGrant)
            {
                context.Response.StatusCode = 401;
                await context.Response.WriteAsync("Not authenticated");
                return;
            }

            // Load the document (caller is at least identified)
            var document = await documentService.GetByIdAsync(documentId);
            if (document is null)
            {
                context.Response.StatusCode = 404;
                await context.Response.WriteAsync("Document not found");
                return;
            }

            // Resolve access: owner → collaborator → anonymous grant (logged-in) → anonymous grant (cookie)
            var access = await AuthHelper.ResolveAccessAsync(context, document, userService, documentService);
            if (access is null)
            {
                context.Response.StatusCode = 403;
                await context.Response.WriteAsync("Forbidden");
                return;
            }
            if (access.Role is null)
            {
                context.Response.StatusCode = 403;
                await context.Response.WriteAsync("Forbidden");
                return;
            }

            var isReadOnly = access.Role != "owner" && access.Role != "editor";

            // Auth passed — accept the WebSocket and join the room
            var roomName = documentId.ToString();
            var ws = await context.WebSockets.AcceptWebSocketAsync(new WebSocketAcceptContext
            {
                KeepAliveInterval = TimeSpan.FromSeconds(30)
            });
            var clientInfo = new ClientInfo(
                new SemaphoreSlim(1, 1),
                isReadOnly,
                access.User?.Id,
                access.Grant?.Id,
                access.User?.DisplayName ?? access.Grant?.DisplayName ?? "Unknown");

            // Acquire a lifetime token on the room. EnsureRoomAsync handles the get-or-create,
            // loads state from DB if this is the creator, and retries against a dying room.
            // The request-scoped documentService is alive for the entire WS connection, so we
            // can pass it directly into the load closure (no scope creation needed here).
            var roomState = await EnsureRoomAsync(documentId, () => documentService.GetStateAsync(documentId));
            roomState.Clients.TryAdd(ws, clientInfo);

            // Push the server's current state to the connecting client as sync step 2. Without
            // this the server is a passive relay — a single client reconnecting from a cold tab
            // (no peer to sync from) would never receive persisted edits even though they're in
            // the DB. The client's WebsocketProvider will apply this update and reconcile against
            // any local state it has via the standard y-protocols sync handshake.
            try
            {
                var initialState = await roomState.ExportStateAsync();
                if (initialState.Length > 0)
                {
                    var syncStep2 = YjsProtocol.BuildSyncStep2(initialState);
                    await clientInfo.SendLock.WaitAsync();
                    try
                    {
                        await ws.SendAsync(syncStep2, WebSocketMessageType.Binary, true, CancellationToken.None);
                    }
                    finally
                    {
                        clientInfo.SendLock.Release();
                    }
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[texmex] Warning: Failed to send initial state to '{clientInfo.DisplayName}': {ex.Message}");
            }

            // Request the client's state via sync step 1. The sync step 2 above is a one-way push
            // (server → client); this completes the handshake (client → server) so a reconnecting
            // client's offline edits are pulled into the server doc and persisted. Sent even when
            // the server state is empty — the point is to ask the client for what it has. Without
            // this, offline edits only survive if another peer is online to drive the sync via
            // broadcast; a client reconnecting alone would lose them.
            //
            // Read-only clients receive this too and will reply with a sync step 2; the receive
            // loop's viewer gate drops that (see IsSyncWrite) so they can't mutate the server doc.
            try
            {
                var stateVector = await roomState.ExportStateVectorAsync();
                var syncStep1 = YjsProtocol.BuildSyncStep1(stateVector);
                await clientInfo.SendLock.WaitAsync();
                try
                {
                    await ws.SendAsync(syncStep1, WebSocketMessageType.Binary, true, CancellationToken.None);
                }
                finally
                {
                    clientInfo.SendLock.Release();
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[texmex] Warning: Failed to send sync step 1 to '{clientInfo.DisplayName}': {ex.Message}");
            }

            // Update last_seen_at for anonymous grant holders
            if (access.Grant is not null)
            {
                await documentService.UpdateGrantLastSeenAsync(access.Grant.Id);
            }

            Console.WriteLine($"[texmex] {clientInfo.DisplayName} joined room '{roomName}' as {access.Role} ({roomState.Clients.Count} clients)");

            try
            {
                const int maxMessageSize = 1_048_576; // 1 MB
                var buffer = new byte[64 * 1024];

                while (ws.State == WebSocketState.Open)
                {
                    // Read a full Yjs message (may arrive in multiple frames)
                    using var messageStream = new MemoryStream();
                    WebSocketReceiveResult result;

                    do
                    {
                        result = await ws.ReceiveAsync(new ArraySegment<byte>(buffer), CancellationToken.None);
                        if (result.MessageType == WebSocketMessageType.Close)
                            break;
                        messageStream.Write(buffer, 0, result.Count);
                        if (messageStream.Length > maxMessageSize)
                            break;
                    } while (!result.EndOfMessage);

                    if (result.MessageType == WebSocketMessageType.Close)
                        break;

                    if (messageStream.Length > maxMessageSize)
                    {
                        await ws.CloseAsync(WebSocketCloseStatus.MessageTooBig, "Message too large", CancellationToken.None);
                        break;
                    }

                    var messageBytes = messageStream.GetBuffer();
                    var messageLength = (int)messageStream.Length;

                    // Viewer gate: drop any client→server document state from read-only clients so
                    // they can never mutate the server doc. This covers both live edits (SyncUpdate)
                    // and the SyncStep2 a client sends in reply to our connect-time SyncStep1 — the
                    // latter matters for a downgraded editor that still holds local edits. We only
                    // notify (permission_denied) on an actual edit; the SyncStep2 reply is automatic
                    // protocol traffic, so dropping it silently avoids a spurious notification on
                    // every read-only connect.
                    if (clientInfo.IsReadOnly && YjsProtocol.IsSyncWrite(messageBytes, messageLength, out var isEdit))
                    {
                        if (isEdit)
                        {
                            var rejection = EncodeControlFrame(
                                """{"type":"permission_denied","message":"You do not have edit access to this document"}""");
                            await clientInfo.SendLock.WaitAsync();
                            try
                            {
                                await ws.SendAsync(rejection, WebSocketMessageType.Binary, true, CancellationToken.None);
                            }
                            finally
                            {
                                clientInfo.SendLock.Release();
                            }
                        }
                        continue;
                    }

                    // Feed updates into the server-side Y.Doc for persistence
                    if (YjsProtocol.TryExtractUpdate(messageBytes, messageLength, out var update))
                    {
                        await roomState.ApplyUpdateAsync(update.Array!, update.Offset, update.Count);
                    }

                    // Broadcast to all other clients in the room
                    var fullMessage = new ArraySegment<byte>(messageBytes, 0, messageLength);

                    foreach (var (peer, peerInfo) in roomState.Clients)
                    {
                        if (peer != ws && peer.State == WebSocketState.Open)
                        {
                            // Peer's ClientInfo may be disposed mid-iteration by its own receive loop's
                            // finally. Acquire inside the try; silently skip on ObjectDisposedException.
                            bool acquired = false;
                            try
                            {
                                await peerInfo.SendLock.WaitAsync();
                                acquired = true;
                                await peer.SendAsync(fullMessage, result.MessageType, true, CancellationToken.None);
                            }
                            catch (ObjectDisposedException)
                            {
                                // Peer cleaned up between snapshot iteration and acquire.
                            }
                            catch
                            {
                                // Peer disconnected mid-send — cleanup happens on its own receive loop.
                            }
                            finally
                            {
                                if (acquired)
                                {
                                    try { peerInfo.SendLock.Release(); } catch (ObjectDisposedException) { }
                                }
                            }
                        }
                    }
                }
            }
            catch (WebSocketException)
            {
                // Client disconnected unexpectedly
            }
            finally
            {
                roomState.Clients.TryRemove(ws, out var removedInfo);
                removedInfo?.Dispose();
                Console.WriteLine($"[texmex] {clientInfo.DisplayName} left room '{roomName}' ({roomState.Clients.Count} clients)");

                // Release our lifetime token. If this is the last release, ReleaseRoomAsync
                // persists pending state (dirty edits) and disposes the room. We pass a fresh
                // scope for the save because the WS may have been open for hours and the
                // request-scoped DbContext is not the right place for a final save.
                await ReleaseRoomAsync(documentId, roomState, async state =>
                {
                    using var scope = scopeFactory.CreateScope();
                    var scopedDocService = scope.ServiceProvider.GetRequiredService<DocumentService>();
                    await scopedDocService.SaveStateAsync(documentId, state);
                    Console.WriteLine($"[texmex] Room '{roomName}' state saved to DB on last disconnect");
                });

                if (ws.State == WebSocketState.Open)
                    await ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "Goodbye", CancellationToken.None);
            }
        });
    }

    // ── File metadata events ────────────────────────────────────────

    /// JSON options for file_event payloads. Forces camelCase wire format regardless of how
    /// the payload object's properties are named — defends against a future contributor writing
    /// `new { FileId = ... }` (PascalCase) and silently breaking the contract documented in
    /// MULTI_FILE_COLLAB.md.
    private static readonly System.Text.Json.JsonSerializerOptions _fileEventJsonOptions = new()
    {
        PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase,
    };

    /// Custom Yjs wire message type for app-level control frames (permission_denied,
    /// file_event). y-protocols reserves 0 (sync) and 1 (awareness); 2+ is free for
    /// app use, and y-websocket silently drops unknown types so this stays compatible
    /// with the upstream sync/awareness pipeline.
    ///
    /// Frame layout: [CONTROL_MESSAGE_TYPE, ...UTF-8 JSON]. The JSON keeps the existing
    /// {"type": "permission_denied" | "file_event", ...} shape so the frontend's parser
    /// barely changes — it just strips the leading byte and decodes the rest.
    ///
    /// Why binary, not text frames? y-websocket binary-decodes every incoming frame; a
    /// text frame causes a console error there. Wrapping in a binary frame with a known
    /// type byte makes the channel uniformly binary.
    private const byte CONTROL_MESSAGE_TYPE = 3;

    private static ArraySegment<byte> EncodeControlFrame(string json)
    {
        var jsonBytes = System.Text.Encoding.UTF8.GetBytes(json);
        var framed = new byte[jsonBytes.Length + 1];
        framed[0] = CONTROL_MESSAGE_TYPE;
        Buffer.BlockCopy(jsonBytes, 0, framed, 1, jsonBytes.Length);
        return new ArraySegment<byte>(framed);
    }

    /// Broadcasts a file metadata change event to all clients in a room as a JSON text message.
    /// Used by file API endpoints to notify connected editors of uploads, renames, and deletes
    /// without requiring them to poll the file list endpoint.
    /// The frontend handles these alongside Yjs binary messages — same channel as the existing
    /// permission_denied text messages.
    ///
    /// `includeReadOnlyClients`: defaults to true. Read-only clients (viewers, anonymous-grant
    /// viewers) currently need every file_event action so their UI stays in sync. Future server
    /// broadcasts that shouldn't reach read-only clients (e.g., admin/owner-only notifications)
    /// must pass false. Mirrors Overleaf's RESTRICTED_USER_MESSAGE_TYPE_PASS_LIST pattern.
    public static async Task BroadcastFileEventAsync(Guid documentId, object payload, bool includeReadOnlyClients = true)
    {
        var roomName = documentId.ToString();
        if (!Rooms.TryGetValue(roomName, out var roomState))
            return;

        var json = System.Text.Json.JsonSerializer.Serialize(payload, _fileEventJsonOptions);
        var framed = EncodeControlFrame(json);

        foreach (var (ws, clientInfo) in roomState.Clients)
        {
            // Filter read-only clients when the message isn't allowed to reach them.
            if (!includeReadOnlyClients && clientInfo.IsReadOnly) continue;

            if (ws.State != WebSocketState.Open) continue;

            // A peer's receive-loop finally can dispose its ClientInfo (and its SendLock)
            // concurrently. Acquire inside the try and silently skip on ObjectDisposedException.
            bool acquired = false;
            try
            {
                await clientInfo.SendLock.WaitAsync();
                acquired = true;
                await ws.SendAsync(framed, WebSocketMessageType.Binary, true, CancellationToken.None);
            }
            catch (ObjectDisposedException)
            {
                // Peer's ClientInfo was disposed between our snapshot iteration and acquire — gone.
            }
            catch
            {
                // Peer disconnected mid-send — will be cleaned up on its own receive loop.
            }
            finally
            {
                if (acquired)
                {
                    try { clientInfo.SendLock.Release(); } catch (ObjectDisposedException) { }
                }
            }
        }
    }

    // ── Live permission propagation ─────────────────────────────────

    /// Updates the read-only flag for all connections belonging to a specific user in a room.
    /// Called when a collaborator's role is changed via the REST API.
    public static void UpdateClientPermission(Guid documentId, Guid userId, bool isReadOnly)
    {
        var roomName = documentId.ToString();
        if (!Rooms.TryGetValue(roomName, out var roomState))
            return;

        foreach (var (_, clientInfo) in roomState.Clients)
        {
            if (clientInfo.UserId == userId)
                clientInfo.IsReadOnly = isReadOnly;
        }
    }

    /// Closes all WebSocket connections belonging to a specific user in a room.
    /// Called when a collaborator is removed via the REST API.
    public static async Task DisconnectClient(Guid documentId, Guid userId)
    {
        var roomName = documentId.ToString();
        if (!Rooms.TryGetValue(roomName, out var roomState))
            return;

        foreach (var (ws, clientInfo) in roomState.Clients)
        {
            if (clientInfo.UserId == userId && ws.State == WebSocketState.Open)
            {
                try
                {
                    await ws.CloseAsync(WebSocketCloseStatus.PolicyViolation, "Access revoked", CancellationToken.None);
                }
                catch
                {
                    // Already disconnected
                }
            }
        }
    }

    /// Closes all WebSocket connections matching the given anonymous grant IDs.
    /// Called when an anonymous access link is revoked (cascade disconnect).
    public static async Task DisconnectByGrantIds(Guid documentId, List<Guid> grantIds)
    {
        var roomName = documentId.ToString();
        if (!Rooms.TryGetValue(roomName, out var roomState))
            return;

        var grantIdSet = grantIds.ToHashSet();

        foreach (var (ws, clientInfo) in roomState.Clients)
        {
            if (clientInfo.GrantId.HasValue && grantIdSet.Contains(clientInfo.GrantId.Value) && ws.State == WebSocketState.Open)
            {
                try
                {
                    await ws.CloseAsync(WebSocketCloseStatus.PolicyViolation, "Access revoked", CancellationToken.None);
                }
                catch
                {
                    // Already disconnected
                }
            }
        }
    }

    /// Marks a room dying, removes it from the dict, and kicks all connected clients. Used by
    /// version restore to force everyone to reconnect and pick up the new state from DB.
    /// If `restoredState` is provided, the in-memory Y.Doc is replaced first so any stale
    /// references export the correct state.
    ///
    /// IMPORTANT: This method does NOT dispose the room. Disposal happens when the last
    /// lifetime token is released (typically the calling restore handler, plus any
    /// client receive-loop finallys still running). This is why the restore handler must
    /// hold a lifetime token across the call — otherwise the room could be disposed under
    /// it before SaveLock.Release() runs.
    public static async Task EvictRoom(Guid documentId, byte[]? restoredState = null)
    {
        var roomName = documentId.ToString();
        if (!Rooms.TryGetValue(roomName, out var roomState))
            return;

        // Replace the in-memory Y.Doc BEFORE marking dying. Any straggler that still holds
        // a reference (persistence service mid-iteration) exports the restored state, not the
        // old one. ReplaceStateAsync also clears IsDirty so the later teardown skips re-save.
        if (restoredState is not null)
        {
            await roomState.ReplaceStateAsync(restoredState);
        }

        // Mark dying first so any concurrent EnsureRoomAsync attempt sees this room is gone
        // and rolls forward to a fresh one. Then remove from the dict so future GetOrAdd
        // calls construct a new RoomState rather than reusing this one.
        roomState.MarkDying();
        Rooms.TryRemove(new KeyValuePair<string, RoomState>(roomName, roomState));

        var clientCount = roomState.Clients.Count;
        foreach (var (ws, _) in roomState.Clients)
        {
            if (ws.State == WebSocketState.Open)
            {
                try
                {
                    await ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "version_restored", CancellationToken.None);
                }
                catch
                {
                    // Already disconnected
                }
            }
        }

        Console.WriteLine($"[texmex] Room '{roomName}' evicted for version restore ({clientCount} clients disconnected)");
    }
}
