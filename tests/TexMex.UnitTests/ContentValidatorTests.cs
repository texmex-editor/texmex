using TexMex.Data.Services;

namespace TexMex.UnitTests;

/// Upload content validation — the security + corruption boundary. Prevents binary content
/// being stored under text extensions (the garbled-� bug) and wrong-format content under
/// binary extensions.
public class ContentValidatorTests
{
    [Fact]
    public void Validate_CollabFile_ValidUtf8_DoesNotThrow()
    {
        ContentValidator.Validate("main.tex", TestData.ValidUtf8);
    }

    [Fact]
    public void Validate_CollabFile_BinaryContent_Throws()
    {
        // A PNG uploaded as .tex would UTF-8-decode into replacement chars — reject it.
        Assert.Throws<InvalidContentException>(
            () => ContentValidator.Validate("logo.tex", TestData.PngHeader));
    }

    [Fact]
    public void Validate_StaticTextFile_BinaryContent_Throws()
    {
        // .csv is static_text — still must be valid UTF-8 (the gap we closed).
        Assert.Throws<InvalidContentException>(
            () => ContentValidator.Validate("data.csv", TestData.PngHeader));
    }

    [Fact]
    public void Validate_Image_CorrectMagicBytes_DoesNotThrow()
    {
        ContentValidator.Validate("logo.png", TestData.PngHeader);
    }

    [Fact]
    public void Validate_Image_WrongMagicBytes_Throws()
    {
        // PDF bytes uploaded as .png — magic-byte mismatch.
        Assert.Throws<InvalidContentException>(
            () => ContentValidator.Validate("fake.png", TestData.PdfHeader));
    }

    [Fact]
    public void Validate_Pdf_ValidHeader_DoesNotThrow()
    {
        ContentValidator.Validate("ref.pdf", TestData.PdfHeader);
    }

    [Fact]
    public void Validate_Font_TrueTypeSignature_DoesNotThrow()
    {
        ContentValidator.Validate("font.ttf", TestData.TtfHeader);
    }

    [Fact]
    public void Validate_Svg_XmlContent_DoesNotThrow()
    {
        ContentValidator.Validate("g.svg", TestData.ValidSvg);
        ContentValidator.Validate("g.svg", TestData.ValidXmlSvg);
    }

    [Fact]
    public void Validate_Svg_BinaryContent_Throws()
    {
        Assert.Throws<InvalidContentException>(
            () => ContentValidator.Validate("g.svg", TestData.PngHeader));
    }

    [Fact]
    public void Validate_Webp_RiffWebpHeader_DoesNotThrow()
    {
        ContentValidator.Validate("img.webp", TestData.WebpHeader);
    }

    [Fact]
    public void Validate_Webp_RiffWithoutWebpMarker_Throws()
    {
        // RIFF container but not WebP (e.g. WAV) — the offset-8 marker check must reject it.
        Assert.Throws<InvalidContentException>(
            () => ContentValidator.Validate("img.webp", TestData.RiffNotWebp));
    }

    [Fact]
    public void Validate_EmptyPayload_DoesNotThrow()
    {
        // Empty collab file (the "new file" UX) bypasses validation; the endpoint owns the
        // empty-allowed decision per category.
        ContentValidator.Validate("main.tex", []);
    }
}
