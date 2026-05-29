"""Collaborator management + permission boundaries."""
from conftest import BASE_URL


def test_add_collaborator_by_email(document, bob):
    session, doc_id = document
    r = session.post(f"{BASE_URL}/api/documents/{doc_id}/collaborators",
                     json={"email": bob.email, "role": "editor"})
    assert r.status_code == 201
    assert r.json()["email"] == bob.email
    assert r.json()["role"] == "editor"

    listing = session.get(f"{BASE_URL}/api/documents/{doc_id}/collaborators").json()
    emails = [c["email"] for c in listing["collaborators"]]
    assert bob.email in emails


def test_add_nonexistent_email_returns_404(document):
    session, doc_id = document
    r = session.post(f"{BASE_URL}/api/documents/{doc_id}/collaborators",
                     json={"email": "nobody@nowhere.test", "role": "editor"})
    assert r.status_code == 404


def test_add_self_returns_400(document):
    session, doc_id = document
    r = session.post(f"{BASE_URL}/api/documents/{doc_id}/collaborators",
                     json={"email": session.email, "role": "editor"})
    assert r.status_code == 400


def test_add_duplicate_returns_409(document, bob):
    session, doc_id = document
    session.post(f"{BASE_URL}/api/documents/{doc_id}/collaborators",
                 json={"email": bob.email, "role": "editor"})
    again = session.post(f"{BASE_URL}/api/documents/{doc_id}/collaborators",
                         json={"email": bob.email, "role": "editor"})
    assert again.status_code == 409


def test_add_invalid_role_returns_400(document, bob):
    session, doc_id = document
    r = session.post(f"{BASE_URL}/api/documents/{doc_id}/collaborators",
                     json={"email": bob.email, "role": "superuser"})
    assert r.status_code == 400


def test_change_role_editor_to_viewer(document, bob):
    session, doc_id = document
    session.post(f"{BASE_URL}/api/documents/{doc_id}/collaborators",
                 json={"email": bob.email, "role": "editor"})
    r = session.put(f"{BASE_URL}/api/documents/{doc_id}/collaborators/{bob.user_id}",
                    json={"role": "viewer"})
    assert r.status_code == 200
    assert r.json()["role"] == "viewer"


def test_change_owner_role_returns_400(document):
    session, doc_id = document
    r = session.put(f"{BASE_URL}/api/documents/{doc_id}/collaborators/{session.user_id}",
                    json={"role": "viewer"})
    assert r.status_code == 400


def test_remove_collaborator_by_owner(document, bob):
    session, doc_id = document
    session.post(f"{BASE_URL}/api/documents/{doc_id}/collaborators",
                 json={"email": bob.email, "role": "editor"})
    r = session.delete(f"{BASE_URL}/api/documents/{doc_id}/collaborators/{bob.user_id}")
    assert r.status_code == 200


def test_remove_self(document, bob):
    session, doc_id = document
    session.post(f"{BASE_URL}/api/documents/{doc_id}/collaborators",
                 json={"email": bob.email, "role": "editor"})
    r = bob.delete(f"{BASE_URL}/api/documents/{doc_id}/collaborators/{bob.user_id}")
    assert r.status_code == 200


def test_add_by_non_owner_forbidden(document, bob):
    session, doc_id = document
    session.post(f"{BASE_URL}/api/documents/{doc_id}/collaborators",
                 json={"email": bob.email, "role": "editor"})
    # editor bob tries to add someone — only owner may
    r = bob.post(f"{BASE_URL}/api/documents/{doc_id}/collaborators",
                 json={"email": "x@y.test", "role": "editor"})
    assert r.status_code == 403
