"""Shared fixtures + helpers for the TexMex HTTP integration suite (Layer 2).

Prerequisites: a running server (default http://localhost:3000), Postgres, and the
latex-compiler container (for test_compile.py). Tests self-isolate via unique emails,
so a DB reset between runs is not required.

Run:  python3 -m pytest tests/ -v
"""
import os
import uuid

import pytest
import requests

BASE_URL = os.environ.get("TEXMEX_BASE_URL", "http://localhost:3000")
PASSWORD = "Pass1234!"


# ── Fixtures ────────────────────────────────────────────────────────────

@pytest.fixture(scope="session")
def base_url():
    return BASE_URL


def register_user(label: str = "user") -> requests.Session:
    """Register a unique user and return an authenticated session.
    Stashes user_id / email / display_name on the session for convenience.
    Public so tests that need ad-hoc extra users (e.g. max-uses joiners) can call it."""
    s = requests.Session()
    email = f"{label}-{uuid.uuid4().hex[:8]}@test.com"
    r = s.post(f"{BASE_URL}/api/auth/register", json={
        "email": email,
        "displayName": f"{label.capitalize()}User",
        "password": PASSWORD,
    })
    r.raise_for_status()
    data = r.json()
    s.user_id = data["id"]
    s.email = data["email"]
    s.display_name = data["displayName"]
    return s


@pytest.fixture
def alice() -> requests.Session:
    return register_user("alice")


@pytest.fixture
def bob() -> requests.Session:
    return register_user("bob")


@pytest.fixture
def anon() -> requests.Session:
    """Bare session with no auth — for anonymous-link tests."""
    return requests.Session()


@pytest.fixture
def document(alice):
    """A blank document created by alice. Returns (session, doc_id)."""
    doc = create_document(alice)
    return alice, doc["id"]


# ── Helpers (module-level; use BASE_URL directly) ──────────────────────────

def create_document(session: requests.Session, title: str = "Test Doc", template_id: str | None = None) -> dict:
    body: dict = {"title": title}
    if template_id:
        body["templateId"] = template_id
    r = session.post(f"{BASE_URL}/api/documents", json=body)
    r.raise_for_status()
    return r.json()


def upload_file(session: requests.Session, doc_id: str, filename: str,
                content: bytes, content_type: str = "text/plain") -> requests.Response:
    """Multipart upload. Returns the raw Response so callers can assert status
    (happy-path callers can .raise_for_status() themselves)."""
    files = {"file": (filename, content, content_type)}
    data = {"filename": filename}
    return session.post(f"{BASE_URL}/api/documents/{doc_id}/files", files=files, data=data)


def replace_file(session: requests.Session, doc_id: str, old_file_id: str, filename: str,
                 content: bytes, content_type: str = "text/plain") -> requests.Response:
    files = {"file": (filename, content, content_type)}
    data = {"filename": filename}
    return session.post(f"{BASE_URL}/api/documents/{doc_id}/files/{old_file_id}/replace",
                        files=files, data=data)


def list_files(session: requests.Session, doc_id: str) -> list:
    r = session.get(f"{BASE_URL}/api/documents/{doc_id}/files")
    r.raise_for_status()
    return r.json()


def get_main_file_id(session: requests.Session, doc_id: str) -> str:
    return next(f["id"] for f in list_files(session, doc_id) if f["filename"] == "main.tex")


# ── Byte fixtures (mirror Layer 1 TestData) ────────────────────────────────

PNG_HEADER = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
PDF_HEADER = b"%PDF-1.7\n" + b"\x00" * 20
TTF_HEADER = b"\x00\x01\x00\x00" + b"\x00" * 32
VALID_UTF8 = "\\section{Intro}\nHällo, wörld!".encode("utf-8")
