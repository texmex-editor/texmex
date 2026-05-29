"""Compile endpoint: happy path + reachable edge cases.

Note: "entrypoint not found" (422) is NOT reachable via the public API — the entrypoint
integrity guards (can't delete entrypoint, rename syncs Document.Entrypoint, PUT validates)
prevent orphaning it. The one path that DOES break it is rename+restore (deferred bug #4),
covered by an xfail in test_versions.py."""
import threading

import pytest

from conftest import BASE_URL, create_document, upload_file

MINIMAL_TEX = b"\\documentclass{article}\\begin{document}Hello compile\\end{document}"


def test_compile_multi_file_produces_pdf(alice):
    doc = create_document(alice, "compile-doc")
    doc_id = doc["id"]
    upload_file(alice, doc_id, "main.tex",
                b"\\documentclass{article}\\begin{document}\\input{intro}\\end{document}").raise_for_status()
    upload_file(alice, doc_id, "intro.tex", b"Hello from intro.").raise_for_status()

    r = alice.post(f"{BASE_URL}/api/documents/{doc_id}/compile")
    assert r.status_code == 200
    assert r.headers.get("content-type", "").startswith("application/pdf")
    assert r.content[:4] == b"%PDF"


def test_compile_empty_content_returns_422(document):
    session, doc_id = document
    # Fresh doc: main.tex exists but is empty → nothing to compile.
    r = session.post(f"{BASE_URL}/api/documents/{doc_id}/compile")
    assert r.status_code == 422


def test_compile_with_nested_entrypoint_in_folder(alice):
    """Regression: when the entrypoint lives in a subfolder (e.g. "lol/main.tex"),
    the latex-compiler used to compute pdfFile as workDir/lol/main.pdf and
    return "PDF not generated — check LaTeX source" because pdflatex with
    --outdir writes the output to workDir/main.pdf (bare basename, no
    subdir). The whole document set was uncompilable. This caught the bug
    after the new files-panel UX made it easy for users to move the
    entrypoint into a folder."""
    doc = create_document(alice, "compile-nested")
    doc_id = doc["id"]
    upload_file(alice, doc_id, "src/main.tex", MINIMAL_TEX).raise_for_status()
    # Point the entrypoint at the nested file.
    alice.put(f"{BASE_URL}/api/documents/{doc_id}",
              json={"entrypoint": "src/main.tex"}).raise_for_status()

    r = alice.post(f"{BASE_URL}/api/documents/{doc_id}/compile")
    assert r.status_code == 200, r.text[:300]
    assert r.headers.get("content-type", "").startswith("application/pdf")
    assert r.content[:4] == b"%PDF"


def test_compile_static_and_collab_files_together(alice):
    doc = create_document(alice, "mixed-doc")
    doc_id = doc["id"]
    upload_file(alice, doc_id, "main.tex",
                b"\\documentclass{article}\\begin{document}Mixed\\end{document}").raise_for_status()
    # A static file alongside — should be assembled into the workdir without breaking compile.
    upload_file(alice, doc_id, "logo.png", b"\x89PNG\r\n\x1a\n" + b"\x00" * 40,
                content_type="image/png").raise_for_status()
    r = alice.post(f"{BASE_URL}/api/documents/{doc_id}/compile")
    assert r.status_code == 200


@pytest.mark.xfail(reason="File-set drift (409) requires a concurrent file mutation landing inside the "
                          "compile window — inherently racy, not deterministic in a single client.",
                   strict=False)
def test_compile_file_set_drift_returns_409(alice):
    doc = create_document(alice, "drift-doc")
    doc_id = doc["id"]
    upload_file(alice, doc_id, "main.tex", MINIMAL_TEX).raise_for_status()

    results = {}

    def compile_doc():
        results["compile"] = alice.post(f"{BASE_URL}/api/documents/{doc_id}/compile").status_code

    def mutate():
        upload_file(alice, doc_id, "extra.bib", b"@x{y}")

    t1 = threading.Thread(target=compile_doc)
    t2 = threading.Thread(target=mutate)
    t1.start(); t2.start(); t1.join(); t2.join()

    assert results["compile"] == 409
