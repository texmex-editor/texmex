"""Templates: instantiation, save-as-template, delete, and the auth gate."""
import requests

from conftest import BASE_URL, create_document, upload_file, list_files


def test_instantiation_classifies_files(alice):
    templates = alice.get(f"{BASE_URL}/api/templates").json()
    article = next((t for t in templates if t["slug"] == "article-basic"), None)
    if article is None:
        import pytest
        pytest.skip("article-basic template not seeded")

    doc = create_document(alice, "from-article", template_id=article["id"])
    files = list_files(alice, doc["id"])
    main = next((f for f in files if f["filename"] == "main.tex"), None)
    assert main is not None and main["isCollaborative"] is True

    bib = next((f for f in files if f["filename"] == "references.bib"), None)
    if bib is not None:
        assert bib["isCollaborative"] is True


def test_save_as_then_instantiate_roundtrip(alice):
    doc = create_document(alice, "roundtrip-src")
    doc_id = doc["id"]
    upload_file(alice, doc_id, "main.tex",
                b"\\documentclass{article}\\begin{document}RT\\end{document}").raise_for_status()
    bib = upload_file(alice, doc_id, "refs.bib", b"@book{x,title={Y}}")
    bib.raise_for_status()
    files = list_files(alice, doc_id)
    file_ids = [f["id"] for f in files]

    tmpl = alice.post(f"{BASE_URL}/api/documents/{doc_id}/save-as-template",
                      json={"title": "RT Template", "category": "article", "isPublic": False,
                            "fileIds": file_ids})
    assert tmpl.status_code == 201
    tmpl_id = tmpl.json()["id"]

    new_doc = create_document(alice, "from-rt", template_id=tmpl_id)
    new_files = sorted(f["filename"] for f in list_files(alice, new_doc["id"]))
    assert "main.tex" in new_files and "refs.bib" in new_files


def test_delete_user_template(alice):
    doc = create_document(alice, "del-src")
    upload_file(alice, doc["id"], "main.tex", b"\\documentclass{article}\\begin{document}D\\end{document}").raise_for_status()
    main_id = next(f["id"] for f in list_files(alice, doc["id"]) if f["filename"] == "main.tex")
    tmpl_id = alice.post(f"{BASE_URL}/api/documents/{doc['id']}/save-as-template",
                         json={"title": "Deletable", "category": "article", "isPublic": False,
                               "fileIds": [main_id]}).json()["id"]
    r = alice.delete(f"{BASE_URL}/api/templates/{tmpl_id}")
    assert r.status_code == 200


def test_system_template_not_deletable(alice):
    templates = alice.get(f"{BASE_URL}/api/templates").json()
    system = next((t for t in templates if t.get("isSystem")), None)
    if system is None:
        import pytest
        pytest.skip("no system template seeded")
    r = alice.delete(f"{BASE_URL}/api/templates/{system['id']}")
    assert r.status_code in (403, 404)


def test_anonymous_locked_out_of_templates():
    r = requests.get(f"{BASE_URL}/api/templates")
    assert r.status_code == 401


# ── Template.EntrypointFilename coverage ─────────────────────────────────────
# These verify that the source document's entrypoint (e.g. "report.tex") rides
# along through save-as-template + instantiate, instead of being silently
# rewritten to "main.tex". The NULL-fallback branch in CreateFromTemplateAsync
# (DocumentService.cs:74) is intentionally not tested here — it only fires for
# rows inserted before the column existed, which the test harness can't produce
# without raw SQL access. The fallback is one line and obvious from the diff.


def test_save_as_template_preserves_non_default_entrypoint(alice):
    doc = create_document(alice, "ep-nondefault")
    doc_id = doc["id"]
    upload_file(alice, doc_id, "report.tex",
                b"\\documentclass{report}\\begin{document}R\\end{document}").raise_for_status()
    alice.put(f"{BASE_URL}/api/documents/{doc_id}",
              json={"entrypoint": "report.tex"}).raise_for_status()

    files = list_files(alice, doc_id)
    file_ids = [f["id"] for f in files]
    tmpl = alice.post(f"{BASE_URL}/api/documents/{doc_id}/save-as-template",
                      json={"title": "Report Template", "category": "report",
                            "isPublic": False, "fileIds": file_ids})
    assert tmpl.status_code == 201, tmpl.text

    new_doc = create_document(alice, "from-report", template_id=tmpl.json()["id"])
    detail = alice.get(f"{BASE_URL}/api/documents/{new_doc['id']}").json()
    assert detail["entrypoint"] == "report.tex"

    new_files = sorted(f["filename"] for f in list_files(alice, new_doc["id"]))
    assert "report.tex" in new_files
    # main.tex was a non-entrypoint collab file in the source — carries over too.
    assert "main.tex" in new_files


def test_save_as_template_default_entrypoint_roundtrip(alice):
    doc = create_document(alice, "ep-default")
    doc_id = doc["id"]
    upload_file(alice, doc_id, "main.tex",
                b"\\documentclass{article}\\begin{document}D\\end{document}").raise_for_status()

    tmpl = alice.post(f"{BASE_URL}/api/documents/{doc_id}/save-as-template",
                      json={"title": "Default EP", "category": "article",
                            "isPublic": False, "fileIds": []})
    assert tmpl.status_code == 201, tmpl.text

    new_doc = create_document(alice, "from-default", template_id=tmpl.json()["id"])
    detail = alice.get(f"{BASE_URL}/api/documents/{new_doc['id']}").json()
    assert detail["entrypoint"] == "main.tex"


def test_system_template_instantiates_with_main_tex(alice):
    templates = alice.get(f"{BASE_URL}/api/templates").json()
    system = next((t for t in templates if t.get("isSystem")), None)
    if system is None:
        import pytest
        pytest.skip("no system template seeded")
    new_doc = create_document(alice, "from-system", template_id=system["id"])
    detail = alice.get(f"{BASE_URL}/api/documents/{new_doc['id']}").json()
    assert detail["entrypoint"] == "main.tex"
