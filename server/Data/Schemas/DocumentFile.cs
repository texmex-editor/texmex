namespace TexMex.Data.Schemas;

public class DocumentFile
{
    public Guid Id { get; set; }
    public Guid DocumentId { get; set; }
    public required string Filename { get; set; }
    public required string ContentType { get; set; }
    public int Size { get; set; }

    // For collaborative files (IsCollaborative=true), content lives in the Y.Doc and Data is null.
    // For static files (IsCollaborative=false), Data holds the binary content.
    public byte[]? Data { get; set; }

    // Determines whether content lives in the Y.Doc (true) or in Data (false). Fixed at upload.
    public bool IsCollaborative { get; set; }

    public Guid UploadedBy { get; set; }
    public DateTime CreatedAt { get; set; }

    // Soft-delete timestamp. NULL = active, non-null = deleted. Preserved so version restore can revive the row.
    public DateTime? DeletedAt { get; set; }

    // Navigation
    public Document Document { get; set; } = null!;
    public User Uploader { get; set; } = null!;
}
