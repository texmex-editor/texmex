using YDotNet.Document;

namespace TexMex.Data.Services;

/// Detects a known YDotNet 0.6.0 / yrs **per-process Heisenbug** at server startup. Roughly 5–15% of
/// process starts, the native layer lands in a "bad mode" where any Y.Doc holding two or more Y.Text
/// branches silently loses one branch's content. The bug is stable for the entire process lifetime
/// (a process is uniformly good or bad), so detection at boot is sufficient. We perform a small
/// two-branch integrity check; on detected corruption we log FATAL and exit non-zero so the host
/// (Docker / systemd "restart on failure") restarts the process. A fresh process is in good mode
/// ~90% of the time, so 2–3 restarts essentially guarantee a working server.
///
/// The bug is in the unsafe yrs/yffi native layer (no .NET-side fix; YDotNet 0.6.0 is the latest
/// release). Full analysis + upstream-report draft: `project_notes/YDOTNET_MULTIBRANCH_CORRUPTION.md`.
public static class YjsStartupSelfTest
{
    public static void Run(ILogger logger)
    {
        // 3 iterations is a cheap safety margin — in bad mode every multi-branch op corrupts from
        // op 1, so even a single iteration would catch it. Three removes any doubt.
        for (int iter = 1; iter <= 3; iter++)
        {
            if (!OneCheckPasses()) Fail(logger, iter);
        }
        logger.LogInformation("YDotNet self-test passed (process is in good mode).");
    }

    private static bool OneCheckPasses()
    {
        // Builds the exact corrupting pattern: a fresh Y.Doc that ends up with two `Y.Text` branches.
        // The two inputs are clean single-branch updates (single-branch construction is safe even in
        // bad mode). If either branch reads back wrong, this process is in bad mode.
        var updA = SingleBranch("A", "alpha");
        var updB = SingleBranch("B", "beta");

        using var doc = DocumentService.NewYDoc();
        var ta = doc.Text("A");
        var tb = doc.Text("B");
        using (var w = doc.WriteTransaction()) { w.ApplyV1(updA); w.Commit(); }
        using (var w = doc.WriteTransaction()) { w.ApplyV1(updB); w.Commit(); }
        using var r = doc.ReadTransaction();
        return ta.String(r) == "alpha" && tb.String(r) == "beta";
    }

    private static byte[] SingleBranch(string key, string text)
    {
        using var d = DocumentService.NewYDoc();
        var t = d.Text(key);
        using var w = d.WriteTransaction();
        t.Insert(w, 0, text);
        var s = w.StateDiffV1(null!);
        w.Commit();
        return s;
    }

    private static void Fail(ILogger logger, int iter)
    {
        const string msg =
            "YDotNet bad-mode detected: a two-branch Y.Doc lost a branch's content during the startup " +
            "self-test. This is the known YDotNet 0.6.0 / yrs per-process Heisenbug (see " +
            "project_notes/YDOTNET_MULTIBRANCH_CORRUPTION.md). Exiting with code 1 so the host restarts; " +
            "a fresh process is overwhelmingly likely to be in good mode.";
        logger.LogCritical(msg + " (iteration {Iter}/3)", iter);
        // Direct stderr backup in case the logger has buffering — Environment.Exit may skip flushing.
        Console.Error.WriteLine($"FATAL: {msg} (iteration {iter}/3)");
        Environment.Exit(1);
    }
}
