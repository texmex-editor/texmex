using System.Diagnostics;
using System.Text.Json;

namespace TexMex.Data.Services;

/// Walks SeedData/Templates/<slug>/ at startup and upserts each system template into the DB.
/// Idempotent on slug — restart-safe and picks up disk-side edits automatically.
public class TemplateSeedService(
    IServiceScopeFactory scopeFactory,
    IWebHostEnvironment env,
    ILogger<TemplateSeedService> logger) : IHostedService
{
    private static readonly Dictionary<string, string> ContentTypeByExtension = new(StringComparer.OrdinalIgnoreCase)
    {
        [".tex"] = "text/plain",
        [".bib"] = "text/plain",
        [".sty"] = "text/plain",
        [".cls"] = "text/plain",
        [".png"] = "image/png",
        [".jpg"] = "image/jpeg",
        [".jpeg"] = "image/jpeg",
        [".gif"] = "image/gif",
        [".pdf"] = "application/pdf",
        [".svg"] = "image/svg+xml",
    };

    private record TemplateMeta(string Slug, string Title, string? Description, string Category, bool IsPublic);

    public async Task StartAsync(CancellationToken cancellationToken)
    {
        var seedRoot = Path.Combine(env.ContentRootPath, "SeedData", "Templates");
        if (!Directory.Exists(seedRoot))
        {
            logger.LogInformation("TemplateSeedService: no SeedData/Templates directory found at {Path}, skipping", seedRoot);
            return;
        }

        var sw = Stopwatch.StartNew();
        var count = 0;

        using var scope = scopeFactory.CreateScope();
        var templateService = scope.ServiceProvider.GetRequiredService<TemplateService>();

        foreach (var folder in Directory.GetDirectories(seedRoot))
        {
            cancellationToken.ThrowIfCancellationRequested();

            try
            {
                await SeedOneAsync(folder, templateService, cancellationToken);
                count++;
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "TemplateSeedService: failed to seed template at {Folder}", folder);
            }
        }

        sw.Stop();
        logger.LogInformation("TemplateSeedService: upserted {Count} system templates in {Ms}ms", count, sw.ElapsedMilliseconds);
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;

    private async Task SeedOneAsync(string folder, TemplateService templateService, CancellationToken ct)
    {
        var metaPath = Path.Combine(folder, "meta.json");
        var mainTexPath = Path.Combine(folder, "main.tex");

        if (!File.Exists(metaPath))
        {
            logger.LogWarning("TemplateSeedService: missing meta.json in {Folder}, skipping", folder);
            return;
        }
        if (!File.Exists(mainTexPath))
        {
            logger.LogWarning("TemplateSeedService: missing main.tex in {Folder}, skipping", folder);
            return;
        }

        var metaJson = await File.ReadAllTextAsync(metaPath, ct);
        var meta = JsonSerializer.Deserialize<TemplateMeta>(metaJson, new JsonSerializerOptions
        {
            PropertyNameCaseInsensitive = true,
        });

        if (meta is null || string.IsNullOrWhiteSpace(meta.Slug))
        {
            logger.LogWarning("TemplateSeedService: invalid meta.json in {Folder}, skipping", folder);
            return;
        }

        var content = await File.ReadAllTextAsync(mainTexPath, ct);

        var filesDir = Path.Combine(folder, "files");
        var files = new List<(string filename, string contentType, byte[] data)>();

        if (Directory.Exists(filesDir))
        {
            foreach (var filePath in Directory.GetFiles(filesDir, "*", SearchOption.AllDirectories))
            {
                var relative = Path.GetRelativePath(filesDir, filePath).Replace('\\', '/');

                // Defensive — should never trigger for hand-curated seed files.
                var validationError = DocumentService.ValidateFilename(relative, "main.tex");
                if (validationError is not null)
                {
                    logger.LogWarning("TemplateSeedService: rejected invalid filename '{Relative}' in {Folder}: {Error}",
                        relative, folder, validationError);
                    continue;
                }

                var data = await File.ReadAllBytesAsync(filePath, ct);
                var contentType = ResolveContentType(filePath);
                files.Add((relative, contentType, data));
            }
        }

        await templateService.UpsertSystemTemplateAsync(
            slug: meta.Slug,
            title: meta.Title,
            description: meta.Description,
            category: meta.Category,
            isPublic: meta.IsPublic,
            content: content,
            files: files);

        logger.LogInformation("TemplateSeedService: upserted '{Slug}' ({FileCount} files)", meta.Slug, files.Count);
    }

    private static string ResolveContentType(string filePath)
    {
        var ext = Path.GetExtension(filePath);
        if (ContentTypeByExtension.TryGetValue(ext, out var contentType))
            return contentType;

        // Couple to the collaborative whitelist: any extension in FileTypePolicy that we
        // haven't explicitly mapped above (currently .tikz, .pgf, .cfg, .txt) is text/plain.
        // This way adding a new collab extension automatically gets a sensible content type
        // at seed time without anyone remembering to mirror it here.
        if (FileTypePolicy.IsCollaborativeFilename(filePath))
            return "text/plain";

        return "application/octet-stream";
    }
}
