namespace TexMex.Data.Schemas;

public class DocumentAccessLink
{
    public Guid Id { get; set; }
    public Guid DocumentId { get; set; }
    public required string Token { get; set; }
    public required string Permission { get; set; }
    public Guid CreatedBy { get; set; }
    public bool IsActive { get; set; }
    public bool AllowAnonymous { get; set; }
    public int? MaxUses { get; set; }
    public int UseCount { get; set; }
    public DateTime CreatedAt { get; set; }

    // Navigation
    public Document Document { get; set; } = null!;
    public User Creator { get; set; } = null!;
    public ICollection<AnonymousAccessGrant> Grants { get; set; } = [];
}
