using Microsoft.EntityFrameworkCore;
using TexMex.Data.Schemas;

namespace TexMex.Data;

public class TexMexDbContext(DbContextOptions<TexMexDbContext> options) : DbContext(options)
{
    public DbSet<User> Users => Set<User>();
    public DbSet<Document> Documents => Set<Document>();
    public DbSet<DocumentCollaborator> DocumentCollaborators => Set<DocumentCollaborator>();
    public DbSet<DocumentVersion> DocumentVersions => Set<DocumentVersion>();
    public DbSet<DocumentAccessLink> DocumentAccessLinks => Set<DocumentAccessLink>();
    public DbSet<DocumentFile> DocumentFiles => Set<DocumentFile>();
    public DbSet<DocumentVersionFile> DocumentVersionFiles => Set<DocumentVersionFile>();
    public DbSet<UserSession> UserSessions => Set<UserSession>();
    public DbSet<AnonymousAccessGrant> AnonymousAccessGrants => Set<AnonymousAccessGrant>();
    public DbSet<Template> Templates => Set<Template>();
    public DbSet<TemplateFile> TemplateFiles => Set<TemplateFile>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        // ── Users ─────────────────────────────────────────────────
        modelBuilder.Entity<User>(e =>
        {
            e.ToTable("users");
            e.Property(u => u.Id).HasColumnName("id").HasDefaultValueSql("gen_random_uuid()");
            e.Property(u => u.Email).HasColumnName("email").HasMaxLength(255);
            e.Property(u => u.DisplayName).HasColumnName("display_name").HasMaxLength(100);
            e.Property(u => u.PasswordHash).HasColumnName("password_hash").HasMaxLength(255);
            e.Property(u => u.ExternalId).HasColumnName("external_id").HasMaxLength(255);
            e.Property(u => u.CreatedAt).HasColumnName("created_at").HasDefaultValueSql("now()");

            e.HasIndex(u => u.Email).IsUnique();
            e.HasIndex(u => u.ExternalId)
                .IsUnique()
                .HasFilter("external_id IS NOT NULL")
                .HasDatabaseName("idx_users_external_id");
        });

        // ── Documents ─────────────────────────────────────────────
        modelBuilder.Entity<Document>(e =>
        {
            e.ToTable("documents");
            e.Property(d => d.Id).HasColumnName("id").HasDefaultValueSql("gen_random_uuid()");
            e.Property(d => d.Title).HasColumnName("title").HasMaxLength(255).HasDefaultValue("Untitled");
            e.Property(d => d.OwnerId).HasColumnName("owner_id");
            e.Property(d => d.Entrypoint).HasColumnName("entrypoint").HasMaxLength(255).HasDefaultValue("main.tex");
            e.Property(d => d.YjsState).HasColumnName("yjs_state");
            e.Property(d => d.CreatedAt).HasColumnName("created_at").HasDefaultValueSql("now()");
            e.Property(d => d.UpdatedAt).HasColumnName("updated_at").HasDefaultValueSql("now()");

            e.HasOne(d => d.Owner)
                .WithMany(u => u.OwnedDocuments)
                .HasForeignKey(d => d.OwnerId)
                .OnDelete(DeleteBehavior.Restrict);

            e.HasIndex(d => d.OwnerId).HasDatabaseName("idx_documents_owner_id");
        });

        // ── DocumentCollaborators ─────────────────────────────────
        modelBuilder.Entity<DocumentCollaborator>(e =>
        {
            e.ToTable("document_collaborators");
            e.HasKey(dc => new { dc.DocumentId, dc.UserId });
            e.Property(dc => dc.DocumentId).HasColumnName("document_id");
            e.Property(dc => dc.UserId).HasColumnName("user_id");
            e.Property(dc => dc.Role).HasColumnName("role").HasMaxLength(20).HasDefaultValue("editor");
            e.Property(dc => dc.AddedAt).HasColumnName("added_at").HasDefaultValueSql("now()");

            e.HasOne(dc => dc.Document)
                .WithMany(d => d.Collaborators)
                .HasForeignKey(dc => dc.DocumentId)
                .OnDelete(DeleteBehavior.Cascade);

            e.HasOne(dc => dc.User)
                .WithMany(u => u.Collaborations)
                .HasForeignKey(dc => dc.UserId)
                .OnDelete(DeleteBehavior.Cascade);

            e.HasIndex(dc => dc.UserId).HasDatabaseName("idx_document_collaborators_user_id");

            e.ToTable(t => t.HasCheckConstraint("CK_document_collaborators_role",
                "role IN ('editor', 'viewer')"));
        });

        // ── DocumentVersions ──────────────────────────────────────
        modelBuilder.Entity<DocumentVersion>(e =>
        {
            e.ToTable("document_versions");
            e.Property(v => v.Id).HasColumnName("id").HasDefaultValueSql("gen_random_uuid()");
            e.Property(v => v.DocumentId).HasColumnName("document_id");
            e.Property(v => v.CreatedBy).HasColumnName("created_by");
            e.Property(v => v.Label).HasColumnName("label").HasMaxLength(512);
            e.Property(v => v.Message).HasColumnName("message").HasMaxLength(2000);
            e.Property(v => v.YjsSnapshot).HasColumnName("yjs_snapshot");
            e.Property(v => v.EntrypointFileId).HasColumnName("entrypoint_file_id");
            e.Property(v => v.CreatedAt).HasColumnName("created_at").HasDefaultValueSql("now()");

            e.HasOne(v => v.Document)
                .WithMany(d => d.Versions)
                .HasForeignKey(v => v.DocumentId)
                .OnDelete(DeleteBehavior.Cascade);

            e.HasOne(v => v.Creator)
                .WithMany()
                .HasForeignKey(v => v.CreatedBy)
                .OnDelete(DeleteBehavior.Restrict);

            e.HasIndex(v => v.DocumentId).HasDatabaseName("idx_document_versions_document_id");
        });

        // ── DocumentAccessLinks ───────────────────────────────────
        modelBuilder.Entity<DocumentAccessLink>(e =>
        {
            e.ToTable("document_access_links");
            e.Property(l => l.Id).HasColumnName("id").HasDefaultValueSql("gen_random_uuid()");
            e.Property(l => l.DocumentId).HasColumnName("document_id");
            e.Property(l => l.Token).HasColumnName("token").HasMaxLength(64);
            e.Property(l => l.Permission).HasColumnName("permission").HasMaxLength(20).HasDefaultValue("viewer");
            e.Property(l => l.CreatedBy).HasColumnName("created_by");
            e.Property(l => l.IsActive).HasColumnName("is_active").HasDefaultValue(true);
            e.Property(l => l.AllowAnonymous).HasColumnName("allow_anonymous").HasDefaultValue(false);
            e.Property(l => l.MaxUses).HasColumnName("max_uses");
            e.Property(l => l.UseCount).HasColumnName("use_count").HasDefaultValue(0);
            e.Property(l => l.CreatedAt).HasColumnName("created_at").HasDefaultValueSql("now()");

            e.HasOne(l => l.Document)
                .WithMany(d => d.AccessLinks)
                .HasForeignKey(l => l.DocumentId)
                .OnDelete(DeleteBehavior.Cascade);

            e.HasOne(l => l.Creator)
                .WithMany()
                .HasForeignKey(l => l.CreatedBy)
                .OnDelete(DeleteBehavior.Restrict);

            e.HasIndex(l => l.Token).IsUnique();
            e.HasIndex(l => l.DocumentId).HasDatabaseName("idx_document_access_links_document_id");

            e.ToTable(t => t.HasCheckConstraint("CK_document_access_links_permission",
                "permission IN ('editor', 'viewer')"));
        });

        // ── AnonymousAccessGrants ───────────────────────────────
        modelBuilder.Entity<AnonymousAccessGrant>(e =>
        {
            e.ToTable("anonymous_access_grants");
            e.Property(g => g.Id).HasColumnName("id").HasDefaultValueSql("gen_random_uuid()");
            e.Property(g => g.AccessLinkId).HasColumnName("access_link_id");
            e.Property(g => g.UserId).HasColumnName("user_id");
            e.Property(g => g.DisplayName).HasColumnName("display_name").HasMaxLength(100);
            e.Property(g => g.CreatedAt).HasColumnName("created_at").HasDefaultValueSql("now()");
            e.Property(g => g.LastSeenAt).HasColumnName("last_seen_at").HasDefaultValueSql("now()");

            e.HasOne(g => g.AccessLink)
                .WithMany(l => l.Grants)
                .HasForeignKey(g => g.AccessLinkId)
                .OnDelete(DeleteBehavior.Cascade);

            e.HasOne(g => g.User)
                .WithMany()
                .HasForeignKey(g => g.UserId)
                .OnDelete(DeleteBehavior.Cascade);

            e.HasIndex(g => g.AccessLinkId).HasDatabaseName("idx_anonymous_access_grants_link_id");
            e.HasIndex(g => g.UserId)
                .HasFilter("user_id IS NOT NULL")
                .HasDatabaseName("idx_anonymous_access_grants_user_id");

            // Prevent duplicate grants for the same logged-in user on the same link
            e.HasIndex(g => new { g.AccessLinkId, g.UserId })
                .IsUnique()
                .HasFilter("user_id IS NOT NULL")
                .HasDatabaseName("idx_anonymous_access_grants_link_user_unique");
        });

        // ── DocumentFiles ─────────────────────────────────────────
        modelBuilder.Entity<DocumentFile>(e =>
        {
            e.ToTable("document_files");
            e.Property(f => f.Id).HasColumnName("id").HasDefaultValueSql("gen_random_uuid()");
            e.Property(f => f.DocumentId).HasColumnName("document_id");
            e.Property(f => f.Filename).HasColumnName("filename").HasMaxLength(255);
            e.Property(f => f.ContentType).HasColumnName("content_type").HasMaxLength(100);
            e.Property(f => f.Size).HasColumnName("size");
            e.Property(f => f.Data).HasColumnName("data");
            e.Property(f => f.IsCollaborative).HasColumnName("is_collaborative").HasDefaultValue(false);
            e.Property(f => f.UploadedBy).HasColumnName("uploaded_by");
            e.Property(f => f.CreatedAt).HasColumnName("created_at").HasDefaultValueSql("now()");
            e.Property(f => f.DeletedAt).HasColumnName("deleted_at");

            e.HasOne(f => f.Document)
                .WithMany(d => d.Files)
                .HasForeignKey(f => f.DocumentId)
                .OnDelete(DeleteBehavior.Cascade);

            e.HasOne(f => f.Uploader)
                .WithMany()
                .HasForeignKey(f => f.UploadedBy)
                .OnDelete(DeleteBehavior.Restrict);

            // Partial unique index — only active rows. Allows filename reuse across soft-deleted rows.
            e.HasIndex(f => new { f.DocumentId, f.Filename })
                .IsUnique()
                .HasFilter("deleted_at IS NULL")
                .HasDatabaseName("idx_document_files_document_id_filename_active");
            e.HasIndex(f => f.DocumentId).HasDatabaseName("idx_document_files_document_id");

            // Global query filter: hide soft-deleted rows by default.
            // Use .IgnoreQueryFilters() on the rare query that needs them (restore reconciliation).
            e.HasQueryFilter(f => f.DeletedAt == null);
        });

        // ── DocumentVersionFiles ──────────────────────────────────
        modelBuilder.Entity<DocumentVersionFile>(e =>
        {
            e.ToTable("document_version_files");
            e.HasKey(vf => new { vf.VersionId, vf.FileId });
            e.Property(vf => vf.VersionId).HasColumnName("version_id");
            e.Property(vf => vf.FileId).HasColumnName("file_id");
            e.Property(vf => vf.Filename).HasColumnName("filename").HasMaxLength(255);
            e.Property(vf => vf.ContentType).HasColumnName("content_type").HasMaxLength(100);
            e.Property(vf => vf.IsCollaborative).HasColumnName("is_collaborative");

            e.HasOne(vf => vf.Version)
                .WithMany()
                .HasForeignKey(vf => vf.VersionId)
                .OnDelete(DeleteBehavior.Cascade);

            // Cascade so when a DocumentFile is hard-deleted (only via Document cascade today),
            // its version_files entries are cleaned up. Soft delete sets DeletedAt instead and does NOT cascade.
            e.HasOne(vf => vf.File)
                .WithMany()
                .HasForeignKey(vf => vf.FileId)
                .OnDelete(DeleteBehavior.Cascade);

            e.HasIndex(vf => vf.VersionId).HasDatabaseName("idx_document_version_files_version_id");
            e.HasIndex(vf => vf.FileId).HasDatabaseName("idx_document_version_files_file_id");
        });

        // ── UserSessions ──────────────────────────────────────────
        modelBuilder.Entity<UserSession>(e =>
        {
            e.ToTable("user_sessions");
            e.Property(s => s.Id).HasColumnName("id").HasDefaultValueSql("gen_random_uuid()");
            e.Property(s => s.UserId).HasColumnName("user_id");
            e.Property(s => s.CreatedAt).HasColumnName("created_at").HasDefaultValueSql("now()");
            e.Property(s => s.ExpiresAt).HasColumnName("expires_at");

            e.HasOne(s => s.User)
                .WithMany(u => u.Sessions)
                .HasForeignKey(s => s.UserId)
                .OnDelete(DeleteBehavior.Cascade);

            e.HasIndex(s => s.ExpiresAt).HasDatabaseName("idx_user_sessions_expires_at");
        });

        // ── Templates ───────────────────────────────────────────────
        modelBuilder.Entity<Template>(e =>
        {
            e.ToTable("templates");
            e.Property(t => t.Id).HasColumnName("id").HasDefaultValueSql("gen_random_uuid()");
            e.Property(t => t.Slug).HasColumnName("slug").HasMaxLength(100);
            e.Property(t => t.Title).HasColumnName("title").HasMaxLength(255);
            e.Property(t => t.Description).HasColumnName("description");
            e.Property(t => t.Category).HasColumnName("category").HasMaxLength(50);
            e.Property(t => t.Content).HasColumnName("content");
            e.Property(t => t.Thumbnail).HasColumnName("thumbnail");
            e.Property(t => t.OwnerId).HasColumnName("owner_id");
            e.Property(t => t.IsPublic).HasColumnName("is_public").HasDefaultValue(false);
            e.Property(t => t.CreatedAt).HasColumnName("created_at").HasDefaultValueSql("now()");
            e.Property(t => t.EntrypointFilename).HasColumnName("entrypoint_filename").HasMaxLength(255);

            e.HasOne(t => t.Owner)
                .WithMany()
                .HasForeignKey(t => t.OwnerId)
                .OnDelete(DeleteBehavior.Restrict);

            e.HasIndex(t => t.Slug).IsUnique().HasDatabaseName("idx_templates_slug");
            e.HasIndex(t => t.Category).HasDatabaseName("idx_templates_category");
            e.HasIndex(t => t.OwnerId).HasDatabaseName("idx_templates_owner_id");
        });

        // ── TemplateFiles ───────────────────────────────────────────
        modelBuilder.Entity<TemplateFile>(e =>
        {
            e.ToTable("template_files");
            e.Property(f => f.Id).HasColumnName("id").HasDefaultValueSql("gen_random_uuid()");
            e.Property(f => f.TemplateId).HasColumnName("template_id");
            e.Property(f => f.Filename).HasColumnName("filename").HasMaxLength(255);
            e.Property(f => f.ContentType).HasColumnName("content_type").HasMaxLength(100);
            e.Property(f => f.Data).HasColumnName("data");
            e.Property(f => f.CreatedAt).HasColumnName("created_at").HasDefaultValueSql("now()");

            e.HasOne(f => f.Template)
                .WithMany(t => t.Files)
                .HasForeignKey(f => f.TemplateId)
                .OnDelete(DeleteBehavior.Cascade);

            e.HasIndex(f => new { f.TemplateId, f.Filename }).IsUnique();
            e.HasIndex(f => f.TemplateId).HasDatabaseName("idx_template_files_template_id");
        });
    }
}
