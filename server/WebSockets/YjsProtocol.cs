namespace TexMex.WebSockets;

/// Parses the y-websocket wire format to extract Yjs V1 updates.
/// Message layout: [messageType: varUint] [syncType: varUint] [length: varUint] [payload...]
/// messageType 0 = sync (SyncStep1/SyncStep2/Update), messageType 1 = awareness (skip).
public static class YjsProtocol
{
    private const byte MessageSync = 0;
    private const byte SyncStep1 = 0;
    private const byte SyncStep2 = 1;
    private const byte SyncUpdate = 2;

    /// Tries to extract a Yjs V1 update from a y-websocket message.
    /// Returns true + the update payload for SyncStep2 and Update messages, false for everything else.
    public static bool TryExtractUpdate(byte[] message, int length, out ArraySegment<byte> update)
    {
        update = default;

        if (length < 3)
            return false;

        var offset = 0;

        var messageType = ReadVarUint(message, ref offset, length);
        if (messageType != MessageSync)
            return false;

        var syncType = ReadVarUint(message, ref offset, length);
        if (syncType != SyncStep2 && syncType != SyncUpdate)
            return false;

        // The update payload in the y-websocket wire format is varUint-length-prefixed
        // (writeVarUint8Array in y-protocols/sync.js). Read the length, then capture exactly
        // that many bytes as the raw V1 update.
        //
        // ApplyV1 expects the raw update bytes WITHOUT the wire-level length prefix — if you
        // pass the length-prefixed form, ApplyV1 returns no error but silently produces zero
        // changes (verified by a YDotNet 0.6.0 probe). That's how this used to silently
        // drop every WS edit from the server-side Y.Doc.
        if (offset >= length)
            return false;
        var updateLength = ReadVarUint(message, ref offset, length);
        if (updateLength == 0 || offset + updateLength > length)
            return false;

        update = new ArraySegment<byte>(message, offset, (int)updateLength);
        return true;
    }

    /// Returns true if the message is a SyncUpdate (messageType=0, syncType=2) — i.e. an actual edit.
    /// SyncStep1 (syncType=0) and SyncStep2 (syncType=1) are needed for initial sync and are NOT edits.
    public static bool IsDocumentUpdate(byte[] message, int length)
    {
        if (length < 2)
            return false;

        var offset = 0;
        var messageType = ReadVarUint(message, ref offset, length);
        if (messageType != MessageSync)
            return false;

        var syncType = ReadVarUint(message, ref offset, length);
        return syncType == SyncUpdate;
    }

    /// Returns true if the message carries client→server document state — a SyncUpdate (syncType=2,
    /// a live edit) OR a SyncStep2 (syncType=1, the diff a client sends in reply to a SyncStep1).
    /// `isUpdate` distinguishes the two: true for a live edit, false for a sync-handshake reply.
    ///
    /// The read-only gate needs both: now that the server sends a SyncStep1 on connect (to pull a
    /// reconnecting client's offline edits), a read-only client — including a downgraded editor that
    /// still holds local edits — would otherwise push them back via SyncStep2 and bypass the gate.
    /// Callers drop both, but only notify (permission_denied) on `isUpdate`, since the SyncStep2 reply
    /// is automatic protocol traffic, not a user edit.
    public static bool IsSyncWrite(byte[] message, int length, out bool isUpdate)
    {
        isUpdate = false;
        if (length < 2)
            return false;

        var offset = 0;
        var messageType = ReadVarUint(message, ref offset, length);
        if (messageType != MessageSync)
            return false;

        var syncType = ReadVarUint(message, ref offset, length);
        if (syncType != SyncStep2 && syncType != SyncUpdate)
            return false;

        isUpdate = syncType == SyncUpdate;
        return true;
    }

    /// Encodes a Yjs V1 state update as a y-websocket sync step 2 message:
    ///   [messageType=0] [syncType=1] [varUint(updateLength)] [updateBytes]
    /// Used by the WS handler to push the server's persisted state to a client right after
    /// connect — without this, a client reconnecting from a cold tab (no peer to sync against)
    /// would never see edits saved on previous disconnect.
    public static byte[] BuildSyncStep2(ReadOnlySpan<byte> update) => BuildSyncMessage(SyncStep2, update);

    /// Encodes a sync step 1 message:
    ///   [messageType=0] [syncType=0] [varUint(stateVectorLength)] [stateVectorBytes]
    /// Sent by the server right after connect to REQUEST the client's state. The client replies
    /// with a sync step 2 carrying everything the server's state vector says it lacks — which is
    /// how a reconnecting client's offline edits reach the server. Without this the server is a
    /// one-way push (sync step 2 only): a client reconnecting alone (no peer to drive the sync)
    /// never gets asked for its diff, so its offline edits are silently lost on next disconnect.
    /// An empty state vector is valid and means "I have nothing — send me everything".
    public static byte[] BuildSyncStep1(ReadOnlySpan<byte> stateVector) => BuildSyncMessage(SyncStep1, stateVector);

    private static byte[] BuildSyncMessage(byte syncType, ReadOnlySpan<byte> payload)
    {
        Span<byte> lengthVarUint = stackalloc byte[5]; // varUint max 5 bytes for int32 range
        var len = payload.Length;
        var i = 0;
        while (len >= 0x80)
        {
            lengthVarUint[i++] = (byte)((len & 0x7F) | 0x80);
            len >>= 7;
        }
        lengthVarUint[i++] = (byte)len;

        var message = new byte[2 + i + payload.Length];
        message[0] = MessageSync;
        message[1] = syncType;
        lengthVarUint[..i].CopyTo(message.AsSpan(2));
        payload.CopyTo(message.AsSpan(2 + i));
        return message;
    }

    /// Reads a variable-length unsigned integer (LEB128) from the buffer.
    /// Bounded to 32 bits (5 payload bytes). Stops accumulating after the 5th byte to defend
    /// against malformed input that would otherwise shift past the int width and produce
    /// undefined/garbage values from C#'s wrap-around shift semantics.
    internal static uint ReadVarUint(byte[] data, ref int offset, int length)
    {
        uint result = 0;
        var shift = 0;

        while (offset < length)
        {
            var b = data[offset++];
            result |= (uint)(b & 0x7F) << shift;
            if ((b & 0x80) == 0)
                return result;
            shift += 7;
            // After 5 bytes (shift = 28 -> 35) we've consumed the entire uint32 range.
            // Any further continuation bytes are malformed; bail out rather than shift past 32.
            if (shift > 28)
                return result;
        }

        return result;
    }
}
