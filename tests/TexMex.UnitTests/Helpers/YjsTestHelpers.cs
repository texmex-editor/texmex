using YDotNet.Document;

namespace TexMex.UnitTests.Helpers;

/// Builds and reads Yjs V1 state blobs for tests, mirroring the production patterns in
/// DocumentService.CreateInitialYjsState and RoomState.ExportStateAsync — including the
/// YDotNet 0.6.0 quirks: doc.Text() must be called OUTSIDE an open transaction, and
/// StateDiffV1 takes null! (not Array.Empty) to diff against empty state.
internal static class YjsTestHelpers
{
    /// Produces a V1 state blob with one Y.Text per (key, text) entry.
    public static byte[] BuildState(params (string key, string text)[] entries)
    {
        using var doc = new Doc();
        // Acquire all Y.Text refs before opening the write transaction.
        var seeds = entries.Select(e => (yText: doc.Text(e.key), content: e.text)).ToList();

        using var txn = doc.WriteTransaction();
        foreach (var (yText, content) in seeds)
        {
            if (!string.IsNullOrEmpty(content))
                yText.Insert(txn, 0, content);
        }
        var state = txn.StateDiffV1(null!);
        txn.Commit();
        return state;
    }

    /// Reads the text content of a single Y.Text (by key) out of a V1 state blob.
    public static string ReadText(byte[] state, string key)
    {
        using var doc = new Doc();
        var text = doc.Text(key);
        using (var w = doc.WriteTransaction())
        {
            w.ApplyV1(state);
            w.Commit();
        }
        using var r = doc.ReadTransaction();
        return text.String(r);
    }
}
