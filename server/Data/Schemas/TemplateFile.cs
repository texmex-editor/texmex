namespace TexMex.Data.Schemas;

public class TemplateFile
{
    public Guid Id { get; set; }
    public Guid TemplateId { get; set; }
    public required string Filename { get; set; }
    public required string ContentType { get; set; }
    public required byte[] Data { get; set; }
    public DateTime CreatedAt { get; set; }

    // Navigation
    public Template Template { get; set; } = null!;
}
