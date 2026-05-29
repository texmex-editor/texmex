namespace TexMex.Data.Schemas;

public class User
{
    public Guid Id { get; set; }
    public required string Email { get; set; }
    public required string DisplayName { get; set; }
    public string? PasswordHash { get; set; }
    public string? ExternalId { get; set; }
    public DateTime CreatedAt { get; set; }

    // Navigation
    public ICollection<Document> OwnedDocuments { get; set; } = [];
    public ICollection<DocumentCollaborator> Collaborations { get; set; } = [];
    public ICollection<UserSession> Sessions { get; set; } = [];
}
