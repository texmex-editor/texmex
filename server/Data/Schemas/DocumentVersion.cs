namespace TexMex.Data.Schemas;

public class DocumentVersion
{
    public Guid Id { get; set; }
    public Guid DocumentId { get; set; }
    public Guid CreatedBy { get; set; }
    public string? Label { get; set; }
    public string? Message { get; set; }
    public required byte[] YjsSnapshot { get; set; }

    /// The file_id of the document's entrypoint at the moment this version was created. Stored as a
    /// stable id (not a filename) so a later rename of the entrypoint doesn't break reading this
    /// version's source text or resetting Document.Entrypoint on restore. Nullable for the edge where
    /// Document.Entrypoint matched no active collaborative file at creation time (a broken state);
    /// callers fall back to filename matching when null.
    public Guid? EntrypointFileId { get; set; }

    public DateTime CreatedAt { get; set; }

    // Navigation
    public Document Document { get; set; } = null!;
    public User Creator { get; set; } = null!;
}
