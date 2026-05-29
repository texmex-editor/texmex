using System.Text;

namespace TexMex.Data.Services;

public class InvalidContentException(string message) : Exception(message);

/// Validates an upload's bytes against the category its filename declares.
///
/// Why we need this: without it, uploading binary content under a collaborative or static-text
/// extension (e.g. a PNG named `logo.tex` or `data.csv`) would UTF-8-decode-with-replacement-chars
/// when the frontend tries to render it — visible as a stream of `�` glyphs in the editor with no
/// path to recover the original. Static-binary uploads have the inverse problem: a PDF named
/// `logo.png` slips past and only fails downstream in the LaTeX compiler.
///
/// Validation by category (FileTypePolicy.Classify):
///   - Collaborative + StaticText  -> strict UTF-8 decode; any invalid byte sequence -> reject.
///   - Image, Pdf, Font            -> magic-byte signature at offset 0 must match the extension.
///   - Unrecognised extension      -> FileTypePolicy rejects at ValidateFilename time, never reaches us.
public static class ContentValidator
{
    // Magic bytes by lowercase extension for every binary category we support.
    private static readonly Dictionary<string, byte[][]> MagicBytes = new()
    {
        // Images
        [".png"]  = [[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]],
        [".jpg"]  = [[0xFF, 0xD8, 0xFF]],
        [".jpeg"] = [[0xFF, 0xD8, 0xFF]],
        [".gif"]  = [
            Encoding.ASCII.GetBytes("GIF87a"),
            Encoding.ASCII.GetBytes("GIF89a"),
        ],
        [".bmp"]  = [Encoding.ASCII.GetBytes("BM")],
        [".tif"]  = [
            [0x49, 0x49, 0x2A, 0x00],   // little-endian
            [0x4D, 0x4D, 0x00, 0x2A],   // big-endian
        ],
        [".tiff"] = [
            [0x49, 0x49, 0x2A, 0x00],
            [0x4D, 0x4D, 0x00, 0x2A],
        ],

        // PDF
        [".pdf"]  = [Encoding.ASCII.GetBytes("%PDF-")],

        // Fonts
        [".ttf"]  = [
            [0x00, 0x01, 0x00, 0x00],         // TrueType
            Encoding.ASCII.GetBytes("true"),  // alternative TrueType signature
        ],
        [".otf"]  = [Encoding.ASCII.GetBytes("OTTO")],
    };

    /// Throws InvalidContentException if the bytes don't match the filename's declared type.
    /// Empty payloads pass through — endpoints handle "empty file allowed?" separately
    /// (collaborative empty files OK for the "new file" UX; static categories aren't).
    public static void Validate(string filename, byte[] data)
    {
        if (data.Length == 0) return;

        // Text categories (Collaborative + StaticText): must be strict-UTF-8 decodable.
        if (FileTypePolicy.RequiresUtf8(filename))
        {
            try
            {
                _ = new UTF8Encoding(encoderShouldEmitUTF8Identifier: false, throwOnInvalidBytes: true)
                    .GetString(data);
            }
            catch (DecoderFallbackException)
            {
                throw new InvalidContentException(
                    "File content is not valid UTF-8 text. " +
                    "Text-based file types (collaborative .tex/.bib/... and static .csv/.json/.md/...) " +
                    "must contain valid UTF-8 — upload binary files under a different extension instead.");
            }
            return;
        }

        // SVG is in the Image category but is XML — accept if it parses as UTF-8 with an XML or svg opener.
        if (filename.EndsWith(".svg", StringComparison.OrdinalIgnoreCase))
        {
            try
            {
                var text = new UTF8Encoding(false, true).GetString(data);
                var trimmed = text.TrimStart();
                if (trimmed.StartsWith("<?xml") || trimmed.StartsWith("<svg", StringComparison.OrdinalIgnoreCase))
                    return;
            }
            catch (DecoderFallbackException)
            {
                // fall through to throw
            }
            throw new InvalidContentException(
                "File content does not look like SVG (expected an <?xml or <svg opener).");
        }

        // WebP is RIFF-container + WEBP marker at offset 8.
        if (filename.EndsWith(".webp", StringComparison.OrdinalIgnoreCase))
        {
            if (data.Length < 12 ||
                !data.AsSpan(0, 4).SequenceEqual("RIFF"u8) ||
                !data.AsSpan(8, 4).SequenceEqual("WEBP"u8))
            {
                throw new InvalidContentException(
                    "File content does not match the declared .webp format.");
            }
            return;
        }

        var ext = Path.GetExtension(filename)?.ToLowerInvariant();
        if (ext is null || !MagicBytes.TryGetValue(ext, out var signatures))
        {
            // Unreachable in practice: FileTypePolicy already rejected unknown extensions at
            // ValidateFilename time, and every allowed binary category has an entry above.
            // Leave the pass-through as a defensive default.
            return;
        }

        foreach (var sig in signatures)
        {
            if (data.Length >= sig.Length && data.AsSpan(0, sig.Length).SequenceEqual(sig))
                return;
        }

        throw new InvalidContentException(
            $"File content does not match the declared {ext} format. " +
            "Either upload genuine content for this extension, or rename to match the actual content type.");
    }
}
