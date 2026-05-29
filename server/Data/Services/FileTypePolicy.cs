namespace TexMex.Data.Services;

/// Closed allowlist of file extensions TexMex accepts, with the category each one belongs to.
/// One place that decides:
///   - what extensions are allowed at all (uploads of anything else are rejected with 400)
///   - whether content is collaboratively edited or stored as bytes
///   - how the frontend should render the file (editor / preview / download-only)
///
/// Status is fixed at upload — renaming a file does NOT change its category. To switch categories
/// for an existing file, use the cross-type replace endpoint.
public static class FileTypePolicy
{
    public enum FileCategory
    {
        /// Real-time collaboratively edited as a Y.Text branch in the Y.Doc.
        /// Frontend: open in Monaco editor with y-codemirror binding, editable.
        Collaborative,

        /// Text-based but not real-time editable. Bytes stored in DocumentFile.Data.
        /// Frontend: open in Monaco editor as read-only, with a banner explaining
        /// "download to edit locally."
        StaticText,

        /// Raster or vector image. Bytes stored in DocumentFile.Data.
        /// Frontend: hide the code editor, render in an image preview pane (<img src>).
        Image,

        /// PDF document. Bytes stored in DocumentFile.Data.
        /// Frontend: hide the code editor, render in a PDF preview pane (<embed> / PDF.js).
        Pdf,

        /// Binary font file used by xelatex/lualatex+fontspec. Bytes stored in DocumentFile.Data.
        /// Frontend: hide both the code editor and preview pane; show a "download" affordance.
        Font,
    }

    // The single source of truth for which extensions are accepted and how they're handled.
    // All comparisons are case-insensitive (extensions are lowercased before lookup).
    private static readonly Dictionary<string, FileCategory> AllowedExtensions = new()
    {
        // Collaborative — LaTeX source and ancillary text
        [".tex"] = FileCategory.Collaborative,
        [".bib"] = FileCategory.Collaborative,
        [".cls"] = FileCategory.Collaborative,
        [".sty"] = FileCategory.Collaborative,
        [".tikz"] = FileCategory.Collaborative,
        [".pgf"] = FileCategory.Collaborative,
        [".cfg"] = FileCategory.Collaborative,
        [".txt"] = FileCategory.Collaborative,

        // Static text — viewable in editor, not real-time editable
        [".csv"] = FileCategory.StaticText,
        [".json"] = FileCategory.StaticText,
        [".yaml"] = FileCategory.StaticText,
        [".yml"] = FileCategory.StaticText,
        [".md"] = FileCategory.StaticText,
        [".log"] = FileCategory.StaticText,

        // Images — preview pane, no editor. SVG goes here too (browsers render natively).
        [".png"] = FileCategory.Image,
        [".jpg"] = FileCategory.Image,
        [".jpeg"] = FileCategory.Image,
        [".gif"] = FileCategory.Image,
        [".bmp"] = FileCategory.Image,
        [".webp"] = FileCategory.Image,
        [".tif"] = FileCategory.Image,
        [".tiff"] = FileCategory.Image,
        [".svg"] = FileCategory.Image,

        // PDF — preview pane
        [".pdf"] = FileCategory.Pdf,

        // Fonts — download-only (occasionally needed for xelatex/lualatex)
        [".ttf"] = FileCategory.Font,
        [".otf"] = FileCategory.Font,

        // Deliberately NOT allowed:
        //   .zip / .eps / .ps / .bbl  -- removed per team decision; revisit if a real need shows up
        //   .exe / .sh / .bat / .dll / .so / .py / ...  -- never; would be a serving vector
        //   .woff / .woff2 / .eot  -- web-font formats, not used in pdflatex/xelatex pipelines
    };

    /// Returns the category for the filename, or null if the extension isn't allowed.
    public static FileCategory? Classify(string? filename)
    {
        if (string.IsNullOrWhiteSpace(filename)) return null;
        var ext = Path.GetExtension(filename);
        if (string.IsNullOrEmpty(ext)) return null;
        return AllowedExtensions.TryGetValue(ext.ToLowerInvariant(), out var cat) ? cat : null;
    }

    /// True if the extension is in the allowlist (any category).
    public static bool IsAllowedFilename(string? filename) => Classify(filename) is not null;

    /// True if the filename's category is Collaborative. Existing callers keep working unchanged.
    public static bool IsCollaborativeFilename(string filename) =>
        Classify(filename) == FileCategory.Collaborative;

    /// True if the filename's category should be UTF-8 validated (Collaborative or StaticText).
    /// Used by ContentValidator.
    public static bool RequiresUtf8(string filename) =>
        Classify(filename) is FileCategory.Collaborative or FileCategory.StaticText;
}
