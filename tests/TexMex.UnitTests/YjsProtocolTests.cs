using TexMex.WebSockets;

namespace TexMex.UnitTests;

/// The wire-format parser. Highest-value class in the suite: this is where the silent
/// length-prefix data-loss bug lived (every WS edit was being dropped from the server-side
/// Y.Doc). These tests assert at the byte level.
///
/// y-websocket message layout: [messageType varUint][syncType varUint][varUint len][payload...]
///   messageType 0 = sync, 1 = awareness
///   syncType 0 = SyncStep1 (state vector), 1 = SyncStep2 (diff), 2 = Update
public class YjsProtocolTests
{
    private const byte Sync = 0;
    private const byte Awareness = 1;
    private const byte SyncStep1 = 0;
    private const byte SyncStep2 = 1;
    private const byte SyncUpdate = 2;

    [Fact]
    public void TryExtractUpdate_SyncUpdate_ReturnsRawUpdateWithoutLengthPrefix()
    {
        // [sync][update][len=3][A B C] — the parser must strip the len prefix and hand back {A,B,C},
        // because ApplyV1 expects the raw update, not the length-prefixed wire form.
        byte[] msg = [Sync, SyncUpdate, 3, 0xAA, 0xBB, 0xCC];

        var ok = YjsProtocol.TryExtractUpdate(msg, msg.Length, out var update);

        Assert.True(ok);
        Assert.Equal(new byte[] { 0xAA, 0xBB, 0xCC }, update.ToArray());
    }

    [Fact]
    public void TryExtractUpdate_SyncStep2_ReturnsUpdate()
    {
        byte[] msg = [Sync, SyncStep2, 2, 0x10, 0x20];

        var ok = YjsProtocol.TryExtractUpdate(msg, msg.Length, out var update);

        Assert.True(ok);
        Assert.Equal(new byte[] { 0x10, 0x20 }, update.ToArray());
    }

    [Fact]
    public void TryExtractUpdate_SyncStep1_ReturnsFalse()
    {
        // State-vector messages must NOT be applied as document updates.
        byte[] msg = [Sync, SyncStep1, 1, 0x00];

        var ok = YjsProtocol.TryExtractUpdate(msg, msg.Length, out _);

        Assert.False(ok);
    }

    [Fact]
    public void TryExtractUpdate_AwarenessMessage_ReturnsFalse()
    {
        // Awareness (presence/cursors) is not document content.
        byte[] msg = [Awareness, 0x05, 0x01, 0x02, 0x03];

        var ok = YjsProtocol.TryExtractUpdate(msg, msg.Length, out _);

        Assert.False(ok);
    }

    [Fact]
    public void TryExtractUpdate_TruncatedMessage_ReturnsFalseWithoutThrowing()
    {
        // Too short to contain messageType + syncType + length — must bail, not crash the receive loop.
        byte[] msg = [Sync, SyncUpdate];

        var ok = YjsProtocol.TryExtractUpdate(msg, msg.Length, out _);

        Assert.False(ok);
    }

    [Fact]
    public void TryExtractUpdate_LengthPrefixExceedsPayload_ReturnsFalse()
    {
        // Claims a 99-byte update but only 2 bytes follow — defends against a crafted length
        // pointing past the buffer.
        byte[] msg = [Sync, SyncUpdate, 99, 0xAA, 0xBB];

        var ok = YjsProtocol.TryExtractUpdate(msg, msg.Length, out _);

        Assert.False(ok);
    }

    [Fact]
    public void IsDocumentUpdate_TrueOnlyForSyncUpdate()
    {
        byte[] update = [Sync, SyncUpdate, 1, 0x00];
        byte[] step2 = [Sync, SyncStep2, 1, 0x00];
        byte[] awareness = [Awareness, 0x01, 0x00];

        Assert.True(YjsProtocol.IsDocumentUpdate(update, update.Length));
        Assert.False(YjsProtocol.IsDocumentUpdate(step2, step2.Length));
        Assert.False(YjsProtocol.IsDocumentUpdate(awareness, awareness.Length));
    }

    [Fact]
    public void IsSyncWrite_TrueForStep2AndUpdate_FalseForStep1AndAwareness()
    {
        // The read-only gate drops any client→server doc state. SyncStep2 (a reconnecting client's
        // diff) and SyncUpdate (a live edit) both count; SyncStep1 (state-vector request) and
        // awareness do not. isUpdate must distinguish a live edit from a sync-handshake reply.
        byte[] update = [Sync, SyncUpdate, 1, 0x00];
        byte[] step2 = [Sync, SyncStep2, 1, 0x00];
        byte[] step1 = [Sync, SyncStep1, 1, 0x00];
        byte[] awareness = [Awareness, 0x01, 0x00];

        Assert.True(YjsProtocol.IsSyncWrite(update, update.Length, out var u1));
        Assert.True(u1); // a live edit → caller notifies permission_denied

        Assert.True(YjsProtocol.IsSyncWrite(step2, step2.Length, out var u2));
        Assert.False(u2); // automatic handshake reply → caller drops silently

        Assert.False(YjsProtocol.IsSyncWrite(step1, step1.Length, out _));
        Assert.False(YjsProtocol.IsSyncWrite(awareness, awareness.Length, out _));
    }

    [Fact]
    public void BuildSyncStep1_WrapsStateVectorInCorrectEnvelope()
    {
        // The server requests the client's state on connect as a sync step 1:
        // [sync][step1][len][...stateVector].
        byte[] stateVector = [0x01, 0x02];

        var msg = YjsProtocol.BuildSyncStep1(stateVector);

        Assert.Equal(new byte[] { Sync, SyncStep1, 2, 0x01, 0x02 }, msg);
    }

    [Fact]
    public void BuildSyncStep1_EmptyStateVector_EncodesZeroLength()
    {
        // An empty state vector ("I have nothing — send me everything") is valid and must encode
        // as a well-formed message with a zero length prefix and no payload.
        var msg = YjsProtocol.BuildSyncStep1(ReadOnlySpan<byte>.Empty);

        Assert.Equal(new byte[] { Sync, SyncStep1, 0 }, msg);
    }

    [Fact]
    public void BuildSyncStep2_WrapsUpdateInCorrectEnvelope()
    {
        // The server pushes its state on connect as a sync step 2; the envelope must be
        // [sync][step2][len][...update].
        byte[] update = [0xAA, 0xBB, 0xCC];

        var msg = YjsProtocol.BuildSyncStep2(update);

        Assert.Equal(new byte[] { Sync, SyncStep2, 3, 0xAA, 0xBB, 0xCC }, msg);
    }

    [Fact]
    public void BuildSyncStep2_ThenTryExtractUpdate_RoundTrips()
    {
        // Encode and decode are inverses — what the server sends, the parser recovers.
        byte[] original = [0x01, 0x02, 0x03, 0x04, 0x05];

        var wire = YjsProtocol.BuildSyncStep2(original);
        var ok = YjsProtocol.TryExtractUpdate(wire, wire.Length, out var recovered);

        Assert.True(ok);
        Assert.Equal(original, recovered.ToArray());
    }

    [Fact]
    public void ReadVarUint_MultiByteValue_DecodesCorrectly()
    {
        // 300 = 0b1_0010_1100 → LEB128 [0xAC, 0x02].
        byte[] data = [0xAC, 0x02];
        var offset = 0;

        var value = YjsProtocol.ReadVarUint(data, ref offset, data.Length);

        Assert.Equal(300u, value);
        Assert.Equal(2, offset);
    }

    [Fact]
    public void ReadVarUint_OverflowBeyondUint32_StopsWithoutLooping()
    {
        // Six continuation bytes (all 0x80|...) would shift past 32 bits. The guard must stop
        // accumulating rather than loop or shift into undefined territory.
        byte[] data = [0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x01];
        var offset = 0;

        var value = YjsProtocol.ReadVarUint(data, ref offset, data.Length);

        // Exact value isn't meaningful past the guard; the contract is "returns, doesn't hang".
        Assert.True(offset <= data.Length);
    }
}
