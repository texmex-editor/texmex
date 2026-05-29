"""Document CRUD + permission/validation boundaries."""
from conftest import BASE_URL, create_document, upload_file


def test_create_document_defaults_to_untitled(alice):
    r = alice.post(f"{BASE_URL}/api/documents", json={})
    assert r.status_code == 201
    assert r.json()["title"] == "Untitled"
    assert r.json()["role"] == "owner"


def test_list_returns_owned_and_collaborating(alice, bob):
    own = create_document(alice, "alice's doc")
    shared = create_document(bob, "bob's doc")
    # bob shares with alice as editor
    bob.post(f"{BASE_URL}/api/documents/{shared['id']}/collaborators",
             json={"email": alice.email, "role": "editor"})

    listing = alice.get(f"{BASE_URL}/api/documents").json()
    by_id = {d["id"]: d for d in listing}
    assert by_id[own["id"]]["role"] == "owner"
    assert by_id[shared["id"]]["role"] == "editor"


def test_get_document_role_field_owner(document):
    session, doc_id = document
    r = session.get(f"{BASE_URL}/api/documents/{doc_id}")
    assert r.status_code == 200
    assert r.json()["role"] == "owner"


def test_get_document_forbidden_for_outsider(document, bob):
    _, doc_id = document
    r = bob.get(f"{BASE_URL}/api/documents/{doc_id}")
    assert r.status_code == 403


def test_put_entrypoint_must_match_active_collab_file(document):
    session, doc_id = document
    r = session.put(f"{BASE_URL}/api/documents/{doc_id}",
                    json={"entrypoint": "does-not-exist.tex"})
    assert r.status_code == 400


def test_put_entrypoint_to_existing_collab_file_succeeds(document):
    session, doc_id = document
    upload_file(session, doc_id, "chapter.tex", b"\\section{Ch}").raise_for_status()
    r = session.put(f"{BASE_URL}/api/documents/{doc_id}", json={"entrypoint": "chapter.tex"})
    assert r.status_code == 200
    assert r.json()["entrypoint"] == "chapter.tex"


def test_put_by_viewer_forbidden(document, bob):
    session, doc_id = document
    session.post(f"{BASE_URL}/api/documents/{doc_id}/collaborators",
                 json={"email": bob.email, "role": "viewer"})
    r = bob.put(f"{BASE_URL}/api/documents/{doc_id}", json={"title": "hijack"})
    assert r.status_code == 403


def test_delete_by_non_owner_forbidden(document, bob):
    session, doc_id = document
    session.post(f"{BASE_URL}/api/documents/{doc_id}/collaborators",
                 json={"email": bob.email, "role": "editor"})
    # even an editor can't delete
    r = bob.delete(f"{BASE_URL}/api/documents/{doc_id}")
    assert r.status_code == 403


def test_delete_by_owner_succeeds(document):
    session, doc_id = document
    r = session.delete(f"{BASE_URL}/api/documents/{doc_id}")
    assert r.status_code == 200
    # gone afterwards
    assert session.get(f"{BASE_URL}/api/documents/{doc_id}").status_code in (403, 404)
