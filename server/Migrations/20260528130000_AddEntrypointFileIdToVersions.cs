using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TexMex.Migrations
{
    /// <inheritdoc />
    public partial class AddEntrypointFileIdToVersions : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "entrypoint_file_id",
                table: "document_versions",
                type: "uuid",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "entrypoint_file_id",
                table: "document_versions");
        }
    }
}
