using YDotNet.Document;

namespace TexMex.UnitTests;

/// Gate test: proves the YDotNet native library (libyrs.so) loads in the xUnit test host.
/// Several Layer 1 tests (MergeYjsState, the Yjs helpers) create real Doc objects, so if the
/// native lib doesn't get copied transitively into the test output dir, those would all fail
/// with a DllNotFoundException. This single test surfaces that immediately.
public class NativeLibGateTest
{
    [Fact]
    public void Doc_InsertAndExportState_ProducesNonEmptyBytes()
    {
        using var doc = new Doc();
        var text = doc.Text("t");

        using var txn = doc.WriteTransaction();
        text.Insert(txn, 0, "hello");
        var state = txn.StateDiffV1(null!);
        txn.Commit();

        Assert.NotNull(state);
        Assert.NotEmpty(state);
    }
}
