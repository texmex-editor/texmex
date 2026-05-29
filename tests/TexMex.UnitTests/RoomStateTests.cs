using TexMex.WebSockets;
using TexMex.UnitTests.Helpers;

namespace TexMex.UnitTests;

/// The room lifetime refcount — the concurrency core of the SaveLock refactor. The dying-flag
/// invariant (no new acquisition after the room starts tearing down) is what prevents the
/// use-after-dispose race. "Is dying" is observed via TryAcquireLifetime returning false;
/// there's intentionally no public getter.
public class RoomStateTests
{
    [Fact]
    public void TryAcquireLifetime_FreshRoom_ReturnsTrue()
    {
        using var room = new RoomState();
        Assert.True(room.TryAcquireLifetime());
    }

    [Fact]
    public void ReleaseLifetime_LastHolder_ReturnsTrue()
    {
        using var room = new RoomState();
        room.TryAcquireLifetime();

        // Releasing the only token drives refcount to zero → caller owns teardown.
        Assert.True(room.ReleaseLifetime());
    }

    [Fact]
    public void TryAcquireLifetime_AfterMarkDying_ReturnsFalse()
    {
        using var room = new RoomState();
        room.MarkDying();

        // The invariant that prevents a new caller from grabbing a room being torn down.
        Assert.False(room.TryAcquireLifetime());
    }

    [Fact]
    public void ReleaseLifetime_NotLastHolder_ReturnsFalse_RoomStaysAlive()
    {
        using var room = new RoomState();
        room.TryAcquireLifetime();
        room.TryAcquireLifetime();

        // One of two holders releases → refcount still > 0, room not dying.
        Assert.False(room.ReleaseLifetime());
        // Still acquirable because it isn't dying.
        Assert.True(room.TryAcquireLifetime());
    }

    [Fact]
    public async Task ExportStateVectorAsync_ColdRoom_ReturnsNonNullWithoutThrowing()
    {
        // The connect handler calls this on every join, including the very first (empty doc).
        // It must never return null or throw — an empty state vector is the valid "I have nothing"
        // request that pulls the client's full state.
        using var room = new RoomState();

        var sv = await room.ExportStateVectorAsync();

        Assert.NotNull(sv);
    }

    [Fact]
    public async Task ExportStateVectorAsync_PopulatedRoom_ReflectsContent()
    {
        // After loading content, the state vector must grow beyond the cold-room baseline —
        // it's what tells a reconnecting client which of its local edits the server still lacks.
        using var room = new RoomState();
        var coldVector = await room.ExportStateVectorAsync();

        await room.LoadFromDbAsync(YjsTestHelpers.BuildState(("main", "hello world")));
        var loadedVector = await room.ExportStateVectorAsync();

        Assert.True(loadedVector.Length > coldVector.Length,
            "a populated doc's state vector must encode client/clock info absent from an empty doc");
    }
}
