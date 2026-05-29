"""Duplicate endpoint + atomic folder rename/delete endpoints.

The folder endpoints replace the previous FE-side per-file PATCH loop, which could
leave the document in a half-renamed state if a collision hit mid-loop. These tests
verify the new pre-validate-or-rollback semantics + the duplicate naming convention.
"""
import requests
from conftest import BASE_URL, create_document, upload_file, list_files


def assert_filenames(session, doc_id, expected):
    """Active filenames in alphabetical order, for easier set-comparison."""
    return sorted(f["filename"] for f in list_files(session, doc_id)) == sorted(expected)


# ── duplicate ────────────────────────────────────────────────────────────────


def test_duplicate_static_file(alice):
    doc = create_document(alice, "dup-static")
    doc_id = doc["id"]
    src = upload_file(alice, doc_id, "data.csv", b"a,b\n1,2").json()
    r = alice.post(f"{BASE_URL}/api/documents/{doc_id}/files/{src['id']}/duplicate")
    assert r.status_code == 201, r.text
    dup = r.json()
    assert dup["filename"] == "data copy.csv"
    assert dup["isCollaborative"] is False
    assert dup["id"] != src["id"]


def test_duplicate_collab_file_snapshots_current_content(alice):
    doc = create_document(alice, "dup-collab")
    doc_id = doc["id"]
    # Upload a collab file with non-empty content; the duplicate must contain the same bytes.
    upload_file(alice, doc_id, "chapter.tex", b"\\section{Hello}").raise_for_status()
    src_id = next(f["id"] for f in list_files(alice, doc_id) if f["filename"] == "chapter.tex")
    r = alice.post(f"{BASE_URL}/api/documents/{doc_id}/files/{src_id}/duplicate")
    assert r.status_code == 201, r.text
    dup = r.json()
    assert dup["filename"] == "chapter copy.tex"
    assert dup["isCollaborative"] is True


def test_duplicate_increments_on_collision(alice):
    doc = create_document(alice, "dup-collision")
    doc_id = doc["id"]
    upload_file(alice, doc_id, "notes.txt", b"hi").raise_for_status()
    src_id = next(f["id"] for f in list_files(alice, doc_id) if f["filename"] == "notes.txt")
    # First duplicate -> "notes copy.txt"
    r1 = alice.post(f"{BASE_URL}/api/documents/{doc_id}/files/{src_id}/duplicate")
    assert r1.json()["filename"] == "notes copy.txt"
    # Second duplicate of the original -> "notes copy 2.txt"
    r2 = alice.post(f"{BASE_URL}/api/documents/{doc_id}/files/{src_id}/duplicate")
    assert r2.json()["filename"] == "notes copy 2.txt", r2.json()
    # Third -> "notes copy 3.txt"
    r3 = alice.post(f"{BASE_URL}/api/documents/{doc_id}/files/{src_id}/duplicate")
    assert r3.json()["filename"] == "notes copy 3.txt"


def test_duplicate_preserves_folder(alice):
    doc = create_document(alice, "dup-folder")
    doc_id = doc["id"]
    upload_file(alice, doc_id, "src/util.tex", b"util").raise_for_status()
    src_id = next(f["id"] for f in list_files(alice, doc_id) if f["filename"] == "src/util.tex")
    r = alice.post(f"{BASE_URL}/api/documents/{doc_id}/files/{src_id}/duplicate")
    assert r.json()["filename"] == "src/util copy.tex"


# Note: the no-extension case ("Makefile" -> "Makefile copy") is handled by the
# naming logic in DocumentService.GenerateUniqueDuplicateFilenameAsync, but the
# upload endpoint rejects extension-less filenames upstream (ValidateFilename),
# so we can't actually create one through the API to test the round-trip.


def test_duplicate_requires_editor(alice, bob):
    doc = create_document(alice, "dup-perms")
    doc_id = doc["id"]
    upload_file(alice, doc_id, "shared.txt", b"x").raise_for_status()
    sid = next(f["id"] for f in list_files(alice, doc_id) if f["filename"] == "shared.txt")
    # bob has no access at all yet
    r = bob.post(f"{BASE_URL}/api/documents/{doc_id}/files/{sid}/duplicate")
    assert r.status_code == 403


# ── folder rename ────────────────────────────────────────────────────────────


def test_folder_rename_moves_all_files_under_prefix(alice):
    doc = create_document(alice, "fr-basic")
    doc_id = doc["id"]
    upload_file(alice, doc_id, "src/a.tex", b"a").raise_for_status()
    upload_file(alice, doc_id, "src/b.tex", b"b").raise_for_status()
    upload_file(alice, doc_id, "other.tex", b"o").raise_for_status()

    r = alice.post(f"{BASE_URL}/api/documents/{doc_id}/folders/rename",
                   json={"from": "src", "to": "lib"})
    assert r.status_code == 200, r.text
    assert r.json()["renamedCount"] == 2

    assert assert_filenames(alice, doc_id, ["lib/a.tex", "lib/b.tex", "main.tex", "other.tex"])


def test_folder_rename_to_root_flattens(alice):
    doc = create_document(alice, "fr-flat")
    doc_id = doc["id"]
    upload_file(alice, doc_id, "src/a.tex", b"a").raise_for_status()
    upload_file(alice, doc_id, "src/b.tex", b"b").raise_for_status()

    r = alice.post(f"{BASE_URL}/api/documents/{doc_id}/folders/rename",
                   json={"from": "src", "to": ""})
    assert r.status_code == 200, r.text
    assert assert_filenames(alice, doc_id, ["a.tex", "b.tex", "main.tex"])


def test_folder_rename_aborts_on_collision_no_partial_state(alice):
    """Critical: pre-validation must roll back BEFORE any file is renamed.
    Previously the FE looped per-file PATCHes; a mid-loop conflict left the
    document half-renamed. The new endpoint must either succeed wholesale or
    leave every file untouched."""
    doc = create_document(alice, "fr-collide")
    doc_id = doc["id"]
    upload_file(alice, doc_id, "src/a.tex", b"a").raise_for_status()
    upload_file(alice, doc_id, "src/b.tex", b"b").raise_for_status()
    upload_file(alice, doc_id, "lib/a.tex", b"existing").raise_for_status()  # collides on rename

    before = sorted(f["filename"] for f in list_files(alice, doc_id))
    r = alice.post(f"{BASE_URL}/api/documents/{doc_id}/folders/rename",
                   json={"from": "src", "to": "lib"})
    assert r.status_code == 409, r.text
    assert "lib/a.tex" in (r.json().get("message") or "")
    # Nothing should have moved.
    after = sorted(f["filename"] for f in list_files(alice, doc_id))
    assert before == after, "folder rename must be atomic; partial state detected"


def test_folder_rename_refuses_into_itself(alice):
    doc = create_document(alice, "fr-self")
    doc_id = doc["id"]
    upload_file(alice, doc_id, "src/a.tex", b"a").raise_for_status()
    r = alice.post(f"{BASE_URL}/api/documents/{doc_id}/folders/rename",
                   json={"from": "src", "to": "src/inner"})
    assert r.status_code == 400


def test_folder_rename_keeps_entrypoint_pointer(alice):
    doc = create_document(alice, "fr-entry")
    doc_id = doc["id"]
    # Make a folder-nested file the entrypoint, then rename the folder.
    upload_file(alice, doc_id, "src/main.tex",
                b"\\documentclass{article}\\begin{document}x\\end{document}").raise_for_status()
    alice.put(f"{BASE_URL}/api/documents/{doc_id}",
              json={"entrypoint": "src/main.tex"}).raise_for_status()

    r = alice.post(f"{BASE_URL}/api/documents/{doc_id}/folders/rename",
                   json={"from": "src", "to": "lib"})
    assert r.status_code == 200, r.text

    detail = alice.get(f"{BASE_URL}/api/documents/{doc_id}").json()
    assert detail["entrypoint"] == "lib/main.tex"


# ── folder delete ───────────────────────────────────────────────────────────


def test_folder_delete_cascades(alice):
    doc = create_document(alice, "fd-basic")
    doc_id = doc["id"]
    upload_file(alice, doc_id, "tmp/a.tex", b"a").raise_for_status()
    upload_file(alice, doc_id, "tmp/b.tex", b"b").raise_for_status()
    upload_file(alice, doc_id, "keep.tex", b"k").raise_for_status()

    r = alice.post(f"{BASE_URL}/api/documents/{doc_id}/folders/delete",
                   json={"path": "tmp"})
    assert r.status_code == 200, r.text
    assert r.json()["deletedCount"] == 2

    assert assert_filenames(alice, doc_id, ["keep.tex", "main.tex"])


def test_folder_delete_refuses_when_entrypoint_inside(alice):
    doc = create_document(alice, "fd-entry")
    doc_id = doc["id"]
    upload_file(alice, doc_id, "src/main.tex",
                b"\\documentclass{article}\\begin{document}x\\end{document}").raise_for_status()
    alice.put(f"{BASE_URL}/api/documents/{doc_id}",
              json={"entrypoint": "src/main.tex"}).raise_for_status()

    r = alice.post(f"{BASE_URL}/api/documents/{doc_id}/folders/delete",
                   json={"path": "src"})
    assert r.status_code == 409
    # File should still exist after the refusal.
    assert any(f["filename"] == "src/main.tex" for f in list_files(alice, doc_id))


def test_folder_delete_empty_folder_is_noop(alice):
    """Deleting a path with no files under it returns 200 with deletedCount 0
    (not an error). Matches the user's expectation that empty folders aren't
    persisted in the DB anyway — they only exist as filename prefixes."""
    doc = create_document(alice, "fd-empty")
    doc_id = doc["id"]
    r = alice.post(f"{BASE_URL}/api/documents/{doc_id}/folders/delete",
                   json={"path": "nonexistent"})
    assert r.status_code == 200
    assert r.json()["deletedCount"] == 0
