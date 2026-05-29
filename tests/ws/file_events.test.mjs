import { test } from "node:test";
import assert from "node:assert/strict";
import {
  registerUser, createDocument, listFiles,
  uploadFile, renameFile, deleteFile, replaceFile,
  makeRawWs, waitOpen, collectRawText, waitUntil,
} from "./helpers.mjs";

// file_event broadcasts are TEXT frames. We observe them on a RAW ws (a room member) rather than
// a yjs provider — y-websocket's onmessage binary-decodes every frame and throws on text (see the
// finding in helpers.mjs / the Layer 3 notes).

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)]);
const fileEvents = (msgs) => msgs.filter((m) => m.type === "file_event");

test("connected client receives 'created' file_event on upload (with category)", async () => {
  const { cookie } = await registerUser("fe-create");
  const doc = await createDocument(cookie);
  const ws = makeRawWs(doc.id, cookie);
  const msgs = collectRawText(ws);
  try {
    await waitOpen(ws);
    await uploadFile(cookie, doc.id, "refs.bib", "@book{x}");
    await waitUntil(() => fileEvents(msgs).some((m) => m.action === "created" && m.filename === "refs.bib"));
    const ev = fileEvents(msgs).find((m) => m.action === "created" && m.filename === "refs.bib");
    assert.equal(ev.category, "collaborative");
  } finally {
    ws.close();
  }
});

test("connected client receives 'renamed' file_event", async () => {
  const { cookie } = await registerUser("fe-rename");
  const doc = await createDocument(cookie);
  await uploadFile(cookie, doc.id, "old.bib", "@a{x}");
  const fileId = (await listFiles(cookie, doc.id)).find((f) => f.filename === "old.bib").id;

  const ws = makeRawWs(doc.id, cookie);
  const msgs = collectRawText(ws);
  try {
    await waitOpen(ws);
    await renameFile(cookie, doc.id, fileId, "new.bib");
    await waitUntil(() => fileEvents(msgs).some((m) => m.action === "renamed" && m.filename === "new.bib"));
    assert.ok(fileEvents(msgs).some((m) => m.action === "renamed"));
  } finally {
    ws.close();
  }
});

test("connected client receives 'deleted' file_event", async () => {
  const { cookie } = await registerUser("fe-delete");
  const doc = await createDocument(cookie);
  await uploadFile(cookie, doc.id, "temp.bib", "@a{x}");
  const fileId = (await listFiles(cookie, doc.id)).find((f) => f.filename === "temp.bib").id;

  const ws = makeRawWs(doc.id, cookie);
  const msgs = collectRawText(ws);
  try {
    await waitOpen(ws);
    await deleteFile(cookie, doc.id, fileId);
    await waitUntil(() => fileEvents(msgs).some((m) => m.action === "deleted" && m.fileId === fileId));
    assert.ok(fileEvents(msgs).some((m) => m.action === "deleted"));
  } finally {
    ws.close();
  }
});

test("connected client receives 'replaced_cross_type' file_event", async () => {
  const { cookie } = await registerUser("fe-replace");
  const doc = await createDocument(cookie);
  await uploadFile(cookie, doc.id, "refs.bib", "@a{x}");
  const fileId = (await listFiles(cookie, doc.id)).find((f) => f.filename === "refs.bib").id;

  const ws = makeRawWs(doc.id, cookie);
  const msgs = collectRawText(ws);
  try {
    await waitOpen(ws);
    await replaceFile(cookie, doc.id, fileId, "preview.png", PNG, "image/png");
    await waitUntil(() => fileEvents(msgs).some((m) => m.action === "replaced_cross_type"));
    const ev = fileEvents(msgs).find((m) => m.action === "replaced_cross_type");
    assert.equal(ev.category, "image");
    assert.equal(ev.oldCategory, "collaborative");
  } finally {
    ws.close();
  }
});
