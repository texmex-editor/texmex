import { test } from "node:test";
import assert from "node:assert/strict";
import {
  registerUser, createDocument, getMainFileId,
  makeProvider, waitConnected, waitUntil, sleep,
} from "./helpers.mjs";

// Ported from the original yjs_smoke_test.mjs.

test("edits persist across full disconnect and cold reconnect", async () => {
  const { cookie } = await registerUser("persist");
  const doc = await createDocument(cookie);
  const fileId = await getMainFileId(cookie, doc.id);

  const a = makeProvider(doc.id, cookie);
  const b = makeProvider(doc.id, cookie);
  await waitConnected(a.provider);
  await waitConnected(b.provider);

  a.ydoc.getText(fileId).insert(0, "Hello from A. ");
  await sleep(200);
  b.ydoc.getText(fileId).insert(b.ydoc.getText(fileId).length, "Hello from B.");
  await waitUntil(() => a.ydoc.getText(fileId).toString() === b.ydoc.getText(fileId).toString());
  const merged = a.ydoc.getText(fileId).toString();

  // Both disconnect → server persists on the last release.
  a.provider.destroy();
  b.provider.destroy();
  await sleep(1500);

  // Cold reconnect: a brand-new client with no local state must receive the persisted content
  // via the server's sync-step-2-on-connect.
  const c = makeProvider(doc.id, cookie);
  try {
    await waitConnected(c.provider);
    await waitUntil(() => c.ydoc.getText(fileId).toString() === merged, { timeout: 6000 });
    assert.equal(c.ydoc.getText(fileId).toString(), merged);
  } finally {
    c.provider.destroy();
  }
});
