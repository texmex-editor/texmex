"""Validation error messages.

Confirms the curated DataAnnotation ErrorMessage strings flow through the
StatusMessageProblemDetailsWriter to the client untouched, joined when
multiple fields fail at once, with no field names or schema details leaked.
"""
import requests

from conftest import BASE_URL, create_document


def post(path, json=None, session=None):
    s = session or requests
    return s.post(f"{BASE_URL}{path}", json=json)


def msg(response):
    """Pull the message out of the unified { status, message } error shape."""
    body = response.json()
    assert body.get("status") == "error", body
    return body.get("message", "")


# ── auth ─────────────────────────────────────────────────────────────────────


def test_register_missing_email_short_password_short_displayname_joins_all_three():
    r = post("/api/auth/register",
             {"email": "", "password": "x", "displayName": "a"})
    assert r.status_code == 400
    m = msg(r)
    assert "Email is required." in m
    assert "Password must be at least 8 characters." in m
    assert "Display name must be at least 3 characters." in m
    # Field names must never leak.
    assert "field" not in m.lower()


def test_register_bad_email_format():
    r = post("/api/auth/register",
             {"email": "notanemail", "password": "validpass1", "displayName": "Test User"})
    assert r.status_code == 400
    assert msg(r) == "Enter a valid email address."


def test_login_missing_password():
    r = post("/api/auth/login", {"email": "x@y.com", "password": ""})
    assert r.status_code == 400
    assert "Password is required." in msg(r)


# ── access links ─────────────────────────────────────────────────────────────


def test_access_link_bad_permission_and_max_uses(alice):
    doc = create_document(alice, "vd-link")
    r = alice.post(f"{BASE_URL}/api/documents/{doc['id']}/links",
                   json={"permission": "superuser", "maxUses": 0})
    assert r.status_code == 400
    m = msg(r)
    assert "Permission must be 'editor' or 'viewer'." in m
    assert "Max uses must be at least 1." in m


# ── collaborators ────────────────────────────────────────────────────────────


def test_add_collaborator_bad_email_and_role(alice):
    doc = create_document(alice, "vd-collab")
    r = alice.post(f"{BASE_URL}/api/documents/{doc['id']}/collaborators",
                   json={"email": "bad", "role": "admin"})
    assert r.status_code == 400
    m = msg(r)
    assert "Enter a valid email address." in m
    assert "Role must be 'editor' or 'viewer'." in m


# ── templates ────────────────────────────────────────────────────────────────


def test_save_as_template_missing_title(alice):
    doc = create_document(alice, "vd-tmpl")
    r = alice.post(f"{BASE_URL}/api/documents/{doc['id']}/save-as-template",
                   json={"title": "", "category": "article",
                         "isPublic": False, "fileIds": []})
    assert r.status_code == 400
    assert "Title is required." in msg(r)


def test_save_as_template_missing_category(alice):
    doc = create_document(alice, "vd-tmpl-cat")
    r = alice.post(f"{BASE_URL}/api/documents/{doc['id']}/save-as-template",
                   json={"title": "OK", "isPublic": False, "fileIds": []})
    # `Category` is Required → the DataAnnotation fires before the allowlist
    # check in the endpoint runs.
    assert r.status_code == 400
    assert "Pick a category." in msg(r)


# ── documents ────────────────────────────────────────────────────────────────


def test_update_document_empty_title(alice):
    doc = create_document(alice, "vd-doc")
    r = alice.put(f"{BASE_URL}/api/documents/{doc['id']}", json={"title": ""})
    assert r.status_code == 400
    assert "Title cannot be empty." in msg(r)
