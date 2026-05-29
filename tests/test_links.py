"""Invite links (authenticated) + anonymous access links."""
from conftest import BASE_URL, register_user


# ── Invite links ───────────────────────────────────────────────────────

def test_create_invite_link_and_list(document):
    session, doc_id = document
    r = session.post(f"{BASE_URL}/api/documents/{doc_id}/links", json={"permission": "editor"})
    assert r.status_code == 201
    link = r.json()
    assert link["permission"] == "editor"
    assert link["useCount"] == 0

    listing = session.get(f"{BASE_URL}/api/documents/{doc_id}/links").json()
    assert any(l["id"] == link["id"] for l in listing)


def test_join_invite_link_becomes_collaborator(document):
    session, doc_id = document
    token = session.post(f"{BASE_URL}/api/documents/{doc_id}/links",
                         json={"permission": "editor"}).json()["token"]
    joiner = register_user("joiner")
    r = joiner.post(f"{BASE_URL}/api/join/{token}")
    assert r.status_code == 200
    assert r.json()["documentId"] == doc_id
    assert r.json()["role"] == "editor"


def test_join_increments_use_count_on_limited_link(document):
    # useCount is an enforcement counter — the server only increments it for links that
    # have a MaxUses limit (unlimited links never increment it). So set a limit to observe it.
    session, doc_id = document
    link = session.post(f"{BASE_URL}/api/documents/{doc_id}/links",
                        json={"permission": "viewer", "maxUses": 5}).json()
    register_user("u1").post(f"{BASE_URL}/api/join/{link['token']}")
    refreshed = session.get(f"{BASE_URL}/api/documents/{doc_id}/links").json()
    this_link = next(l for l in refreshed if l["id"] == link["id"])
    assert this_link["useCount"] == 1


def test_join_by_owner_no_increment(document):
    session, doc_id = document
    link = session.post(f"{BASE_URL}/api/documents/{doc_id}/links",
                        json={"permission": "editor"}).json()
    # owner clicks own link
    session.post(f"{BASE_URL}/api/join/{link['token']}")
    refreshed = session.get(f"{BASE_URL}/api/documents/{doc_id}/links").json()
    this_link = next(l for l in refreshed if l["id"] == link["id"])
    assert this_link["useCount"] == 0


def test_max_uses_enforced(document):
    session, doc_id = document
    token = session.post(f"{BASE_URL}/api/documents/{doc_id}/links",
                         json={"permission": "viewer", "maxUses": 1}).json()["token"]
    first = register_user("first").post(f"{BASE_URL}/api/join/{token}")
    assert first.status_code == 200
    second = register_user("second").post(f"{BASE_URL}/api/join/{token}")
    assert second.status_code == 410  # Gone — usage limit reached


def test_revoke_then_join_returns_404(document):
    session, doc_id = document
    link = session.post(f"{BASE_URL}/api/documents/{doc_id}/links",
                        json={"permission": "editor"}).json()
    assert session.delete(f"{BASE_URL}/api/documents/{doc_id}/links/{link['id']}").status_code == 200
    r = register_user("late").post(f"{BASE_URL}/api/join/{link['token']}")
    assert r.status_code == 404


def test_join_invalid_token_returns_404():
    r = register_user("x").post(f"{BASE_URL}/api/join/nonexistenttoken123")
    assert r.status_code == 404


def test_create_link_by_non_owner_forbidden(document, bob):
    session, doc_id = document
    session.post(f"{BASE_URL}/api/documents/{doc_id}/collaborators",
                 json={"email": bob.email, "role": "editor"})
    r = bob.post(f"{BASE_URL}/api/documents/{doc_id}/links", json={"permission": "editor"})
    assert r.status_code == 403


# ── Anonymous links ──────────────────────────────────────────────────────

def test_create_anonymous_link(document):
    session, doc_id = document
    r = session.post(f"{BASE_URL}/api/documents/{doc_id}/anonymous-links",
                     json={"permission": "viewer"})
    assert r.status_code == 201
    assert r.json()["permission"] == "viewer"


def test_join_anonymous_no_session_sets_grant_cookie(document, anon):
    session, doc_id = document
    token = session.post(f"{BASE_URL}/api/documents/{doc_id}/anonymous-links",
                         json={"permission": "editor"}).json()["token"]
    r = anon.post(f"{BASE_URL}/api/join/anonymous/{token}")
    assert r.status_code == 200
    assert r.json()["role"] == "editor"
    assert r.json()["documentId"] == doc_id
    assert "texmex_anonymous_grant" in anon.cookies


def test_join_anonymous_logged_in_grant_with_identity(document, bob):
    session, doc_id = document
    token = session.post(f"{BASE_URL}/api/documents/{doc_id}/anonymous-links",
                         json={"permission": "viewer"}).json()["token"]
    r = bob.post(f"{BASE_URL}/api/join/anonymous/{token}")
    assert r.status_code == 200
    assert "grantId" in r.json()


def test_anonymous_grant_appears_in_collaborator_list(document, anon):
    session, doc_id = document
    token = session.post(f"{BASE_URL}/api/documents/{doc_id}/anonymous-links",
                         json={"permission": "viewer"}).json()["token"]
    anon.post(f"{BASE_URL}/api/join/anonymous/{token}")
    listing = session.get(f"{BASE_URL}/api/documents/{doc_id}/collaborators").json()
    assert len(listing["anonymousUsers"]) >= 1


def test_revoke_anonymous_link_then_join_404(document, anon):
    session, doc_id = document
    link = session.post(f"{BASE_URL}/api/documents/{doc_id}/anonymous-links",
                        json={"permission": "viewer"}).json()
    revoke = session.delete(f"{BASE_URL}/api/documents/{doc_id}/anonymous-links/{link['id']}")
    assert revoke.status_code == 200
    assert "disconnectedUsers" in revoke.json()
    r = anon.post(f"{BASE_URL}/api/join/anonymous/{link['token']}")
    assert r.status_code == 404
