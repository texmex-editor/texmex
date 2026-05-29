import { test } from "node:test";
import assert from "node:assert/strict";
import {
  registerUser, createDocument, getMainFileId, uploadFile, listFiles,
  makeProvider, waitConnected, waitUntil, sleep,
} from "./helpers.mjs";

test("two clients editing different files converge per-file with no cross-contamination", async () => {
  const { cookie } = await registerUser("multi");
  const doc = await createDocument(cookie);
  const mainId = await getMainFileId(cookie, doc.id);
  // Add a second collaborative file.
  (await uploadFile(cookie, doc.id, "refs.bib", "")).status; // empty collab file
  const files = await listFiles(cookie, doc.id);
  const bibId = files.find((f) => f.filename === "refs.bib").id;

  const a = makeProvider(doc.id, cookie);
  const b = makeProvider(doc.id, cookie);
  try {
    await waitConnected(a.provider);
    await waitConnected(b.provider);

    // A edits main.tex, B edits refs.bib — concurrently.
    a.ydoc.getText(mainId).insert(0, "\\documentclass{article}");
    b.ydoc.getText(bibId).insert(0, "@book{key, title={T}}");

    // Both files converge on both clients.
    await waitUntil(() =>
      a.ydoc.getText(mainId).toString() === b.ydoc.getText(mainId).toString() &&
      a.ydoc.getText(bibId).toString() === b.ydoc.getText(bibId).toString() &&
      a.ydoc.getText(mainId).toString().includes("documentclass") &&
      a.ydoc.getText(bibId).toString().includes("@book"));

    // No cross-contamination: main.tex content is not in refs.bib and vice versa.
    assert.ok(!a.ydoc.getText(mainId).toString().includes("@book"));
    assert.ok(!a.ydoc.getText(bibId).toString().includes("documentclass"));
  } finally {
    a.provider.destroy();
    b.provider.destroy();
  }
});
