namespace TexMex.Data.Schemas;

public class UserSession
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime ExpiresAt { get; set; }

    // Navigation
    public User User { get; set; } = null!;
}
