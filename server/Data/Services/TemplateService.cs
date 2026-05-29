using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using TexMex.Data.Schemas;

namespace TexMex.Data.Services;

public class TemplateService(TexMexDbContext db)
{
    private static readonly Regex SlugCleanupPattern = new(@"[^a-z0-9]+", RegexOptions.Compiled);

    // Loads a template with its files, owner included for the response.
    public async Task<Template?> GetByIdAsync(Guid templateId)
    {
        return await db.Templates
            .Include(t => t.Owner)
            .Include(t => t.Files)
            .FirstOrDefaultAsync(t => t.Id == templateId);
    }

    // Used by the seed service to upsert system templates by their stable slug.
    public async Task<Template?> GetBySlugAsync(string slug)
    {
        return await db.Templates
            .Include(t => t.Files)
            .FirstOrDefaultAsync(t => t.Slug == slug);
    }

    // Visible templates: system (OwnerId NULL) + user's own + public from other users.
    public async Task<List<Template>> GetVisibleToUserAsync(Guid userId, string? category)
    {
        var query = db.Templates
            .Include(t => t.Owner)
            .Where(t => t.OwnerId == null || t.OwnerId == userId || t.IsPublic);

        if (!string.IsNullOrWhiteSpace(category))
            query = query.Where(t => t.Category == category);

        return await query
            .OrderByDescending(t => t.CreatedAt)
            .ToListAsync();
    }

    public async Task DeleteAsync(Template template)
    {
        db.Templates.Remove(template);
        await db.SaveChangesAsync();
    }

    // Owner-edit fields. Only the fields the caller explicitly sets are touched;
    // the rest are left as-is. Slug is intentionally NOT regenerated when title
    // changes — slugs are user-facing identifiers and rewriting them would break
    // any external links to the template detail page.
    public async Task<Template> UpdateUserTemplateAsync(
        Template template,
        TexMex.Api.Models.UpdateTemplateRequest request)
    {
        if (request.Title is not null) template.Title = request.Title.Trim();
        if (request.Description is not null)
            template.Description = string.IsNullOrWhiteSpace(request.Description) ? null : request.Description.Trim();
        if (request.Category is not null)
            template.Category = request.Category.Trim().ToLowerInvariant();
        if (request.IsPublic is not null) template.IsPublic = request.IsPublic.Value;

        await db.SaveChangesAsync();
        await db.Entry(template).Reference(t => t.Owner).LoadAsync();
        return template;
    }

    // Creates a user template by copying content + selected files from an existing document.
    // The slug is auto-generated from the title; collisions are resolved with a numeric suffix.
    public async Task<Template> CreateUserTemplateAsync(
        Guid ownerId,
        string title,
        string? description,
        string category,
        bool isPublic,
        string content,
        string entrypointFilename,
        List<(string filename, string contentType, byte[] data)> files)
    {
        var slug = await GenerateUniqueSlugAsync(title);

        var template = new Template
        {
            Slug = slug,
            Title = title.Trim(),
            Description = string.IsNullOrWhiteSpace(description) ? null : description.Trim(),
            Category = category.Trim(),
            Content = content,
            EntrypointFilename = entrypointFilename,
            OwnerId = ownerId,
            IsPublic = isPublic,
        };

        db.Templates.Add(template);

        foreach (var (filename, contentType, data) in files)
        {
            template.Files.Add(new TemplateFile
            {
                Filename = filename,
                ContentType = contentType,
                Data = data,
            });
        }

        await db.SaveChangesAsync();

        // Reload Owner so callers can shape responses without an extra query
        await db.Entry(template).Reference(t => t.Owner).LoadAsync();

        return template;
    }

    // Used by the seed service. Inserts on first run, updates on subsequent runs.
    // Always replaces the file set (delete + reinsert) so disk-side changes propagate.
    public async Task UpsertSystemTemplateAsync(
        string slug,
        string title,
        string? description,
        string category,
        bool isPublic,
        string content,
        List<(string filename, string contentType, byte[] data)> files)
    {
        var existing = await db.Templates
            .Include(t => t.Files)
            .FirstOrDefaultAsync(t => t.Slug == slug);

        if (existing is null)
        {
            var template = new Template
            {
                Slug = slug,
                Title = title,
                Description = description,
                Category = category,
                Content = content,
                OwnerId = null,
                IsPublic = isPublic,
            };

            foreach (var (filename, contentType, data) in files)
            {
                template.Files.Add(new TemplateFile
                {
                    Filename = filename,
                    ContentType = contentType,
                    Data = data,
                });
            }

            db.Templates.Add(template);
        }
        else
        {
            existing.Title = title;
            existing.Description = description;
            existing.Category = category;
            existing.Content = content;
            existing.IsPublic = isPublic;

            db.TemplateFiles.RemoveRange(existing.Files);

            foreach (var (filename, contentType, data) in files)
            {
                existing.Files.Add(new TemplateFile
                {
                    Filename = filename,
                    ContentType = contentType,
                    Data = data,
                });
            }
        }

        await db.SaveChangesAsync();
    }

    // Slugifies the title and finds a unique slug, appending -2, -3, ... on collision.
    public async Task<string> GenerateUniqueSlugAsync(string title)
    {
        var baseSlug = Slugify(title);
        if (string.IsNullOrEmpty(baseSlug))
            baseSlug = "template";

        // Reserve characters for the longest possible suffix so the final slug always fits in
        // 100 chars. The numeric suffix tops out at "-9999" (5 chars) and the hex fallback adds
        // "-XXXXXX" (7 chars), so 100 - 7 = 93 is the conservative cap.
        if (baseSlug.Length > 92)
            baseSlug = baseSlug[..92];

        var slug = baseSlug;
        var suffix = 2;

        while (await db.Templates.AnyAsync(t => t.Slug == slug))
        {
            if (suffix > 9999)
            {
                // Astronomically unlikely fallback — append random hex
                var random = Convert.ToHexString(System.Security.Cryptography.RandomNumberGenerator.GetBytes(3)).ToLowerInvariant();
                slug = $"{baseSlug}-{random}";
                continue;
            }

            slug = $"{baseSlug}-{suffix}";
            suffix++;
        }

        return slug;
    }

    private static string Slugify(string title)
    {
        var lowered = title.Trim().ToLowerInvariant();
        // Replace non-ASCII letters/digits with dashes, collapse runs, trim leading/trailing dashes
        var dashed = SlugCleanupPattern.Replace(lowered, "-");
        return dashed.Trim('-');
    }
}
