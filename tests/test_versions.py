"""Version snapshots: create / list / get-source / delete / restore + permission boundaries.
Includes two xfail tests documenting deferred bug #4 (entrypoint file_id not captured)."""
import pytest

from conftest import BASE_URL, upload_file

MINIMAL_TEX = b"\\documentclass{article}\\begin{document}Versioned content\\end{document}"


def test_create_version(document):
    session, doc_id = document
    r = session.post(f"{BASE_URL}/api/documents/{doc_id}/versions",
                     json={"label": "v1", "message": "first snapshot"})
    assert r.status_code == 201
    assert r.json()["label"] == "v1"


def test_list_versions(document):
    session, doc_id = document
    session.post(f"{BASE_URL}/api/documents/{doc_id}/versions", json={"label": "v1"})
    session.post(f"{BASE_URL}/api/documents/{doc_id}/versions", json={"label": "v2"})
    listing = session.get(f"{BASE_URL}/api/documents/{doc_id}/versions").json()
    labels = [v["label"] for v in listing]
    assert "v1" in labels and "v2" in labels


def test_get_version_returns_source_text(document):
    session, doc_id = document
    upload_file(session, doc_id, "main.tex", MINIMAL_TEX).raise_for_status()
    vid = session.post(f"{BASE_URL}/api/documents/{doc_id}/versions",
                       json={"label": "snap"}).json()["id"]
    r = session.get(f"{BASE_URL}/api/documents/{doc_id}/versions/{vid}")
    assert r.status_code == 200
    assert "Versioned content" in r.json()["sourceText"]


def test_delete_version_by_owner(document):
    session, doc_id = document
    vid = session.post(f"{BASE_URL}/api/documents/{doc_id}/versions", json={"label": "v"}).json()["id"]
    r = session.delete(f"{BASE_URL}/api/documents/{doc_id}/versions/{vid}")
    assert r.status_code == 200


def test_delete_version_by_editor_forbidden(document, bob):
    session, doc_id = document
    session.post(f"{BASE_URL}/api/documents/{doc_id}/collaborators",
                 json={"email": bob.email, "role": "editor"})
    vid = session.post(f"{BASE_URL}/api/documents/{doc_id}/versions", json={"label": "v"}).json()["id"]
    r = bob.delete(f"{BASE_URL}/api/documents/{doc_id}/versions/{vid}")
    assert r.status_code == 403


def test_create_version_by_viewer_forbidden(document, bob):
    session, doc_id = document
    session.post(f"{BASE_URL}/api/documents/{doc_id}/collaborators",
                 json={"email": bob.email, "role": "viewer"})
    r = bob.post(f"{BASE_URL}/api/documents/{doc_id}/versions", json={"label": "nope"})
    assert r.status_code == 403


def test_restore_version(document):
    session, doc_id = document
    upload_file(session, doc_id, "main.tex", MINIMAL_TEX).raise_for_status()
    vid = session.post(f"{BASE_URL}/api/documents/{doc_id}/versions", json={"label": "v1"}).json()["id"]
    r = session.post(f"{BASE_URL}/api/documents/{doc_id}/versions/{vid}/restore")
    assert r.status_code == 200


# ── File-existence versioning (ported: version snapshots capture the file set, and
#    restore reconciles file existence + filenames via two-phase rename) ─────────────

def _files(session, doc_id):
    return sorted(f["filename"] for f in session.get(f"{BASE_URL}/api/documents/{doc_id}/files").json())


def test_version_captures_file_set(document):
    session, doc_id = document
    upload_file(session, doc_id, "refs.bib", b"@a{x}").raise_for_status()
    # Version captures current files; deleting after shouldn't affect the snapshot's restorability.
    vid = session.post(f"{BASE_URL}/api/documents/{doc_id}/versions", json={"label": "v1"}).json()["id"]
    bib_id = next(f["id"] for f in session.get(f"{BASE_URL}/api/documents/{doc_id}/files").json()
                  if f["filename"] == "refs.bib")
    session.delete(f"{BASE_URL}/api/documents/{doc_id}/files/{bib_id}")
    assert "refs.bib" not in _files(session, doc_id)
    # Restore brings it back.
    session.post(f"{BASE_URL}/api/documents/{doc_id}/versions/{vid}/restore")
    assert "refs.bib" in _files(session, doc_id)


def test_soft_delete_restore_cycle(document):
    session, doc_id = document
    upload_file(session, doc_id, "keep.bib", b"@a{x}").raise_for_status()
    vid = session.post(f"{BASE_URL}/api/documents/{doc_id}/versions", json={"label": "v"}).json()["id"]
    keep_id = next(f["id"] for f in session.get(f"{BASE_URL}/api/documents/{doc_id}/files").json()
                   if f["filename"] == "keep.bib")
    session.delete(f"{BASE_URL}/api/documents/{doc_id}/files/{keep_id}")
    session.post(f"{BASE_URL}/api/documents/{doc_id}/versions/{vid}/restore")
    assert "keep.bib" in _files(session, doc_id)


def test_filename_swap_restore(document):
    # A↔B filename swap must restore correctly via the two-phase rename.
    session, doc_id = document
    a = upload_file(session, doc_id, "alpha.tex", b"A").json()
    b = upload_file(session, doc_id, "beta.tex", b"B").json()
    vid = session.post(f"{BASE_URL}/api/documents/{doc_id}/versions", json={"label": "v"}).json()["id"]
    # swap names via a temp
    session.patch(f"{BASE_URL}/api/documents/{doc_id}/files/{a['id']}", json={"newFilename": "tmp.tex"})
    session.patch(f"{BASE_URL}/api/documents/{doc_id}/files/{b['id']}", json={"newFilename": "alpha.tex"})
    session.patch(f"{BASE_URL}/api/documents/{doc_id}/files/{a['id']}", json={"newFilename": "beta.tex"})
    session.post(f"{BASE_URL}/api/documents/{doc_id}/versions/{vid}/restore")
    assert _files(session, doc_id) == ["alpha.tex", "beta.tex", "main.tex"]


def test_upload_then_restore_then_upload(document):
    session, doc_id = document
    upload_file(session, doc_id, "preserve.bib", b"@p{x}").raise_for_status()
    vid = session.post(f"{BASE_URL}/api/documents/{doc_id}/versions", json={"label": "v1"}).json()["id"]
    upload_file(session, doc_id, "trash.bib", b"@t{x}").raise_for_status()
    session.post(f"{BASE_URL}/api/documents/{doc_id}/versions/{vid}/restore")
    assert _files(session, doc_id) == ["main.tex", "preserve.bib"]
    # upload after restore works (fresh room)
    upload_file(session, doc_id, "after.bib", b"@a{x}").raise_for_status()
    assert "after.bib" in _files(session, doc_id)


def test_version_source_text_survives_entrypoint_rename(document):
    session, doc_id = document
    upload_file(session, doc_id, "main.tex", MINIMAL_TEX).raise_for_status()
    main_id = next(f["id"] for f in session.get(f"{BASE_URL}/api/documents/{doc_id}/files").json()
                   if f["filename"] == "main.tex")
    vid = session.post(f"{BASE_URL}/api/documents/{doc_id}/versions", json={"label": "v1"}).json()["id"]

    # Rename the entrypoint (syncs Document.Entrypoint to paper.tex).
    session.patch(f"{BASE_URL}/api/documents/{doc_id}/files/{main_id}", json={"newFilename": "paper.tex"})

    # The version's source should still resolve (it was the entrypoint at snapshot time).
    r = session.get(f"{BASE_URL}/api/documents/{doc_id}/versions/{vid}")
    assert "Versioned content" in (r.json().get("sourceText") or "")


def test_compile_works_after_rename_then_restore(document):
    session, doc_id = document
    upload_file(session, doc_id, "main.tex", MINIMAL_TEX).raise_for_status()
    main_id = next(f["id"] for f in session.get(f"{BASE_URL}/api/documents/{doc_id}/files").json()
                   if f["filename"] == "main.tex")
    vid = session.post(f"{BASE_URL}/api/documents/{doc_id}/versions", json={"label": "v1"}).json()["id"]

    session.patch(f"{BASE_URL}/api/documents/{doc_id}/files/{main_id}", json={"newFilename": "paper.tex"})
    session.post(f"{BASE_URL}/api/documents/{doc_id}/versions/{vid}/restore")

    r = session.post(f"{BASE_URL}/api/documents/{doc_id}/compile")
    assert r.status_code == 200
