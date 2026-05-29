"""Auth flows: register, login, logout, /me. Tested as features (the old suite only
used register/login as setup boilerplate)."""
import uuid

import requests
from conftest import BASE_URL, PASSWORD, register_user

NEW_PW = "NewPass123!"


def test_register_returns_user_and_sets_cookie():
    s = requests.Session()
    email = f"reg-{uuid.uuid4().hex[:8]}@test.com"
    r = s.post(f"{BASE_URL}/api/auth/register",
               json={"email": email, "displayName": "RegUser", "password": PASSWORD})
    assert r.status_code in (200, 201)
    body = r.json()
    assert body["email"] == email
    assert "texmex_session" in s.cookies


def test_register_duplicate_email_returns_409():
    s = requests.Session()
    email = f"dup-{uuid.uuid4().hex[:8]}@test.com"
    first = s.post(f"{BASE_URL}/api/auth/register",
                   json={"email": email, "displayName": "DupUser", "password": PASSWORD})
    assert first.status_code in (200, 201)
    second = requests.post(f"{BASE_URL}/api/auth/register",
                           json={"email": email, "displayName": "DupUser2", "password": PASSWORD})
    assert second.status_code == 409


def test_register_weak_password_returns_400():
    r = requests.post(f"{BASE_URL}/api/auth/register",
                      json={"email": f"weak-{uuid.uuid4().hex[:8]}@test.com",
                            "displayName": "WeakUser", "password": "short"})
    assert r.status_code == 400


def test_register_invalid_email_returns_400():
    r = requests.post(f"{BASE_URL}/api/auth/register",
                      json={"email": "not-an-email", "displayName": "BadEmail", "password": PASSWORD})
    assert r.status_code == 400


def test_register_invalid_displayname_returns_400():
    # Too short (min 3) and/or illegal chars per ^[a-zA-Z0-9._ ]+$
    r = requests.post(f"{BASE_URL}/api/auth/register",
                      json={"email": f"dn-{uuid.uuid4().hex[:8]}@test.com",
                            "displayName": "a!", "password": PASSWORD})
    assert r.status_code == 400


def test_login_wrong_password_returns_401():
    email = f"login-{uuid.uuid4().hex[:8]}@test.com"
    requests.post(f"{BASE_URL}/api/auth/register",
                  json={"email": email, "displayName": "LoginUser", "password": PASSWORD})
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": email, "password": "WrongPass123!"})
    assert r.status_code == 401


def test_login_success_sets_cookie():
    email = f"login2-{uuid.uuid4().hex[:8]}@test.com"
    requests.post(f"{BASE_URL}/api/auth/register",
                  json={"email": email, "displayName": "LoginUser2", "password": PASSWORD})
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": PASSWORD})
    assert r.status_code == 200
    assert "texmex_session" in s.cookies


def test_me_unauthenticated_returns_401():
    r = requests.get(f"{BASE_URL}/api/auth/me")
    assert r.status_code == 401


def test_me_returns_current_user(alice):
    r = alice.get(f"{BASE_URL}/api/auth/me")
    assert r.status_code == 200
    assert r.json()["email"] == alice.email


def test_logout_invalidates_session(alice):
    assert alice.get(f"{BASE_URL}/api/auth/me").status_code == 200
    assert alice.post(f"{BASE_URL}/api/auth/logout").status_code == 200
    # Session cookie cleared → subsequent /me is unauthenticated.
    assert alice.get(f"{BASE_URL}/api/auth/me").status_code == 401


# ── PATCH /api/auth/me (display name) ───────────────────────────────────────

def test_update_display_name(alice):
    r = alice.patch(f"{BASE_URL}/api/auth/me", json={"displayName": "Alice Renamed"})
    assert r.status_code == 200
    assert r.json()["displayName"] == "Alice Renamed"
    assert alice.get(f"{BASE_URL}/api/auth/me").json()["displayName"] == "Alice Renamed"


def test_update_display_name_unauthenticated_401():
    r = requests.patch(f"{BASE_URL}/api/auth/me", json={"displayName": "Nobody"})
    assert r.status_code == 401


def test_update_display_name_invalid_400(alice):
    r = alice.patch(f"{BASE_URL}/api/auth/me", json={"displayName": "a!"})
    assert r.status_code == 400


def test_update_display_name_whitespace_only_400(alice):
    # Passes MinLength(3) on the raw string but trims to empty → rejected by the explicit guard.
    r = alice.patch(f"{BASE_URL}/api/auth/me", json={"displayName": "   "})
    assert r.status_code == 400


# ── POST /api/auth/change-password ──────────────────────────────────────────

def test_change_password_success_and_invalidates_other_sessions():
    user = register_user("chpw")                       # session 1 (the caller)
    s2 = requests.Session()                             # session 2, same account
    assert s2.post(f"{BASE_URL}/api/auth/login",
                   json={"email": user.email, "password": PASSWORD}).status_code == 200
    assert s2.get(f"{BASE_URL}/api/auth/me").status_code == 200

    r = user.post(f"{BASE_URL}/api/auth/change-password",
                  json={"currentPassword": PASSWORD, "newPassword": NEW_PW})
    assert r.status_code == 200

    # Current session kept; the other session is invalidated.
    assert user.get(f"{BASE_URL}/api/auth/me").status_code == 200
    assert s2.get(f"{BASE_URL}/api/auth/me").status_code == 401

    # Old password rejected, new password works.
    assert requests.post(f"{BASE_URL}/api/auth/login",
                         json={"email": user.email, "password": PASSWORD}).status_code == 401
    assert requests.post(f"{BASE_URL}/api/auth/login",
                         json={"email": user.email, "password": NEW_PW}).status_code == 200


def test_change_password_wrong_current_401(alice):
    r = alice.post(f"{BASE_URL}/api/auth/change-password",
                   json={"currentPassword": "WrongCurrent123!", "newPassword": NEW_PW})
    assert r.status_code == 401


def test_change_password_weak_new_400(alice):
    r = alice.post(f"{BASE_URL}/api/auth/change-password",
                   json={"currentPassword": PASSWORD, "newPassword": "short"})
    assert r.status_code == 400


def test_change_password_unauthenticated_401():
    r = requests.post(f"{BASE_URL}/api/auth/change-password",
                      json={"currentPassword": PASSWORD, "newPassword": NEW_PW})
    assert r.status_code == 401


# ── POST /api/auth/change-email ─────────────────────────────────────────────

def test_change_email_success():
    user = register_user("chem")
    new_email = f"chem-new-{uuid.uuid4().hex[:8]}@test.com"
    r = user.post(f"{BASE_URL}/api/auth/change-email",
                  json={"newEmail": new_email, "currentPassword": PASSWORD})
    assert r.status_code == 200
    assert r.json()["email"] == new_email
    assert user.get(f"{BASE_URL}/api/auth/me").json()["email"] == new_email
    # New email logs in; the old email no longer exists.
    assert requests.post(f"{BASE_URL}/api/auth/login",
                         json={"email": new_email, "password": PASSWORD}).status_code == 200
    assert requests.post(f"{BASE_URL}/api/auth/login",
                         json={"email": user.email, "password": PASSWORD}).status_code == 401


def test_change_email_wrong_current_401(alice):
    r = alice.post(f"{BASE_URL}/api/auth/change-email",
                   json={"newEmail": f"x-{uuid.uuid4().hex[:8]}@test.com",
                         "currentPassword": "WrongCurrent123!"})
    assert r.status_code == 401


def test_change_email_duplicate_409():
    a = register_user("chemdupa")
    b = register_user("chemdupb")
    r = a.post(f"{BASE_URL}/api/auth/change-email",
               json={"newEmail": b.email, "currentPassword": PASSWORD})
    assert r.status_code == 409


def test_change_email_unauthenticated_401():
    r = requests.post(f"{BASE_URL}/api/auth/change-email",
                      json={"newEmail": f"x-{uuid.uuid4().hex[:8]}@test.com", "currentPassword": PASSWORD})
    assert r.status_code == 401
