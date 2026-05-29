using System.ComponentModel.DataAnnotations;

namespace TexMex.Api.Models;

// `From` and `To` are folder paths (with or without trailing slash — the endpoint normalises).
// `To` can be empty to mean "the document root" (i.e. flatten the folder's contents).
public record FolderRenameRequest(
    [property: Required(ErrorMessage = "Source folder is required."),
               MaxLength(255, ErrorMessage = "Folder path is too long.")]
    string From,
    // Not Required — empty string is a legal value meaning "move to root".
    [property: MaxLength(255, ErrorMessage = "Folder path is too long.")]
    string To
);

public record FolderDeleteRequest(
    [property: Required(ErrorMessage = "Folder path is required."),
               MaxLength(255, ErrorMessage = "Folder path is too long.")]
    string Path
);
