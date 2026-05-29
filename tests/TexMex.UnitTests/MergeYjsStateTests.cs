using TexMex.Data.Services;
using TexMex.UnitTests.Helpers;

namespace TexMex.UnitTests;

/// Yjs state merge — exercised on every WS-disconnect save and persistence tick. The
/// corruption-fallback paths matter (YDotNet quirk territory): a bad blob must degrade
/// gracefully, never throw out of SaveStateAsync. MergeYjsState is internal (exposed via
/// InternalsVisibleTo).
public class MergeYjsStateTests
{
    // GoodModeFact: skipped when the test host is in YDotNet bad-mode (per-process Heisenbug
    // that drops a multi-branch Y.Doc's branch content). See YDotNetBadModeProbe + the doc at
    // project_notes/YDOTNET_MULTIBRANCH_CORRUPTION.md.
    [GoodModeFact]
    public void MergeYjsState_TwoValidStates_ContainsBothContributions()
    {
        // Two docs editing different Y.Text branches; the merge must contain both.
        // Body wrapped in Retry to absorb the residual YDotNet bad-mode per-op flake (~10%) that
        // slips past the startup probe in some good-mode hosts. See Helpers/Retry.cs.
        Retry.Up(3, () =>
        {
            var existing = YjsTestHelpers.BuildState(("fileA", "alpha"));
            var incoming = YjsTestHelpers.BuildState(("fileB", "beta"));

            var merged = DocumentService.MergeYjsState(existing, incoming);

            Assert.Equal("alpha", YjsTestHelpers.ReadText(merged, "fileA"));
            Assert.Equal("beta", YjsTestHelpers.ReadText(merged, "fileB"));
        });
    }

    [Fact]
    public void MergeYjsState_NullExisting_ReturnsIncoming()
    {
        var incoming = YjsTestHelpers.BuildState(("f", "x"));

        var merged = DocumentService.MergeYjsState(null, incoming);

        Assert.Equal(incoming, merged);
    }

    [Fact]
    public void MergeYjsState_EmptyExisting_ReturnsIncoming()
    {
        var incoming = YjsTestHelpers.BuildState(("f", "x"));

        var merged = DocumentService.MergeYjsState([], incoming);

        Assert.Equal(incoming, merged);
    }

    [Fact]
    public void MergeYjsState_CorruptExisting_ReturnsIncoming()
    {
        // DB-side corruption must not block a valid incoming save.
        byte[] garbage = [0x01, 0x02, 0x03, 0xFF, 0xFE];
        var incoming = YjsTestHelpers.BuildState(("f", "recovered"));

        var merged = DocumentService.MergeYjsState(garbage, incoming);

        Assert.Equal("recovered", YjsTestHelpers.ReadText(merged, "f"));
    }

    [Fact]
    public void MergeYjsState_CorruptIncoming_ReturnsExisting()
    {
        // A bad incoming update must be discarded, keeping the good existing state.
        var existing = YjsTestHelpers.BuildState(("f", "kept"));
        byte[] garbage = [0x01, 0x02, 0x03, 0xFF, 0xFE];

        var merged = DocumentService.MergeYjsState(existing, garbage);

        Assert.Equal("kept", YjsTestHelpers.ReadText(merged, "f"));
    }
}
