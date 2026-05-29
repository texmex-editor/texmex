import { test } from "node:test";
import assert from "node:assert/strict";
import {
  registerUser, createDocument, getMainFileId,
  uploadFile, listFiles, createVersion, restoreVersion,
  makeProvider, waitConnected, waitUntil, sleep,
} from "./helpers.mjs";

// Stress the forward-delta restore over MANY versions and repeated forward/back cycles, plus
// file-set reconciliation across versions. Answers "does restore work no matter how many versions
// go forward or back?". Each checkpoint is read by a fresh cold client (loads straight from the DB),
// so these also prove the persisted Yjs state stays intact and decodable after every restore.

// Read the exact text of one file via a throwaway cold client (proves DB state is intact).
async function coldRead(docId, cookie, fileId) {
  const c = makeProvider(docId, cookie);
  try {
    await waitConnected(c.provider);
    const t = c.ydoc.getText(fileId);
    await waitUntil(() => t.toString().length >= 0, { timeout: 5000 });
    await sleep(250); // let sync-step-2 settle
    return t.toString();
  } finally {
    c.provider.destroy();
  }
}

test("repeated restores forward and back converge to each version's exact content", async () => {
  const { cookie } = await registerUser("cyc-seq");
  const doc = await createDocument(cookie);
  const fileId = await getMainFileId(cookie, doc.id);

  const e = makeProvider(doc.id, cookie);
  await waitConnected(e.provider);
  const t = e.ydoc.getText(fileId);

  t.insert(0, "vA");
  await sleep(300);
  const vA = await createVersion(cookie, doc.id, "A"); // "vA"
  t.insert(t.length, "|vB");
  await sleep(300);
  const vB = await createVersion(cookie, doc.id, "B"); // "vA|vB"
  t.insert(t.length, "|vC");
  await sleep(300);
  const vC = await createVersion(cookie, doc.id, "C"); // "vA|vB|vC"

  e.provider.destroy();
  await sleep(1200);

  // Jump around: back, forward, middle, back again, forward again.
  const plan = [
    [vA, "vA"],
    [vC, "vA|vB|vC"],
    [vB, "vA|vB"],
    [vA, "vA"],
    [vC, "vA|vB|vC"],
  ];
  for (const [version, expected] of plan) {
    await restoreVersion(cookie, doc.id, version.id);
    await sleep(700); // restore + last-disconnect persist of the transient room
    const got = await coldRead(doc.id, cookie, fileId);
    assert.equal(got, expected, `after restoring "${expected}" the cold client must read exactly that`);
  }
});

test("restore then edit then restore: interleaved cycles stay correct", async () => {
  const { cookie } = await registerUser("cyc-edit");
  const doc = await createDocument(cookie);
  const fileId = await getMainFileId(cookie, doc.id);

  const e = makeProvider(doc.id, cookie);
  await waitConnected(e.provider);
  const t = e.ydoc.getText(fileId);
  t.insert(0, "X1");
  await sleep(300);
  const v1 = await createVersion(cookie, doc.id, "v1"); // "X1"
  e.provider.destroy();
  await sleep(1000);

  // Restore v1, then a NEW editing session appends and snapshots v2.
  await restoreVersion(cookie, doc.id, v1.id);
  await sleep(600);
  assert.equal(await coldRead(doc.id, cookie, fileId), "X1");

  const e2 = makeProvider(doc.id, cookie);
  await waitConnected(e2.provider);
  const t2 = e2.ydoc.getText(fileId);
  await waitUntil(() => t2.toString() === "X1", { timeout: 6000 });
  t2.insert(t2.length, "|X2");
  await sleep(300);
  const v2 = await createVersion(cookie, doc.id, "v2"); // "X1|X2"
  e2.provider.destroy();
  await sleep(1000);

  await restoreVersion(cookie, doc.id, v1.id);
  await sleep(600);
  assert.equal(await coldRead(doc.id, cookie, fileId), "X1", "edit discarded by restoring v1");

  await restoreVersion(cookie, doc.id, v2.id);
  await sleep(600);
  assert.equal(await coldRead(doc.id, cookie, fileId), "X1|X2", "restoring v2 brings the edit back");
});

test("restore reconciles file SETS across versions (add/remove files both directions)", async () => {
  const { cookie } = await registerUser("cyc-files");
  const doc = await createDocument(cookie);
  const mainId = await getMainFileId(cookie, doc.id);

  const e = makeProvider(doc.id, cookie);
  await waitConnected(e.provider);
  const tMain = e.ydoc.getText(mainId);
  tMain.insert(0, "M1");
  await sleep(300);
  const v1 = await createVersion(cookie, doc.id, "v1"); // 1 file: main="M1"
  e.provider.destroy(); // disconnect BEFORE the upload — see note below
  await sleep(800);

  // Add a second collaborative file while NO provider client is connected. (Uploading while a
  // y-websocket client is connected would send it a `file_event` TEXT frame, which y-websocket's
  // binary decoder rejects with "Unexpected end of array" — the known text-frame issue, backend_todo
  // #1; it is unrelated to restore. Restore itself never broadcasts file_events.)
  await uploadFile(cookie, doc.id, "extra.tex", "");
  const files = await listFiles(cookie, doc.id);
  const extraId = files.find(f => f.filename === "extra.tex").id;

  // Reconnect to edit both files, then snapshot v2.
  const e2 = makeProvider(doc.id, cookie);
  await waitConnected(e2.provider);
  const tMain2 = e2.ydoc.getText(mainId);
  const tExtra2 = e2.ydoc.getText(extraId);
  await waitUntil(() => tMain2.toString() === "M1", { timeout: 6000 });
  tExtra2.insert(0, "E2");
  tMain2.insert(tMain2.length, "|M2");
  await sleep(300);
  const v2 = await createVersion(cookie, doc.id, "v2"); // 2 files: main="M1|M2", extra="E2"
  e2.provider.destroy();
  await sleep(1200);

  // Restore v1: extra.tex must disappear (soft-deleted) and main reverts.
  await restoreVersion(cookie, doc.id, v1.id);
  await sleep(700);
  let names = (await listFiles(cookie, doc.id)).map(f => f.filename);
  assert.ok(!names.includes("extra.tex"), "extra.tex soft-deleted by restoring v1");
  assert.equal(await coldRead(doc.id, cookie, mainId), "M1");

  // Restore v2: extra.tex reappears with its v2 content; main reverts forward.
  await restoreVersion(cookie, doc.id, v2.id);
  await sleep(700);
  names = (await listFiles(cookie, doc.id)).map(f => f.filename);
  assert.ok(names.includes("extra.tex"), "extra.tex restored by restoring v2");
  assert.equal(await coldRead(doc.id, cookie, mainId), "M1|M2");
  assert.equal(await coldRead(doc.id, cookie, extraId), "E2", "extra.tex content restored");
});
