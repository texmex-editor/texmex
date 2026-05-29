namespace TexMex.Data.Schemas;

public class Document
{
    public Guid Id { get; set; }
    public required string Title { get; set; }
    public Guid OwnerId { get; set; }
    public required string Entrypoint { get; set; }
    public byte[]? YjsState { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }

    // Navigation
    public User Owner { get; set; } = null!;
    public ICollection<DocumentCollaborator> Collaborators { get; set; } = [];
    public ICollection<DocumentVersion> Versions { get; set; } = [];
    public ICollection<DocumentAccessLink> AccessLinks { get; set; } = [];
    public ICollection<DocumentFile> Files { get; set; } = [];
}
