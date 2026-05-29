using System.Text;

namespace TexMex.UnitTests;

/// Shared byte fixtures: real magic-byte headers for binary formats, plus valid / invalid
/// UTF-8 payloads. Headers are padded with zero bytes so they're long enough for the
/// validator's offset checks (e.g. WebP needs ≥ 12 bytes).
internal static class TestData
{
    public static byte[] PngHeader => Pad([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    public static byte[] JpegHeader => Pad([0xFF, 0xD8, 0xFF]);
    public static byte[] GifHeader => Encoding.ASCII.GetBytes("GIF89a").Concat(new byte[20]).ToArray();
    public static byte[] PdfHeader => Encoding.ASCII.GetBytes("%PDF-1.7\n").Concat(new byte[20]).ToArray();
    public static byte[] TtfHeader => Pad([0x00, 0x01, 0x00, 0x00]);

    /// RIFF container + "WEBP" marker at offset 8 (the validator's special case).
    public static byte[] WebpHeader =>
        Encoding.ASCII.GetBytes("RIFF")
            .Concat(new byte[] { 0x00, 0x00, 0x00, 0x00 })   // 4-byte file size (ignored)
            .Concat(Encoding.ASCII.GetBytes("WEBP"))
            .Concat(new byte[8])
            .ToArray();

    /// A RIFF container that is NOT WebP (e.g. WAV) — should fail the WEBP marker check.
    public static byte[] RiffNotWebp =>
        Encoding.ASCII.GetBytes("RIFF")
            .Concat(new byte[] { 0x00, 0x00, 0x00, 0x00 })
            .Concat(Encoding.ASCII.GetBytes("WAVE"))
            .Concat(new byte[8])
            .ToArray();

    public static byte[] ValidUtf8 => Encoding.UTF8.GetBytes("\\section{Intro}\nHällo, wörld! 日本語");
    public static byte[] ValidSvg => Encoding.UTF8.GetBytes("<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>");
    public static byte[] ValidXmlSvg => Encoding.UTF8.GetBytes("<?xml version=\"1.0\"?><svg></svg>");

    /// Invalid UTF-8: 0xFF is never a valid UTF-8 byte. PngHeader also works as "binary, not text"
    /// since 0x89 is a continuation byte with no leader.
    public static byte[] InvalidUtf8 => [0xFF, 0xFE, 0x00, 0x89, 0x01];

    private static byte[] Pad(byte[] header) => header.Concat(new byte[32]).ToArray();
}
