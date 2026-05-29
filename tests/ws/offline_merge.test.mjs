import { test } from "node:test";
import assert from "node:assert/strict";
import {
  registerUser, createDocument, getMainFileId,
  makeProvider, waitConnected, waitUntil, sleep,
} from "./helpers.mjs";

// Offline editing is the most common real-world reconnect path (laptop lid, wifi blip).
// We simulate "offline" with provider.disconnect() (severs the socket, keeps the local Y.Doc)
// and "back online" with provider.connect(). These verify Yjs's reconnect-sync behaves as
// promised through our relay — no lost edits, no duplication.

const count = (s, marker) => (s.match(new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length;

test("offline edits merge on reconnect, with concurrent online edits, no duplication", async () => {
  const { cookie } = await registerUser("offline");
  const doc = await createDocument(cookie);
  const fileId = await getMainFileId(cookie, doc.id);

  const a = makeProvider(doc.id, cookie);
  const b = makeProvider(doc.id, cookie);
  try {
    await waitConnected(a.provider);
    await waitConnected(b.provider);
    const tA = a.ydoc.getText(fileId);
    const tB = b.ydoc.getText(fileId);

    // Shared baseline both clients agree on.
    tA.insert(0, "[base]");
    await waitUntil(() => tB.toString() === "[base]");

    // A goes offline.
    a.provider.disconnect();
    await sleep(200);

    // A edits offline; B edits online — concurrently.
    tA.insert(tA.length, "[A-offline]");
    tB.insert(tB.length, "[B-online]");
    await sleep(300);
    // While A is offline, A must NOT have B's edit yet.
    assert.ok(!tA.toString().includes("[B-online]"), "offline client shouldn't receive live edits");

    // A reconnects → bidirectional merge.
    a.provider.connect();
    await waitConnected(a.provider);

    await waitUntil(() =>
      tA.toString() === tB.toString() &&
      tA.toString().includes("[A-offline]") &&
      tA.toString().includes("[B-online]"), { timeout: 8000 });

    const s = tA.toString();
    assert.equal(tA.toString(), tB.toString(), "clients must converge");
    // Duplication guard: each marker appears exactly once.
    assert.equal(count(s, "[base]"), 1);
    assert.equal(count(s, "[A-offline]"), 1);
    assert.equal(count(s, "[B-online]"), 1);
  } finally {
    a.provider.destroy();
    b.provider.destroy();
  }
});

test("two clients both editing while offline converge on reconnect, no duplication", async () => {
  // Neither client has a peer online to drive the sync while the other is offline — each must
  // push its own offline diff via the connect-time sync-step-1 handshake, and the server must
  // relay each one to the other. Exercises sequential offline reconnects, not just one offline +
  // one online peer (the first test).
  const { cookie } = await registerUser("offline-both");
  const doc = await createDocument(cookie);
  const fileId = await getMainFileId(cookie, doc.id);

  const a = makeProvider(doc.id, cookie);
  const b = makeProvider(doc.id, cookie);
  try {
    await waitConnected(a.provider);
    await waitConnected(b.provider);
    const tA = a.ydoc.getText(fileId);
    const tB = b.ydoc.getText(fileId);

    tA.insert(0, "[base]");
    await waitUntil(() => tB.toString() === "[base]");

    // Both go offline, then each edits independently.
    a.provider.disconnect();
    b.provider.disconnect();
    await sleep(200);
    tA.insert(tA.length, "[A]");
    tB.insert(tB.length, "[B]");
    await sleep(200);

    // Both come back. They reconnect at ~the same time; the server pulls each diff and relays.
    a.provider.connect();
    b.provider.connect();
    await waitConnected(a.provider);
    await waitConnected(b.provider);

    await waitUntil(() =>
      tA.toString() === tB.toString() &&
      tA.toString().includes("[A]") &&
      tA.toString().includes("[B]"), { timeout: 8000 });

    const s = tA.toString();
    assert.equal(tA.toString(), tB.toString(), "both offline editors must converge");
    assert.equal(count(s, "[base]"), 1);
    assert.equal(count(s, "[A]"), 1);
    assert.equal(count(s, "[B]"), 1);
  } finally {
    a.provider.destroy();
    b.provider.destroy();
  }
});

test("an offline edit persists to the server after reconnect", async () => {
  const { cookie } = await registerUser("offline2");
  const doc = await createDocument(cookie);
  const fileId = await getMainFileId(cookie, doc.id);

  const a = makeProvider(doc.id, cookie);
  await waitConnected(a.provider);
  const tA = a.ydoc.getText(fileId);
  tA.insert(0, "online ");
  await sleep(200);

  a.provider.disconnect();
  await sleep(200);
  tA.insert(tA.length, "offline-survives");
  await sleep(200);

  a.provider.connect();
  await waitConnected(a.provider);
  await sleep(800); // let the reconnect sync flush the offline edit to the server

  a.provider.destroy();
  await sleep(1500); // last-disconnect persist to DB

  // Cold reconnect: a fresh client must see the offline edit, loaded from the DB.
  const c = makeProvider(doc.id, cookie);
  try {
    await waitConnected(c.provider);
    await waitUntil(() => c.ydoc.getText(fileId).toString().includes("offline-survives"), { timeout: 8000 });
    assert.ok(c.ydoc.getText(fileId).toString().includes("offline-survives"));
  } finally {
    c.provider.destroy();
  }
});
