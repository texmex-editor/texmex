namespace TexMex.Data.Services;

public class CorruptedYjsStateException(Guid documentId)
    : Exception($"Document {documentId} has corrupted Yjs state")
{
    public Guid DocumentId { get; } = documentId;
}
