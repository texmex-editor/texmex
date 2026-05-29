using TexMex.Data.Services;
using static TexMex.Data.Services.FileTypePolicy;

namespace TexMex.UnitTests;

/// The closed allowlist + category mapping that drives all per-file frontend rendering and
/// the upload gate. Tests the LOGIC around the lookup (case-insensitivity, no-extension,
/// disallowed→null, UTF-8 derivation), not every single dictionary entry.
public class FileTypePolicyTests
{
    [Theory]
    [InlineData("main.tex", FileCategory.Collaborative)]
    [InlineData("refs.bib", FileCategory.Collaborative)]
    [InlineData("data.csv", FileCategory.StaticText)]
    [InlineData("notes.md", FileCategory.StaticText)]
    [InlineData("logo.png", FileCategory.Image)]
    [InlineData("photo.jpeg", FileCategory.Image)]
    [InlineData("diagram.svg", FileCategory.Image)]
    [InlineData("doc.pdf", FileCategory.Pdf)]
    [InlineData("font.ttf", FileCategory.Font)]
    [InlineData("font.otf", FileCategory.Font)]
    public void Classify_KnownExtension_ReturnsExpectedCategory(string filename, FileCategory expected)
    {
        Assert.Equal(expected, Classify(filename));
    }

    [Theory]
    [InlineData("script.exe")]
    [InlineData("archive.zip")]
    [InlineData("graphic.eps")]
    [InlineData("post.ps")]
    [InlineData("compiled.bbl")]
    [InlineData("thing.xyz")]
    public void Classify_DisallowedExtension_ReturnsNull(string filename)
    {
        Assert.Null(Classify(filename));
        Assert.False(IsAllowedFilename(filename));
    }

    [Theory]
    [InlineData("LOGO.PNG")]
    [InlineData("Logo.PnG")]
    public void Classify_IsCaseInsensitive(string filename)
    {
        Assert.Equal(FileCategory.Image, Classify(filename));
    }

    [Theory]
    [InlineData("Makefile")]
    [InlineData("README")]
    [InlineData("")]
    public void Classify_NoExtension_ReturnsNull(string filename)
    {
        Assert.Null(Classify(filename));
    }

    [Theory]
    [InlineData("main.tex", true)]   // collaborative
    [InlineData("data.csv", true)]   // static_text
    [InlineData("logo.png", false)]  // image
    [InlineData("doc.pdf", false)]   // pdf
    [InlineData("font.ttf", false)]  // font
    public void RequiresUtf8_TrueForTextCategoriesOnly(string filename, bool expected)
    {
        Assert.Equal(expected, RequiresUtf8(filename));
    }
}
