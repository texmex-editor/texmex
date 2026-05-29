import { test } from "node:test";
import assert from "node:assert/strict";
import {
  registerUser, createDocument, getMainFileId, addCollaborator,
  uploadFile, listFiles, createVersion, restoreVersion,
  makeProvider, waitConnected, waitUntil, sleep,
} from "./helpers.mjs";

// Forward-delta version restore: the server applies the old content as a NEW forward edit instead
// of rewinding the doc. These tests prove the property that motivated the change — restore is
// correct even for a collaborator who was OFFLINE during it (they never saw the eviction, so no
// frontend mitigation could fire) — plus the read-only-client interaction with the new viewer gate.

test("restore with an offline collaborator: discarded content gone, offline edit survives, restore sticks", async () => {
  const { cookie } = await registerUser("fd-straggler");
  const doc = await createDocument(cookie);
  const fileId = await getMainFileId(cookie, doc.id);

  const a = makeProvider(doc.id, cookie);
  await waitConnected(a.provider);
  const tA = a.ydoc.getText(fileId);

  tA.insert(0, "BASE");
  await sleep(400);
  const version = await createVersion(cookie, doc.id, "snap"); // snapshot == "BASE"

  tA.insert(tA.length, "-ONLINE-EXTRA"); // synced; the restore must discard this
  await sleep(400);

  a.provider.disconnect();                // A goes offline — no version_restored close reaches it
  await sleep(200);
  tA.insert(tA.length, "-STRAGGLER");     // offline edit, concurrent with the restore

  await restoreVersion(cookie, doc.id, version.id); // forward-delta -> content back to "BASE"
  await sleep(500);

  a.provider.connect();                   // A reconnects carrying its stale doc
  await waitConnected(a.provider);
  await waitUntil(() => {
    const s = tA.toString();
    return s.includes("BASE") && s.includes("STRAGGLER") && !s.includes("ONLINE-EXTRA");
  }, { timeout: 8000 });

  const s = tA.toString();
  assert.ok(s.includes("BASE"), "restored content present");
  assert.ok(s.includes("STRAGGLER"), "offline straggler's concurrent edit survives");
  assert.ok(!s.includes("ONLINE-EXTRA"), "discarded content does NOT reappear (restore stuck)");

  a.provider.destroy();
  await sleep(1500); // persist on last disconnect

  // A fresh client sees the same converged, persisted state.
  const c = makeProvider(doc.id, cookie);
  try {
    await waitConnected(c.provider);
    const tC = c.ydoc.getText(fileId);
    await waitUntil(() =>
      tC.toString().includes("BASE") &&
      tC.toString().includes("STRAGGLER") &&
      !tC.toString().includes("ONLINE-EXTRA"), { timeout: 8000 });
    assert.ok(!tC.toString().includes("ONLINE-EXTRA"), "discarded content not persisted");
  } finally {
    c.provider.destroy();
  }
});

test("restore reconciles MULTIPLE collaborative files (forward-delta across branches)", async () => {
  // Exercises the multi-branch loop in BuildForwardDeltaForRestoreAsync: two collaborative files
  // both get reverted to their snapshot text, independently.
  const { cookie } = await registerUser("fd-multi");
  const doc = await createDocument(cookie);
  const mainId = await getMainFileId(cookie, doc.id);
  await uploadFile(cookie, doc.id, "second.tex", ""); // a second collaborative file
  const files = await listFiles(cookie, doc.id);
  const secondId = files.find(f => f.filename === "second.tex").id;

  const a = makeProvider(doc.id, cookie);
  await waitConnected(a.provider);
  const tMain = a.ydoc.getText(mainId);
  const tSecond = a.ydoc.getText(secondId);
  tMain.insert(0, "MAIN-V1");
  tSecond.insert(0, "SECOND-V1");
  await sleep(400);
  const version = await createVersion(cookie, doc.id, "snap"); // both branches at V1

  tMain.insert(tMain.length, "-MAINV2");
  tSecond.insert(tSecond.length, "-SECONDV2");
  await sleep(400);

  await restoreVersion(cookie, doc.id, version.id);
  await sleep(500);
  a.provider.destroy();
  await sleep(1500);

  const c = makeProvider(doc.id, cookie);
  try {
    await waitConnected(c.provider);
    const cMain = c.ydoc.getText(mainId);
    const cSecond = c.ydoc.getText(secondId);
    await waitUntil(() =>
      cMain.toString().includes("MAIN-V1") && cSecond.toString().includes("SECOND-V1") &&
      !cMain.toString().includes("MAINV2") && !cSecond.toString().includes("SECONDV2"),
      { timeout: 8000 });
    assert.ok(!cMain.toString().includes("MAINV2"), "main file's post-snapshot edit discarded");
    assert.ok(!cSecond.toString().includes("SECONDV2"), "second file's post-snapshot edit discarded");
    assert.ok(cSecond.toString().includes("SECOND-V1"), "second file restored to snapshot");
  } finally {
    c.provider.destroy();
  }
});

test("viewer connected during restore: reconnects and receives the restored (forward) state", async () => {
  // The viewer gate now also drops sync-step-2 from read-only clients. On a post-restore reconnect
  // the viewer still RECEIVES the server's state (its own reply being dropped doesn't block it) and
  // sees the restored content — verifying the gate change doesn't break read-only reconnect.
  const owner = await registerUser("fd-owner");
  const viewer = await registerUser("fd-viewer");
  const doc = await createDocument(owner.cookie);
  const fileId = await getMainFileId(owner.cookie, doc.id);
  await addCollaborator(owner.cookie, doc.id, viewer.email, "viewer");

  const o = makeProvider(doc.id, owner.cookie);
  await waitConnected(o.provider);
  const tO = o.ydoc.getText(fileId);
  tO.insert(0, "VBASE");
  await sleep(400);
  const version = await createVersion(owner.cookie, doc.id, "snap"); // "VBASE"
  tO.insert(tO.length, "VEXTRA");
  await sleep(400);

  const v = makeProvider(doc.id, viewer.cookie);
  try {
    await waitConnected(v.provider);
    const tV = v.ydoc.getText(fileId);
    await waitUntil(() => tV.toString().includes("VEXTRA"), { timeout: 8000 });

    await restoreVersion(owner.cookie, doc.id, version.id); // evicts both; forward-delta -> "VBASE"

    // Viewer auto-reconnects and must converge on the restored state.
    await waitUntil(() =>
      tV.toString().includes("VBASE") && !tV.toString().includes("VEXTRA"), { timeout: 10000 });
    assert.ok(tV.toString().includes("VBASE"), "viewer sees restored content after reconnect");
    assert.ok(!tV.toString().includes("VEXTRA"), "viewer no longer sees discarded content");
  } finally {
    o.provider.destroy();
    v.provider.destroy();
  }
});
