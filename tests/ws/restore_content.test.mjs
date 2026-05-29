import { test } from "node:test";
import assert from "node:assert/strict";
import {
  registerUser, createDocument, getMainFileId,
  createVersion, restoreVersion,
  makeProvider, waitConnected, waitUntil, sleep,
} from "./helpers.mjs";

// Version restore must coexist with the connect-time sync-step-1 handshake. The server now PULLS
// client state on connect (so reconnecting clients' offline edits are persisted). The flip side:
// restore can only "discard" edits if clients drop the Y.Doc that still holds them — CRDTs can't
// un-merge committed ops server-side. Hence the frontend contract (MULTI_FILE_COLLAB.md): on close
// reason "version_restored" the client MUST destroy its Y.Doc/provider before reconnecting, or its
// retained doc re-pushes the discarded edits via sync-step-2 and undoes the restore.
//
// This test models the correct teardown (evicted client destroyed) and asserts a FRESH client sees
// only the restored snapshot, never the post-snapshot edit — a regression guard that the offline
// pull fix didn't reopen the discarded edits on a clean restore.
test("version restore: a fresh client sees restored state, not discarded edits", async () => {
  const { cookie } = await registerUser("restore-content");
  const doc = await createDocument(cookie);
  const fileId = await getMainFileId(cookie, doc.id);

  const a = makeProvider(doc.id, cookie);
  await waitConnected(a.provider);
  const tA = a.ydoc.getText(fileId);
  tA.insert(0, "RESTORE-BASE");
  await sleep(400); // let the edit reach the server doc

  const version = await createVersion(cookie, doc.id, "snap"); // snapshots "RESTORE-BASE"

  tA.insert(tA.length, "-EXTRA"); // post-snapshot edit, to be discarded by the restore
  await sleep(400);

  await restoreVersion(cookie, doc.id, version.id); // evicts A; server doc -> "RESTORE-BASE"
  a.provider.destroy(); // model the mandated frontend teardown: drop the doc, no re-push
  await sleep(1500); // last-disconnect persist settles

  const c = makeProvider(doc.id, cookie);
  try {
    await waitConnected(c.provider);
    const tC = c.ydoc.getText(fileId);
    await waitUntil(() => tC.toString().includes("RESTORE-BASE"), { timeout: 8000 });
    assert.ok(tC.toString().includes("RESTORE-BASE"), "restored content must be present");
    assert.ok(!tC.toString().includes("-EXTRA"), "discarded post-snapshot edit must not reappear");
  } finally {
    c.provider.destroy();
  }
});
