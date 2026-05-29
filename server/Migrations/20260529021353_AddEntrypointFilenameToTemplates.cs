using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TexMex.Migrations
{
    /// <inheritdoc />
    public partial class AddEntrypointFilenameToTemplates : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "entrypoint_filename",
                table: "templates",
                type: "character varying(255)",
                maxLength: 255,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "entrypoint_filename",
                table: "templates");
        }
    }
}
