namespace TexMex.Data.Schemas;

public class AnonymousAccessGrant
{
    public Guid Id { get; set; }
    public Guid AccessLinkId { get; set; }
    public Guid? UserId { get; set; }
    public required string DisplayName { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime LastSeenAt { get; set; }

    // Navigation
    public DocumentAccessLink AccessLink { get; set; } = null!;
    public User? User { get; set; }
}
