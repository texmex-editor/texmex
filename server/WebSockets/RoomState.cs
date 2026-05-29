using System.Collections.Concurrent;
using System.Net.WebSockets;
using YDotNet.Document;
using YDotNet.Document.Options;

namespace TexMex.WebSockets;

public class ClientInfo(SemaphoreSlim sendLock, bool isReadOnly, Guid? userId, Guid? grantId = null, string displayName = "Unknown") : IDisposable
{
    public SemaphoreSlim SendLock { get; } = sendLock;
    public bool IsReadOnly { get; set; } = isReadOnly;
    public Guid? UserId { get; } = userId;
    public Guid? GrantId { get; } = grantId;
    public string DisplayName { get; } = displayName;
    public void Dispose() => SendLock.Dispose();
}

/// Per-room server-side Y.Doc that accumulates all updates for persistence.
public class RoomState : IDisposable
{
    // Garbage collection is ENABLED on the server-side Y.Doc so deleted-item content is reclaimed
    // on commit, bounding state growth (the mainstream Yjs pattern). GC keeps the ID skeleton, so
    // identity is preserved and forward-delta restore (incl. offline-straggler anchoring) still
    // works — verified by Layer-3 26/26 under GC. See DocumentService.NewYDoc for the rationale.
    private static Doc NewDoc() => new(new DocOptions { SkipGarbageCollection = false });

    private Doc _doc = NewDoc();
    private readonly SemaphoreSlim _docLock = new(1, 1);
    private bool _loaded;

    public bool IsDirty { get; private set; }
    public ConcurrentDictionary<WebSocket, ClientInfo> Clients { get; } = new();

    /// Per-document save lock. Held across long-running operations that must be exclusive
    /// against concurrent saves and other writers — primarily version restore. The periodic
    /// persistence service uses TryAcquire(0) to skip rooms locked by an in-flight restore.
    /// Lives on RoomState (not a separate dictionary) so it's disposed exactly when the room
    /// is — no unbounded growth from stale entries after rooms go away.
    public SemaphoreSlim SaveLock { get; } = new(1, 1);

    /// Restore-in-progress gate. SaveLock alone doesn't block live WebSocket edits because
    /// ApplyUpdateAsync only takes _docLock. Without this flag, a client edit landing between
    /// the restore handler's currentState export and its EvictRoom call would (a) not be in
    /// d2, (b) be overwritten by ReplaceStateAsync(d2), and (c) still need to re-sync from
    /// the client on reconnect to recover. The flag makes ApplyUpdateAsync drop server-side
    /// applies during the restore window; the client retains the edit locally and pushes it
    /// back via the sync-step-1 handshake after eviction. volatile for cross-thread visibility.
    private volatile bool _isRestoring;
    public bool IsRestoring => _isRestoring;

    /// Marks the room as restoring. Caller (version-restore handler) MUST pair with EndRestore
    /// in a try/finally so the flag is cleared even on failure paths.
    public void BeginRestore() => _isRestoring = true;
    public void EndRestore() => _isRestoring = false;

    // ── Lifetime refcount ───────────────────────────────────────────
    // Refcount-based teardown: callers acquire a lifetime token (WS connection, REST mutation,
    // version restore) and release it when done. The release that drives the count to zero
    // marks the room dying — new TryAcquireLifetime calls return false from that moment on,
    // so callers see the room is gone and create a fresh one. This closes the pre-existing
    // race where a `Clients.IsEmpty && Rooms.TryRemove` check could pass while a new WS
    // client was joining mid-check, leaving them with a removed-from-dict room.
    private int _refCount;
    private bool _dying;
    private readonly object _lifetimeLock = new();

    /// Returns false if the room is dying. Caller must retry against a fresh room.
    public bool TryAcquireLifetime()
    {
        lock (_lifetimeLock)
        {
            if (_dying) return false;
            _refCount++;
            return true;
        }
    }

    /// Returns true if this release drove refcount to zero. The caller that gets `true`
    /// owns teardown (persist if dirty, remove from dict, dispose).
    public bool ReleaseLifetime()
    {
        lock (_lifetimeLock)
        {
            _refCount--;
            if (_refCount == 0)
            {
                _dying = true;
                return true;
            }
            return false;
        }
    }

    /// Forces the dying flag without releasing a token. Used by EvictRoom so that, after
    /// version restore removes the room from the dict and kicks clients, any straggling
    /// lifetime token holders (e.g., a client receive-loop still finishing) can't be racing
    /// new acquirers — and the room is disposed only when the last release lands.
    public void MarkDying()
    {
        lock (_lifetimeLock)
        {
            _dying = true;
        }
    }

    /// Loads initial state from DB. Safe to call from multiple clients — only the first call applies.
    public async Task LoadFromDbAsync(byte[]? state)
    {
        await _docLock.WaitAsync();
        try
        {
            if (_loaded) return;
            _loaded = true;

            if (state is not null && state.Length > 0)
            {
                try
                {
                    using var txn = _doc.WriteTransaction();
                    txn.ApplyV1(state);
                    txn.Commit();
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"[texmex] Warning: Failed to load Yjs state from DB, starting fresh: {ex.Message}");
                    _doc.Dispose();
                    _doc = NewDoc();
                }
            }
        }
        finally
        {
            _docLock.Release();
        }
    }

    /// Applies an incremental Yjs V1 update to the server-side doc.
    public async Task ApplyUpdateAsync(byte[] update, int offset, int count)
    {
        // Fast-path early-out outside the lock: if a restore is in progress, drop server-side
        // applies. The client still has the edit locally; on the inevitable EvictRoom that ends
        // the restore, the client reconnects and re-pushes via sync-step-2 (handshake). Other
        // clients still see the live broadcast (relay happens before ApplyUpdateAsync in the
        // receive loop), so awareness is unaffected.
        if (_isRestoring) return;
        await _docLock.WaitAsync();
        try
        {
            // Re-check inside the lock: BeginRestore could have been called while we were
            // waiting for _docLock. Without this, an edit that raced past the fast-path check
            // would still land in the doc that ReplaceStateAsync is about to overwrite.
            if (_isRestoring) return;
            using var txn = _doc.WriteTransaction();
            // Extract just the update bytes if we have an offset/count
            var updateBytes = offset == 0 && count == update.Length
                ? update
                : update[offset..(offset + count)];
            txn.ApplyV1(updateBytes);
            txn.Commit();
            IsDirty = true;
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[texmex] Warning: Failed to apply Yjs update to server doc: {ex.Message}");
        }
        finally
        {
            _docLock.Release();
        }
    }

    /// Exports the full Yjs state for DB persistence.
    /// Uses `null!` for the state vector argument: in YDotNet 0.6.0, `Array.Empty<byte>()` can return
    /// a null native buffer on cold rooms (no prior ApplyV1) that crashes the wrapper; `null` is the
    /// documented safe form for "diff against empty state". See CreateInitialYjsState comment.
    public async Task<byte[]> ExportStateAsync()
    {
        await _docLock.WaitAsync();
        try
        {
            using var txn = _doc.ReadTransaction();
            return txn.StateDiffV1(null!);
        }
        finally
        {
            _docLock.Release();
        }
    }

    /// Exports the Y.Doc's state vector for a sync step 1 (the "here's what I have" request the
    /// server sends a connecting client). On a brand-new/cold doc the native call may return a
    /// null buffer (same family of quirk as StateDiffV1 — see ExportStateAsync); we normalize that
    /// to an empty array, which is a valid state vector meaning "I have nothing".
    public async Task<byte[]> ExportStateVectorAsync()
    {
        await _docLock.WaitAsync();
        try
        {
            using var txn = _doc.ReadTransaction();
            return txn.StateVectorV1() ?? Array.Empty<byte>();
        }
        finally
        {
            _docLock.Release();
        }
    }

    /// Applies a custom mutation to the in-memory Y.Doc under the doc lock. Used by API endpoints
    /// (file create/delete) that need to mutate the Y.Doc directly. Marks the room dirty so the
    /// persistence service picks up the change.
    ///
    /// Two-phase callback per the YDotNet API design (see github.com/y-crdt/ydotnet README):
    ///   - `prepare(_doc)` runs first under the lock, no transaction open — call doc.Text()/doc.Map()
    ///      here to grab root type refs. These methods open implicit transactions internally and
    ///      can't be called from inside an explicit WriteTransaction.
    ///   - `mutate(prepared, txn)` runs inside a WriteTransaction with the prepared refs + txn.
    public async Task MutateAsync<T>(Func<Doc, T> prepare, Action<T, YDotNet.Document.Transactions.Transaction> mutate)
    {
        await _docLock.WaitAsync();
        try
        {
            var prepared = prepare(_doc);
            using var txn = _doc.WriteTransaction();
            mutate(prepared, txn);
            txn.Commit();
            IsDirty = true;
        }
        finally
        {
            _docLock.Release();
        }
    }

    /// Read-only variant — no commit, no dirty flag. Same two-phase pattern to avoid the YDotNet
    /// transaction conflict on doc.Text().
    public async Task<TResult> ReadAsync<TPrep, TResult>(
        Func<Doc, TPrep> prepare,
        Func<TPrep, YDotNet.Document.Transactions.Transaction, TResult> reader)
    {
        await _docLock.WaitAsync();
        try
        {
            var prepared = prepare(_doc);
            using var txn = _doc.ReadTransaction();
            return reader(prepared, txn);
        }
        finally
        {
            _docLock.Release();
        }
    }

    /// Replaces the Y.Doc entirely with new state. Used before eviction during version restore
    /// so that if the persistence service still has a reference to this room, it exports the
    /// restored state instead of the old state.
    public async Task ReplaceStateAsync(byte[] newState)
    {
        await _docLock.WaitAsync();
        try
        {
            _doc.Dispose();
            _doc = NewDoc();
            if (newState.Length > 0)
            {
                using var txn = _doc.WriteTransaction();
                txn.ApplyV1(newState);
                txn.Commit();
            }
            _loaded = true;
            IsDirty = false;
        }
        finally
        {
            _docLock.Release();
        }
    }

    /// Clears the dirty flag (call after successful save).
    public void ClearDirty() => IsDirty = false;

    /// Atomically captures the Y.Doc state for a version snapshot AND clears the dirty flag,
    /// under `_docLock`. This prevents a race where a client edit lands between a plain
    /// `ExportStateAsync` call and `ClearDirty`, leaving the edit in memory but marked clean
    /// (so the persistence service skips it). Returns null if the room wasn't dirty (no save needed).
    public async Task<byte[]?> CaptureForVersionAsync()
    {
        await _docLock.WaitAsync();
        try
        {
            if (!IsDirty) return null;
            using var txn = _doc.ReadTransaction();
            var state = txn.StateDiffV1(null!);
            // Clear dirty under the same lock — concurrent ApplyUpdateAsync also acquires _docLock,
            // so any edit after this point sees IsDirty cleared and will re-set it.
            IsDirty = false;
            return state;
        }
        finally
        {
            _docLock.Release();
        }
    }

    public void Dispose()
    {
        _doc.Dispose();
        _docLock.Dispose();
        SaveLock.Dispose();
    }
}
