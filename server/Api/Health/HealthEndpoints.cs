namespace TexMex.Api.Health;

public static class HealthEndpoints
{
    public static void MapHealthEndpoints(this WebApplication app)
    {
        app.MapGet("/health", () => Results.Ok(new { status = "ok", service = "texmex-server" }))
           .WithTags("Health")
           .WithSummary("Returns the health status of the service.")
           .Produces<object>(StatusCodes.Status200OK);
    }
}
