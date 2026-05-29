using TexMex.Data.Services;
using TexMex.UnitTests.Helpers;

namespace TexMex.UnitTests;

/// Unit tests for the forward-delta restore primitives (DocumentService.ComputeForwardDeltaState
/// and DecodeCollaborativeTexts). These are pure byte→byte / byte→text transforms — no DB, no WS —
/// so they pin down restore correctness deterministically. The raw-Yjs merge semantics they build on
/// are proven separately in ForwardDeltaSemanticsTests.
public class ComputeForwardDeltaTests
{
    private static readonly Guid F1 = Guid.NewGuid();
    private static readonly Guid F2 = Guid.NewGuid();
    private static readonly Guid F3 = Guid.NewGuid();

    [Fact]
    public void ComputeForwardDeltaState_SetsTargetBranchToSnapshotText()
    {
        var current = YjsTestHelpers.BuildState((F1.ToString(), "current content"));

        var d2 = DocumentService.ComputeForwardDeltaState(
            current,
            new Dictionary<Guid, string> { [F1] = "restored content" },
            []);

        Assert.Equal("restored content", YjsTestHelpers.ReadText(d2, F1.ToString()));
    }

    [Fact]
    public void ComputeForwardDeltaState_ClearsBranchesInClearSet()
    {
        var current = YjsTestHelpers.BuildState((F1.ToString(), "keep"), (F2.ToString(), "remove me"));

        var d2 = DocumentService.ComputeForwardDeltaState(
            current,
            new Dictionary<Guid, string> { [F1] = "keep" },
            [F2]);

        Assert.Equal("keep", YjsTestHelpers.ReadText(d2, F1.ToString()));
        Assert.Equal("", YjsTestHelpers.ReadText(d2, F2.ToString()));
    }

    [Fact]
    public void ComputeForwardDeltaState_LeavesUntouchedBranchesUnchanged()
    {
        // A branch that's neither a target nor cleared (e.g. a non-restored collaborative file)
        // must keep its current content.
        var current = YjsTestHelpers.BuildState(
            (F1.ToString(), "target-old"), (F3.ToString(), "untouched"));

        var d2 = DocumentService.ComputeForwardDeltaState(
            current,
            new Dictionary<Guid, string> { [F1] = "target-new" },
            []);

        Assert.Equal("target-new", YjsTestHelpers.ReadText(d2, F1.ToString()));
        Assert.Equal("untouched", YjsTestHelpers.ReadText(d2, F3.ToString()));
    }

    [Fact]
    public void ComputeForwardDeltaState_ReSeedsAnEmptyBranch()
    {
        // A file deleted since the snapshot has an empty branch in current state; restore must
        // re-insert the snapshot text into it.
        var current = YjsTestHelpers.BuildState((F1.ToString(), ""));

        var d2 = DocumentService.ComputeForwardDeltaState(
            current,
            new Dictionary<Guid, string> { [F1] = "back from the dead" },
            []);

        Assert.Equal("back from the dead", YjsTestHelpers.ReadText(d2, F1.ToString()));
    }

    // GoodModeFact: skipped when the test host is in YDotNet bad-mode (per-process Heisenbug
    // that drops a multi-branch Y.Doc's branch content). See YDotNetBadModeProbe + the doc at
    // project_notes/YDOTNET_MULTIBRANCH_CORRUPTION.md.
    [GoodModeFact]
    public void ComputeForwardDeltaState_ResultIsCausallyAfterCurrent_ConcurrentEditSurvives()
    {
        // The offline-straggler invariant at the primitive level: d2 applied on top of a doc that
        // has the current state PLUS a concurrent edit must keep the concurrent edit and drop the
        // discarded content. (End-to-end version is the Layer-3 straggler test.)
        // Body wrapped in Retry to absorb the residual YDotNet bad-mode per-op flake (~10%) that
        // slips past the startup probe in some good-mode hosts. See Helpers/Retry.cs.
        Retry.Up(3, () =>
        {
            var current = YjsTestHelpers.BuildState((F1.ToString(), "OLD"));
            var d2 = DocumentService.ComputeForwardDeltaState(
                current, new Dictionary<Guid, string> { [F1] = "NEW" }, []);

            // Simulate a client: current + a concurrent insert, then apply d2.
            using var client = DocumentService.NewYDoc();
            var t = client.Text(F1.ToString());
            using (var w = client.WriteTransaction()) { w.ApplyV1(current); w.Commit(); }
            using (var w = client.WriteTransaction()) { t.Insert(w, 1, "ZZ"); w.Commit(); }
            using (var w = client.WriteTransaction()) { w.ApplyV1(d2); w.Commit(); }

            string result;
            using (var r = client.ReadTransaction()) result = t.String(r);
            Assert.Contains("ZZ", result);
            Assert.Contains("NEW", result);
            Assert.DoesNotContain("O", result);
        });
    }

    [Fact]
    public void DecodeCollaborativeTexts_ReadsEachBranch()
    {
        var snapshot = YjsTestHelpers.BuildState((F1.ToString(), "alpha"), (F2.ToString(), "beta"));

        var texts = DocumentService.DecodeCollaborativeTexts(snapshot, [F1, F2], Guid.NewGuid());

        Assert.Equal("alpha", texts[F1]);
        Assert.Equal("beta", texts[F2]);
    }

    [Fact]
    public void DecodeCollaborativeTexts_EmptyIdSet_ReturnsEmpty()
    {
        var snapshot = YjsTestHelpers.BuildState((F1.ToString(), "x"));
        var texts = DocumentService.DecodeCollaborativeTexts(snapshot, [], Guid.NewGuid());
        Assert.Empty(texts);
    }

    [Fact]
    public void DecodeCollaborativeTexts_BranchNotInSnapshot_ReturnsEmpty()
    {
        // A requested file_id whose Y.Text branch isn't present in the snapshot decodes to "" —
        // a legitimate "no collaborative content" result, not an error.
        var snapshot = YjsTestHelpers.BuildState((F1.ToString(), "present"));

        var texts = DocumentService.DecodeCollaborativeTexts(snapshot, [F1, F2], Guid.NewGuid());

        Assert.Equal("present", texts[F1]);
        Assert.Equal("", texts[F2]);
    }
}
