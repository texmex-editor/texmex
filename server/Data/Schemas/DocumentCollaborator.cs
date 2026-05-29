namespace TexMex.Data.Schemas;

public class DocumentCollaborator
{
    public Guid DocumentId { get; set; }
    public Guid UserId { get; set; }
    public required string Role { get; set; }
    public DateTime AddedAt { get; set; }

    // Navigation
    public Document Document { get; set; } = null!;
    public User User { get; set; } = null!;
}
