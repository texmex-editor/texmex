import { test } from "node:test";
import assert from "node:assert/strict";
import {
  registerUser, createDocument, getMainFileId,
  makeProvider, waitConnected, waitUntil, sleep,
} from "./helpers.mjs";

test("two clients converge on concurrent edits to the same Y.Text", async () => {
  const { cookie } = await registerUser("conv");
  const doc = await createDocument(cookie);
  const fileId = await getMainFileId(cookie, doc.id);

  const a = makeProvider(doc.id, cookie);
  const b = makeProvider(doc.id, cookie);
  try {
    await waitConnected(a.provider);
    await waitConnected(b.provider);
    const textA = a.ydoc.getText(fileId);
    const textB = b.ydoc.getText(fileId);

    textA.insert(0, "Hello from A. ");
    await sleep(200);
    textB.insert(textB.length, "Hello from B.");

    await waitUntil(() => textA.toString() === textB.toString()
                          && textA.toString().includes("A")
                          && textA.toString().includes("B"));
    assert.equal(textA.toString(), textB.toString());
    assert.ok(textA.toString().includes("Hello from A"));
    assert.ok(textA.toString().includes("Hello from B"));
  } finally {
    a.provider.destroy();
    b.provider.destroy();
  }
});

test("three clients converge", async () => {
  const { cookie } = await registerUser("conv3");
  const doc = await createDocument(cookie);
  const fileId = await getMainFileId(cookie, doc.id);

  const clients = [makeProvider(doc.id, cookie), makeProvider(doc.id, cookie), makeProvider(doc.id, cookie)];
  try {
    for (const c of clients) await waitConnected(c.provider);
    const texts = clients.map((c) => c.ydoc.getText(fileId));

    texts[0].insert(0, "A");
    await sleep(150);
    texts[1].insert(texts[1].length, "B");
    await sleep(150);
    texts[2].insert(texts[2].length, "C");

    await waitUntil(() => {
      const s = texts.map((t) => t.toString());
      return s.every((x) => x === s[0]) && s[0].includes("A") && s[0].includes("B") && s[0].includes("C");
    });
    const final = texts[0].toString();
    for (const t of texts) assert.equal(t.toString(), final);
  } finally {
    for (const c of clients) c.provider.destroy();
  }
});

test("late joiner receives existing content via sync step 2", async () => {
  const { cookie } = await registerUser("late");
  const doc = await createDocument(cookie);
  const fileId = await getMainFileId(cookie, doc.id);

  const a = makeProvider(doc.id, cookie);
  let b;
  try {
    await waitConnected(a.provider);
    a.ydoc.getText(fileId).insert(0, "Pre-existing content");
    await sleep(300);

    // B joins after A has already written.
    b = makeProvider(doc.id, cookie);
    await waitConnected(b.provider);
    await waitUntil(() => b.ydoc.getText(fileId).toString() === "Pre-existing content");
    assert.equal(b.ydoc.getText(fileId).toString(), "Pre-existing content");
  } finally {
    a.provider.destroy();
    if (b) b.provider.destroy();
  }
});
