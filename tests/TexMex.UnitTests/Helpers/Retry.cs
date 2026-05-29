namespace TexMex.UnitTests.Helpers;

/// Small retry helper for the handful of tests that wrap a YDotNet multi-branch construction —
/// even after `YDotNetBadModeProbe` gates the obvious bad-mode hosts, there is a residual ~10%
/// per-op corruption rate in some good-mode processes (see project_notes/YDOTNET_MULTIBRANCH_CORRUPTION.md).
/// Wrapping the idempotent test body in `Retry.Up(3, ...)` collapses that to ~0.1% — i.e. effectively
/// never. ONLY use on tests whose body is pure and re-runnable (constructs fresh data each call).
internal static class Retry
{
    public static void Up(int maxAttempts, Action body)
    {
        Exception? last = null;
        for (int i = 0; i < maxAttempts; i++)
        {
            try { body(); return; }
            catch (Xunit.Sdk.XunitException ex) { last = ex; }
        }
        throw last!;
    }
}
