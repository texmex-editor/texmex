"""File API: upload / classification / soft-delete / multi-file / entrypoint guards /
cross-type replace / content validation / allowlist. Ported from the original
multi_file_collab.py suite and adapted to fixtures + requests."""
import uuid

import requests

from conftest import (BASE_URL, create_document, upload_file, replace_file, list_files,
                      get_main_file_id, PNG_HEADER, PDF_HEADER, TTF_HEADER)


def test_blank_doc_has_collaborative_entrypoint(document):
    session, doc_id = document
    files = list_files(session, doc_id)
    assert len(files) == 1
    assert files[0]["filename"] == "main.tex"
    assert files[0]["isCollaborative"] is True


def test_upload_classifies_by_extension(document):
    session, doc_id = document
    assert upload_file(session, doc_id, "refs.bib", b"@book{x}").json()["isCollaborative"] is True
    assert upload_file(session, doc_id, "custom.sty", b"\\ProvidesPackage{c}").json()["isCollaborative"] is True
    assert upload_file(session, doc_id, "logo.png", PNG_HEADER, "image/png").json()["isCollaborative"] is False
    assert upload_file(session, doc_id, "data.csv", b"a,b\n1,2").json()["isCollaborative"] is False


def test_filename_collision_replaces_upsert(document):
    session, doc_id = document
    first = upload_file(session, doc_id, "notes.txt", b"first").json()
    second = upload_file(session, doc_id, "notes.txt", b"second").json()
    assert first["id"] == second["id"]  # same row, upserted


def test_soft_delete_excludes_from_list(document):
    session, doc_id = document
    f = upload_file(session, doc_id, "temp.txt", b"hi").json()
    assert session.delete(f"{BASE_URL}/api/documents/{doc_id}/files/{f['id']}").status_code == 200
    assert not any(x["id"] == f["id"] for x in list_files(session, doc_id))


def test_cannot_delete_entrypoint(document):
    session, doc_id = document
    main_id = get_main_file_id(session, doc_id)
    r = session.delete(f"{BASE_URL}/api/documents/{doc_id}/files/{main_id}")
    assert r.status_code == 409


def test_rename_across_category_blocked(document):
    session, doc_id = document
    tex = upload_file(session, doc_id, "notes.tex", b"\\section{N}").json()
    r = session.patch(f"{BASE_URL}/api/documents/{doc_id}/files/{tex['id']}",
                      json={"newFilename": "notes.png"})
    assert r.status_code == 400
    # within-static cross-category also blocked
    csv = upload_file(session, doc_id, "data.csv", b"a,b").json()
    r2 = session.patch(f"{BASE_URL}/api/documents/{doc_id}/files/{csv['id']}",
                       json={"newFilename": "data.png"})
    assert r2.status_code == 400


def test_same_category_rename_succeeds(document):
    session, doc_id = document
    bib = upload_file(session, doc_id, "refs.bib", b"@a{x}").json()
    r = session.patch(f"{BASE_URL}/api/documents/{doc_id}/files/{bib['id']}",
                      json={"newFilename": "refs.txt"})
    assert r.status_code == 200


def test_entrypoint_rename_syncs_document(document):
    session, doc_id = document
    main_id = get_main_file_id(session, doc_id)
    session.patch(f"{BASE_URL}/api/documents/{doc_id}/files/{main_id}", json={"newFilename": "paper.tex"})
    doc = session.get(f"{BASE_URL}/api/documents/{doc_id}").json()
    assert doc["entrypoint"] == "paper.tex"


def test_blocked_js_prototype_filenames(document):
    session, doc_id = document
    for name in ["prototype.tex", "__proto__.tex", "constructor.bib"]:
        assert upload_file(session, doc_id, name, b"x").status_code == 400


def test_concurrent_uploads_on_idle_doc(document):
    import threading
    session, doc_id = document
    errors = []

    def up(i):
        r = upload_file(session, doc_id, f"concurrent-{i}.bib", f"@x{{a{i}}}".encode())
        if r.status_code not in (200, 201):
            errors.append((i, r.status_code))

    threads = [threading.Thread(target=up, args=(i,)) for i in range(8)]
    for t in threads: t.start()
    for t in threads: t.join()
    assert not errors
    assert len(list_files(session, doc_id)) == 9  # main + 8


# ── Cross-type replace ───────────────────────────────────────────────────

def test_cross_type_replace_collab_to_static(document):
    session, doc_id = document
    bib = upload_file(session, doc_id, "refs.bib", b"@book{x}").json()
    new = replace_file(session, doc_id, bib["id"], "preview.png", PNG_HEADER, "image/png").json()
    assert new["isCollaborative"] is False
    assert new["id"] != bib["id"]
    assert not any(f["id"] == bib["id"] for f in list_files(session, doc_id))


def test_cross_type_replace_static_to_collab(document):
    session, doc_id = document
    png = upload_file(session, doc_id, "logo.png", PNG_HEADER, "image/png").json()
    new = replace_file(session, doc_id, png["id"], "notes.tex", b"\\section{N}").json()
    assert new["isCollaborative"] is True
    assert new["id"] != png["id"]


def test_cross_type_replace_entrypoint_blocked(document):
    session, doc_id = document
    main_id = get_main_file_id(session, doc_id)
    r = replace_file(session, doc_id, main_id, "preview.png", PNG_HEADER, "image/png")
    assert r.status_code == 409


def test_cross_type_replace_filename_collision(document):
    session, doc_id = document
    bib = upload_file(session, doc_id, "refs.bib", b"@a{x}").json()
    upload_file(session, doc_id, "data.csv", b"a,b").raise_for_status()
    r = replace_file(session, doc_id, bib["id"], "data.csv", b"x,y")
    assert r.status_code == 409


# ── Content validation + allowlist ──────────────────────────────────────

def test_binary_under_collab_extension_rejected(document):
    session, doc_id = document
    assert upload_file(session, doc_id, "should-be-tex.tex", PNG_HEADER).status_code == 415


def test_pdf_uploaded_as_png_rejected(document):
    session, doc_id = document
    assert upload_file(session, doc_id, "fake.png", PDF_HEADER, "image/png").status_code == 415


def test_genuine_png_accepted(document):
    session, doc_id = document
    assert upload_file(session, doc_id, "logo.png", PNG_HEADER, "image/png").status_code in (200, 201)


def test_genuine_pdf_accepted(document):
    session, doc_id = document
    assert upload_file(session, doc_id, "ref.pdf", PDF_HEADER, "application/pdf").status_code in (200, 201)


def test_ttf_font_accepted(document):
    session, doc_id = document
    r = upload_file(session, doc_id, "font.ttf", TTF_HEADER, "font/ttf")
    assert r.status_code in (200, 201)
    assert r.json()["category"] == "font"


def test_static_text_must_be_utf8(document):
    session, doc_id = document
    assert upload_file(session, doc_id, "data.csv", PNG_HEADER, "text/csv").status_code == 415


def test_allowlist_rejects_unknown_and_dangerous(document):
    session, doc_id = document
    for name in ["script.sh", "malware.exe", "archive.zip", "graphic.eps", "lib.dll"]:
        assert upload_file(session, doc_id, name, b"contents").status_code == 400


def test_file_response_includes_category(document):
    session, doc_id = document
    bib = upload_file(session, doc_id, "refs.bib", b"@a{x}").json()
    png = upload_file(session, doc_id, "logo.png", PNG_HEADER, "image/png").json()
    assert bib["category"] == "collaborative"
    assert png["category"] == "image"


def test_cross_type_replace_also_validates(document):
    session, doc_id = document
    png = upload_file(session, doc_id, "logo.png", PNG_HEADER, "image/png").json()
    # Try to "convert" to .tex by re-uploading PNG bytes under a .tex name → 415.
    r = replace_file(session, doc_id, png["id"], "converted.tex", PNG_HEADER)
    assert r.status_code == 415
    assert any(f["id"] == png["id"] for f in list_files(session, doc_id))  # old file preserved


def test_anonymous_grant_cookie_alone_cannot_use_collab_api(document, anon):
    session, doc_id = document
    # A bare session (no auth, no grant) cannot list files.
    r = anon.get(f"{BASE_URL}/api/documents/{doc_id}/files")
    assert r.status_code in (401, 403)
