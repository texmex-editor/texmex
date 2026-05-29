using Microsoft.EntityFrameworkCore;
using TexMex.Api.Auth;
using TexMex.Api.Compile;
using TexMex.Api.Documents;
using TexMex.Api.Health;
using TexMex.Data;
using TexMex.Data.Services;
using TexMex.WebSockets;
using Microsoft.OpenApi.Models;
using Npgsql;

namespace TexMex;

public class Program
{
    public static void Main(string[] args)
    {
        var builder = WebApplication.CreateBuilder(args);

        // ── Configuration ────────────────────────────────────────────────────────
        var latexCompilerUrl = Environment.GetEnvironmentVariable("LATEX_COMPILER_URL")
            ?? "http://localhost:9000";

        var allowedOrigins = (Environment.GetEnvironmentVariable("ALLOWED_ORIGINS") ?? "http://localhost:5173")
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

        var connectionString = Environment.GetEnvironmentVariable("DATABASE_URL")
            ?? builder.Configuration.GetConnectionString("DefaultConnection")
            ?? throw new InvalidOperationException("No database connection string configured.");

        // Centralized session lifetime (cookie MaxAge + session-row ExpiresAt).
        SessionConfig.DurationDays = builder.Configuration.GetValue("Session:DurationDays", 30);

        // ── Services ─────────────────────────────────────────────────────────────
        builder.Services.AddDbContext<TexMexDbContext>(options =>
            options.UseNpgsql(connectionString));

        builder.Services.AddScoped<UserService>();
        builder.Services.AddScoped<DocumentService>();
        builder.Services.AddScoped<TemplateService>();

        builder.Services.AddCors(options =>
        {
            options.AddDefaultPolicy(policy =>
                policy.WithOrigins(allowedOrigins)
                      .AllowCredentials()
                      .AllowAnyMethod()
                      .AllowAnyHeader());
        });

        builder.Services.AddHttpClient();

        builder.Services.AddEndpointsApiExplorer();
        builder.Services.AddSwaggerGen(c => c.DocumentFilter<TexMex.Api.SwaggerTagOrder>());
        builder.Services.AddValidation();

        // Unified REST error shape: register our writer FIRST so it lands ahead of the default
        // writer in the IEnumerable<IProblemDetailsWriter> that ProblemDetailsService iterates
        // (it uses the first writer whose CanWrite returns true — ours always does). This routes
        // BOTH Results.Problem(...) calls AND AddValidation()'s 400s through our chokepoint.
        builder.Services.AddSingleton<Microsoft.AspNetCore.Http.IProblemDetailsWriter, TexMex.Api.StatusMessageProblemDetailsWriter>();
        builder.Services.AddProblemDetails();
        builder.Services.AddHostedService<RoomPersistenceService>();
        builder.Services.AddHostedService<TemplateSeedService>();
        builder.Services.AddHostedService<SessionGcService>();

        var app = builder.Build();

        // ── YDotNet startup self-test ────────────────────────────────────────────
        // YDotNet 0.6.0 / yrs has a per-process Heisenbug (~5–15% of starts) where any Y.Doc with
        // 2+ Y.Text branches loses a branch's content — silent data-loss for multi-file documents.
        // Bad mode is stable per process; we detect it now and exit non-zero so the host restarts.
        // See project_notes/YDOTNET_MULTIBRANCH_CORRUPTION.md.
        YjsStartupSelfTest.Run(app.Logger);

        // ── Auto-migrate on startup ──────────────────────────────────────────────
        using (var scope = app.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<TexMexDbContext>();
            var logger = scope.ServiceProvider.GetRequiredService<ILogger<Program>>();
            try
            {
                db.Database.Migrate();
            }
            catch (PostgresException ex) when (ex.SqlState == "42P07")
            {
                // Existing schemas from older setups can already have tables but no EF migration history.
                // Keep the API running so developers can still access Swagger and local endpoints.
                logger.LogWarning(ex,
                    "Skipping EF migration because schema objects already exist (SqlState {SqlState}).",
                    ex.SqlState);
            }
        }

        // ── Swagger (dev only) ───────────────────────────────────────────────────
        if (app.Environment.IsDevelopment())
        {
            app.UseSwagger();
            app.UseSwaggerUI(c =>
            {
                c.SwaggerEndpoint("/swagger/v1/swagger.json", "TexMex API V1");
            });

            app.MapGet("/", () => Results.Redirect("/swagger"));
        }

        // ── Middleware ───────────────────────────────────────────────────────────
        app.UseCors();
        app.UseWebSockets(new WebSocketOptions { KeepAliveInterval = TimeSpan.FromSeconds(30) });

        // ── Endpoints ────────────────────────────────────────────────────────────
        app.MapHealthEndpoints();
        app.MapAuthEndpoints();
        app.MapCompileEndpoints(latexCompilerUrl);
        app.MapDocumentEndpoints();
        app.MapTemplateEndpoints();
        app.MapFileEndpoints();
        app.MapFolderEndpoints();
        app.MapCollaboratorEndpoints();
        app.MapAccessLinkEndpoints();
        app.MapAnonymousLinkEndpoints();
        app.MapStateEndpoints();
        app.MapVersionEndpoints();
        app.MapExportEndpoints();
        app.MapYjsRelay();

        app.Run();
    }
}
