namespace TexMex.Data.Schemas;

/// Per-version snapshot of which files existed at a given version.
/// Captures metadata (filename, content_type, is_collaborative) at version time so renames
/// between versions are preserved and version restore can reconcile file existence.
/// Binary content is NOT snapshotted here — static file changes are not versioned.
public class DocumentVersionFile
{
    public Guid VersionId { get; set; }
    public Guid FileId { get; set; }
    public required string Filename { get; set; }
    public required string ContentType { get; set; }
    public bool IsCollaborative { get; set; }

    // Navigation
    public DocumentVersion Version { get; set; } = null!;
    public DocumentFile File { get; set; } = null!;
}
