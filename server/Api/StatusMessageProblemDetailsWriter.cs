using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace TexMex.Api;

// Every REST error response in the API funnels through this writer so the body
// shape is always { "status": "error", "message": "..." }. Both explicit
// Results.Problem(...) calls and the built-in AddValidation() 400s go through
// IProblemDetailsService, which iterates registered IProblemDetailsWriter
// instances and uses the first one whose CanWrite returns true. We always
// return true, and we're registered before AddProblemDetails() in Program.cs,
// so the framework's default writer never runs. This intentionally does not
// touch the WebSocket control channel (permission_denied / file_event) — that's
// a separate protocol in server/WebSockets.
public sealed class StatusMessageProblemDetailsWriter : IProblemDetailsWriter
{
    private static readonly JsonSerializerOptions SerializerOptions = new(JsonSerializerDefaults.Web);

    // Single error shape for the entire API → we always claim ownership.
    public bool CanWrite(ProblemDetailsContext context) => true;

    public ValueTask WriteAsync(ProblemDetailsContext context)
    {
        var problem = context.ProblemDetails;

        // Validation: surface the curated ErrorMessage strings from each DataAnnotation
        // (joined when multiple fields failed at once). Field names are never serialised —
        // only the per-rule messages we wrote in Api/Models/*.cs. Falls back to the generic
        // "Validation failed" only when an annotation didn't set ErrorMessage (shouldn't
        // happen in practice — keep every new annotation curated to avoid leaking ".NET
        // defaults" like "The X field is not a valid e-mail address.").
        string message;
        if (IsValidationFailure(problem))
        {
            var messages = ExtractValidationMessages(problem);
            message = messages.Length > 0 ? string.Join(" ", messages) : "Validation failed";
        }
        else
        {
            message = problem.Detail ?? problem.Title ?? "An error occurred";
        }

        var response = context.HttpContext.Response;

        // Ensure the status code matches the ProblemDetails. Results.Problem(statusCode: X) sets
        // this before the writer runs, but be explicit so nothing leaks a wrong/200 status.
        if (problem.Status is int status)
        {
            response.StatusCode = status;
        }

        response.ContentType = "application/json";

        return new ValueTask(response.WriteAsJsonAsync(
            new { status = "error", message },
            SerializerOptions,
            contentType: "application/json",
            cancellationToken: context.HttpContext.RequestAborted));
    }

    private static bool IsValidationFailure(ProblemDetails problem)
    {
        if (problem is HttpValidationProblemDetails validation)
        {
            return validation.Errors.Count > 0;
        }

        // Defensive: some paths surface validation errors via the extension members rather than
        // the strongly-typed subclass.
        if (problem.Extensions.TryGetValue("errors", out var errors) && errors is not null)
        {
            return true;
        }

        return false;
    }

    /// Pull the per-rule ErrorMessage strings out of the validation problem.
    /// Distincts duplicates so a field with two failing rules that share a message
    /// (e.g. Required + MinLength(1) on the same string) doesn't repeat it.
    private static string[] ExtractValidationMessages(ProblemDetails problem)
    {
        IEnumerable<string>? raw = null;

        if (problem is HttpValidationProblemDetails validation)
        {
            raw = validation.Errors.SelectMany(kv => kv.Value);
        }
        else if (problem.Extensions.TryGetValue("errors", out var errors) && errors is IDictionary<string, string[]> dict)
        {
            raw = dict.SelectMany(kv => kv.Value);
        }

        return raw is null
            ? Array.Empty<string>()
            : raw.Where(s => !string.IsNullOrWhiteSpace(s)).Distinct().ToArray();
    }
}
