// Shared helpers for the Layer 3 WebSocket protocol suite (node:test).
//
// Prerequisites: a running server (BASE_URL, default http://localhost:3000) + Postgres.
// No compiler needed — these are WS-only. Tests self-provision via unique-email registration,
// so no DB reset is required.
//
// Run:  cd tests && node --test ws/      (or npm run test:ws)
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import WebSocket from "ws";
import * as encoding from "lib0/encoding";
import { setTimeout as sleep } from "timers/promises";

export { sleep };

export const BASE_URL = process.env.TEXMEX_BASE_URL || "http://localhost:3000";
export const WS_URL = process.env.TEXMEX_WS_URL || "ws://localhost:3000/ws";
const PASSWORD = "Pass1234!";

let counter = 0;
function uniq(label) {
  counter += 1;
  return `${label}-${Date.now().toString(36)}-${counter}`;
}

// ── HTTP provisioning (global fetch) ──────────────────────────────────────

function sessionCookie(res) {
  // Node 18.14+/undici: getSetCookie() returns the array of Set-Cookie values.
  const all = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const c of all) {
    if (c.startsWith("texmex_session=")) return c.split(";", 1)[0];
  }
  return null;
}

export async function registerUser(label = "user") {
  const email = `${uniq(label)}@test.com`;
  const res = await fetch(`${BASE_URL}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, displayName: "WsTestUser", password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`register failed: ${res.status} ${await res.text()}`);
  const cookie = sessionCookie(res);
  const body = await res.json();
  return { cookie, userId: body.id, email };
}

async function api(cookie, method, path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return res;
}

export async function createDocument(cookie, title = "WS Test Doc") {
  const res = await api(cookie, "POST", "/api/documents", { title });
  if (!res.ok) throw new Error(`createDocument failed: ${res.status}`);
  return res.json();
}

export async function getMainFileId(cookie, docId) {
  const res = await api(cookie, "GET", `/api/documents/${docId}/files`);
  const files = await res.json();
  return files.find((f) => f.filename === "main.tex").id;
}

export async function listFiles(cookie, docId) {
  const res = await api(cookie, "GET", `/api/documents/${docId}/files`);
  return res.json();
}

export async function addCollaborator(ownerCookie, docId, email, role = "editor") {
  return api(ownerCookie, "POST", `/api/documents/${docId}/collaborators`, { email, role });
}

export async function setRole(ownerCookie, docId, userId, role) {
  return api(ownerCookie, "PUT", `/api/documents/${docId}/collaborators/${userId}`, { role });
}

export async function removeCollaborator(ownerCookie, docId, userId) {
  return api(ownerCookie, "DELETE", `/api/documents/${docId}/collaborators/${userId}`);
}

export async function createVersion(cookie, docId, label = "v") {
  const res = await api(cookie, "POST", `/api/documents/${docId}/versions`, { label });
  return res.json();
}

export async function restoreVersion(cookie, docId, versionId) {
  return api(cookie, "POST", `/api/documents/${docId}/versions/${versionId}/restore`);
}

export async function uploadFile(cookie, docId, filename, content, contentType = "text/plain") {
  const form = new FormData();
  form.append("filename", filename);
  form.append("file", new Blob([content], { type: contentType }), filename);
  return fetch(`${BASE_URL}/api/documents/${docId}/files`, {
    method: "POST", headers: { Cookie: cookie }, body: form,
  });
}

export async function renameFile(cookie, docId, fileId, newFilename) {
  return api(cookie, "PATCH", `/api/documents/${docId}/files/${fileId}`, { newFilename });
}

export async function deleteFile(cookie, docId, fileId) {
  return api(cookie, "DELETE", `/api/documents/${docId}/files/${fileId}`);
}

export async function replaceFile(cookie, docId, oldFileId, filename, content, contentType = "text/plain") {
  const form = new FormData();
  form.append("filename", filename);
  form.append("file", new Blob([content], { type: contentType }), filename);
  return fetch(`${BASE_URL}/api/documents/${docId}/files/${oldFileId}/replace`, {
    method: "POST", headers: { Cookie: cookie }, body: form,
  });
}

export async function createAnonymousLink(ownerCookie, docId, permission = "editor") {
  const res = await api(ownerCookie, "POST", `/api/documents/${docId}/anonymous-links`, { permission });
  return res.json();
}

export async function deleteAnonymousLink(ownerCookie, docId, linkId) {
  return api(ownerCookie, "DELETE", `/api/documents/${docId}/anonymous-links/${linkId}`);
}

export async function joinAnonymous(token) {
  // Returns { res, grantCookie } — anonymous grant cookie for connecting an anon WS.
  const res = await fetch(`${BASE_URL}/api/join/anonymous/${token}`, { method: "POST" });
  let grantCookie = null;
  const all = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const c of all) if (c.startsWith("texmex_anonymous_grant=")) grantCookie = c.split(";", 1)[0];
  return { res, grantCookie };
}

// ── WS clients ────────────────────────────────────────────────────────────

/** Provider-based client (Yjs sync + awareness). Cookie via header polyfill. */
export function makeProvider(docId, cookie) {
  const ydoc = new Y.Doc();
  const provider = new WebsocketProvider(WS_URL, docId, ydoc, {
    WebSocketPolyfill: class extends WebSocket {
      constructor(url, protocols) {
        super(url, protocols, { headers: { Cookie: cookie } });
      }
    },
  });
  return { ydoc, provider };
}

/** Raw ws client (no auto-reconnect). Used both for clean close-code assertions AND for
 *  observing server TEXT control frames (file_event / permission_denied) — a yjs provider
 *  can't be used for that because y-websocket's onmessage tries to binary-decode every frame
 *  (incl. text) and throws (see y-websocket.js:185). A raw ws lets us read text frames directly. */
export function makeRawWs(docId, cookie) {
  return new WebSocket(`${WS_URL}/${docId}`, { headers: { Cookie: cookie } });
}

export function waitOpen(ws, timeout = 5000) {
  return new Promise((resolve, reject) => {
    if (ws.readyState === ws.OPEN) return resolve();
    const t = setTimeout(() => reject(new Error("ws open timed out")), timeout);
    ws.on("open", () => { clearTimeout(t); resolve(); });
    ws.on("error", (e) => { clearTimeout(t); reject(e); });
  });
}

export function waitClose(ws, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("ws close timed out")), timeout);
    ws.on("close", (code, reasonBuf) => {
      clearTimeout(t);
      resolve({ code, reason: reasonBuf ? reasonBuf.toString() : "" });
    });
    ws.on("error", () => { /* a close frame usually follows */ });
  });
}

// Server's CONTROL_MESSAGE_TYPE constant in YjsRelayMiddleware.cs. y-protocols
// reserves 0=sync, 1=awareness; 2+ is free. Control messages (permission_denied,
// file_event) ship as binary frames with [3, ...utf8 JSON]. y-websocket silently
// drops the unknown type 3 so it doesn't interfere with sync/awareness.
const CONTROL_MESSAGE_TYPE = 3;

/** Collects parsed JSON control frames from a raw ws into an array.
 *  Handles the binary-framed format the server uses.
 *  (Function name kept for backwards compat — was 'collectRawText' when frames
 *  were text-typed; same intent.) */
export function collectRawText(ws) {
  const messages = [];
  ws.on("message", (data, isBinary) => {
    // Sync (0) and awareness (1) frames are also binary — only type 3 is ours.
    if (!isBinary) return;
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    if (buf.length < 2 || buf[0] !== CONTROL_MESSAGE_TYPE) return;
    try {
      const msg = JSON.parse(buf.subarray(1).toString("utf8"));
      if (msg && typeof msg === "object") messages.push(msg);
    } catch { /* not JSON */ }
  });
  return messages;
}

/** Builds a y-websocket sync-update wire message ([messageSync=0][messageYjsUpdate=2][len][update])
 *  carrying an edit that inserts `text` into Y.Text(fileId). Send on a raw ws to simulate a client
 *  edit (used to trigger the read-only permission gate). */
export function buildUpdateMessage(fileId, text) {
  const d = new Y.Doc();
  d.getText(fileId).insert(0, text);
  const update = Y.encodeStateAsUpdate(d);
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, 0); // messageSync
  encoding.writeVarUint(enc, 2); // messageYjsUpdate
  encoding.writeVarUint8Array(enc, update);
  return encoding.toUint8Array(enc);
}

// ── Async utilities ────────────────────────────────────────────────────────

export async function waitUntil(predicate, { timeout = 5000, interval = 50 } = {}) {
  const start = Date.now();
  for (;;) {
    let result;
    try { result = await predicate(); } catch { result = false; }
    if (result) return result;
    if (Date.now() - start > timeout) throw new Error("waitUntil timed out");
    await sleep(interval);
  }
}

/** Resolves when the provider reports connected (status === "connected"). */
export function waitConnected(provider, timeout = 5000) {
  return new Promise((resolve, reject) => {
    if (provider.wsconnected) return resolve();
    const t = setTimeout(() => reject(new Error("connect timed out")), timeout);
    provider.on("status", ({ status }) => {
      if (status === "connected") { clearTimeout(t); resolve(); }
    });
  });
}
