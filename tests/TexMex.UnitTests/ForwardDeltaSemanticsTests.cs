using YDotNet.Document;
using YDotNet.Document.Options;
using TexMex.UnitTests.Helpers;

namespace TexMex.UnitTests;

/// Pre-implementation probe: validates the Yjs semantics that forward-delta version restore
/// relies on, BEFORE building the feature. The whole design assumes that a "revert" built as
/// RemoveRange(0,len)+Insert(snapshot) is ITEM-targeted — so a concurrent insert at those
/// positions survives — and that applying that revert (as a full V1 state) on top of a doc that
/// already holds the deleted items yields the snapshot text. If these fail, forward-delta is the
/// wrong approach and the restore handler must NOT be written.
///
/// Docs use SkipGarbageCollection = true (the live-doc setting forward-delta will adopt) so the
/// deleted items remain as tombstones a concurrent edit can anchor against.
public class ForwardDeltaSemanticsTests
{
    private static Doc NewDoc() => new(new DocOptions { SkipGarbageCollection = true });

    // Builds the "revert" the server would compute: load currentState, clear the branch, insert the
    // target text, export the full V1 state (this is what `ComputeForwardDeltaState` will produce).
    private static byte[] BuildRevert(byte[] currentState, string branchKey, string targetText)
    {
        using var temp = NewDoc();
        var t = temp.Text(branchKey);
        using (var w = temp.WriteTransaction()) { w.ApplyV1(currentState); w.Commit(); }
        using (var w = temp.WriteTransaction())
        {
            var len = t.Length(w);
            if (len > 0) t.RemoveRange(w, 0, len);
            if (!string.IsNullOrEmpty(targetText)) t.Insert(w, 0, targetText);
            w.Commit();
        }
        using var r = temp.ReadTransaction();
        return r.StateDiffV1(null!);
    }

    private static byte[] Seed(string branchKey, string text)
    {
        using var doc = NewDoc();
        var t = doc.Text(branchKey);
        using var w = doc.WriteTransaction();
        if (!string.IsNullOrEmpty(text)) t.Insert(w, 0, text);
        var state = w.StateDiffV1(null!);
        w.Commit();
        return state;
    }

    // GoodModeFact: skipped under the YDotNet bad-mode Heisenbug. See YDotNetBadModeProbe +
    // project_notes/YDOTNET_MULTIBRANCH_CORRUPTION.md.
    [GoodModeFact]
    public void RemoveRange_IsItemTargeted_ConcurrentInsertSurvivesRevert()
    {
        // Server has "OLD". A concurrent client inserts "ZZ" -> "OZZLD" without the server seeing it.
        // The revert deletes O/L/D and inserts "NEW". Applying it on the client MUST keep ZZ.
        // If RemoveRange were position-range over the merged view, it would swallow ZZ -> design broken.
        // Body wrapped in Retry to absorb the residual YDotNet bad-mode per-op flake; see Helpers/Retry.cs.
        Retry.Up(3, () =>
        {
            var currentState = Seed("f", "OLD");
            var d2 = BuildRevert(currentState, "f", "NEW");

            using var client = NewDoc();
            var ct = client.Text("f");
            using (var w = client.WriteTransaction()) { w.ApplyV1(currentState); w.Commit(); }
            using (var w = client.WriteTransaction()) { ct.Insert(w, 1, "ZZ"); w.Commit(); } // O[ZZ]LD
            using (var w = client.WriteTransaction()) { w.ApplyV1(d2); w.Commit(); }

            string result;
            using (var r = client.ReadTransaction()) result = ct.String(r);

            Assert.Contains("ZZ", result);   // concurrent (offline-straggler) edit survived
            Assert.Contains("NEW", result);  // revert applied
            Assert.DoesNotContain("O", result); // discarded content gone
            Assert.DoesNotContain("L", result);
            Assert.DoesNotContain("D", result);
        });
    }

    // GoodModeFact: also exercises the RemoveRange + apply-revert pattern that flakes under
    // bad-mode. See YDotNetBadModeProbe.
    [GoodModeFact]
    public void ApplyRevert_OnDocIdenticalToCurrent_YieldsSnapshotText()
    {
        // The connected/evicted-then-reconnect case: client == currentState, applies revert -> snapshot.
        // Body wrapped in Retry to absorb the residual YDotNet bad-mode per-op flake; see Helpers/Retry.cs.
        Retry.Up(3, () =>
        {
            var currentState = Seed("f", "OLD");
            var d2 = BuildRevert(currentState, "f", "NEW");

            using var client = NewDoc();
            var ct = client.Text("f");
            using (var w = client.WriteTransaction()) { w.ApplyV1(currentState); w.Commit(); }
            using (var w = client.WriteTransaction()) { w.ApplyV1(d2); w.Commit(); }

            string result;
            using (var r = client.ReadTransaction()) result = ct.String(r);
            Assert.Equal("NEW", result);
        });
    }
}
