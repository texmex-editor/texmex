namespace TexMex.Data.Schemas;

public class Template
{
    public Guid Id { get; set; }
    public required string Slug { get; set; }
    public required string Title { get; set; }
    public string? Description { get; set; }
    public required string Category { get; set; }
    public required string Content { get; set; }
    public byte[]? Thumbnail { get; set; }
    public Guid? OwnerId { get; set; }
    public bool IsPublic { get; set; }
    public DateTime CreatedAt { get; set; }

    /// Filename the entrypoint had on the source document at save-as-template time.
    /// When a new doc is instantiated from this template the field decides the
    /// derived doc's Entrypoint (and the seeded file's filename) instead of the
    /// previous hard-coded "main.tex". Nullable for back-compat with templates
    /// inserted before the column was added — those default to "main.tex".
    public string? EntrypointFilename { get; set; }

    // Navigation
    public User? Owner { get; set; }
    public ICollection<TemplateFile> Files { get; set; } = [];
}
