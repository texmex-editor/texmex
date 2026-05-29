using TexMex.Data.Services;

namespace TexMex.UnitTests;

/// Filename validation — the security gate against path traversal, injection, and disallowed
/// types. ValidateFilename returns null when valid, or an error message string otherwise.
/// The entrypoint argument doesn't affect these cases; "main.tex" is passed throughout.
public class ValidateFilenameTests
{
    private const string Entrypoint = "main.tex";

    [Theory]
    [InlineData("main.tex")]
    [InlineData("refs.bib")]
    [InlineData("images/logo.png")]
    [InlineData("chapters/intro.tex")]
    [InlineData("a/b/c/deep.sty")]
    public void ValidateFilename_ValidNames_ReturnNull(string filename)
    {
        Assert.Null(DocumentService.ValidateFilename(filename, Entrypoint));
    }

    [Theory]
    [InlineData("../etc/passwd.tex")]      // path traversal
    [InlineData("a/../../b.tex")]          // traversal mid-path
    [InlineData("a\\b.tex")]               // backslash
    [InlineData("a%2e%2e.tex")]            // percent-encoding
    [InlineData("café.tex")]               // non-ASCII
    [InlineData("/leading.tex")]           // leading slash
    [InlineData("trailing/")]              // trailing slash
    [InlineData("a//b.tex")]               // empty path segment
    [InlineData("./a.tex")]                // dot segment
    [InlineData("../a.tex")]               // dotdot segment
    [InlineData("prototype.tex")]          // blocked JS-prototype name
    [InlineData("__proto__.tex")]          // blocked JS-prototype name
    public void ValidateFilename_DangerousInput_ReturnsError(string filename)
    {
        Assert.NotNull(DocumentService.ValidateFilename(filename, Entrypoint));
    }

    [Fact]
    public void ValidateFilename_NullByte_ReturnsError()
    {
        var withNullByte = "a" + (char)0x00 + "b.tex";
        Assert.NotNull(DocumentService.ValidateFilename(withNullByte, Entrypoint));
    }

    [Fact]
    public void ValidateFilename_ControlCharacter_ReturnsError()
    {
        var withControlChar = "a" + (char)0x01 + "b.tex";
        Assert.NotNull(DocumentService.ValidateFilename(withControlChar, Entrypoint));
    }

    [Theory]
    [InlineData("script.exe")]
    [InlineData("archive.zip")]
    public void ValidateFilename_DisallowedExtension_ReturnsError(string filename)
    {
        Assert.NotNull(DocumentService.ValidateFilename(filename, Entrypoint));
    }
}
