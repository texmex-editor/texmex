import { test } from "node:test";
import assert from "node:assert/strict";
import {
  registerUser, createDocument, getMainFileId, addCollaborator, setRole,
  makeProvider, makeRawWs, waitConnected, waitOpen, collectRawText, buildUpdateMessage,
  waitUntil, sleep,
} from "./helpers.mjs";

// permission_denied is a TEXT frame sent back to the editing client. We use a RAW ws for the
// rejected client (sends a hand-crafted Yjs update, observes the text frame) — a yjs provider
// would crash on the text frame (y-websocket binary-decodes every frame; see helpers.mjs note).

const hasPermissionDenied = (msgs) => msgs.some((m) => m.type === "permission_denied");

test("viewer edit is dropped and the viewer receives permission_denied", async () => {
  const owner = await registerUser("owner");
  const viewer = await registerUser("viewer");
  const doc = await createDocument(owner.cookie);
  const fileId = await getMainFileId(owner.cookie, doc.id);
  await addCollaborator(owner.cookie, doc.id, viewer.email, "viewer");

  const ownerProvider = makeProvider(doc.id, owner.cookie); // observes that the edit is NOT applied
  const viewerWs = makeRawWs(doc.id, viewer.cookie);
  const viewerMsgs = collectRawText(viewerWs);
  try {
    await waitConnected(ownerProvider.provider);
    await waitOpen(viewerWs);

    viewerWs.send(buildUpdateMessage(fileId, "viewer wuz here"));

    await waitUntil(() => hasPermissionDenied(viewerMsgs), { timeout: 6000 });
    await sleep(400);
    assert.ok(!ownerProvider.ydoc.getText(fileId).toString().includes("viewer wuz here"),
              "owner must not receive the viewer's dropped edit");
  } finally {
    ownerProvider.provider.destroy();
    viewerWs.close();
  }
});

test("editor edit is applied", async () => {
  const owner = await registerUser("owner2");
  const editor = await registerUser("editor2");
  const doc = await createDocument(owner.cookie);
  const fileId = await getMainFileId(owner.cookie, doc.id);
  await addCollaborator(owner.cookie, doc.id, editor.email, "editor");

  const o = makeProvider(doc.id, owner.cookie);
  const e = makeProvider(doc.id, editor.cookie);
  try {
    await waitConnected(o.provider);
    await waitConnected(e.provider);
    e.ydoc.getText(fileId).insert(0, "editor content");
    await waitUntil(() => o.ydoc.getText(fileId).toString().includes("editor content"));
    assert.ok(o.ydoc.getText(fileId).toString().includes("editor content"));
  } finally {
    o.provider.destroy();
    e.provider.destroy();
  }
});

test("live downgrade editor->viewer rejects the next edit", async () => {
  const owner = await registerUser("owner3");
  const user = await registerUser("dgrade");
  const doc = await createDocument(owner.cookie);
  const fileId = await getMainFileId(owner.cookie, doc.id);
  await addCollaborator(owner.cookie, doc.id, user.email, "editor");

  const ownerProvider = makeProvider(doc.id, owner.cookie);
  const userWs = makeRawWs(doc.id, user.cookie);
  const userMsgs = collectRawText(userWs);
  try {
    await waitConnected(ownerProvider.provider);
    await waitOpen(userWs);

    // As editor, the edit lands (owner sees it), no permission_denied.
    userWs.send(buildUpdateMessage(fileId, "before downgrade "));
    await waitUntil(() => ownerProvider.ydoc.getText(fileId).toString().includes("before downgrade"));
    assert.ok(!hasPermissionDenied(userMsgs));

    // Owner downgrades the user to viewer (live propagation flips the WS read-only flag).
    await setRole(owner.cookie, doc.id, user.userId, "viewer");
    await sleep(500);

    // Next edit is now rejected.
    userWs.send(buildUpdateMessage(fileId, "AFTER downgrade"));
    await waitUntil(() => hasPermissionDenied(userMsgs), { timeout: 6000 });
    await sleep(400);
    assert.ok(!ownerProvider.ydoc.getText(fileId).toString().includes("AFTER downgrade"),
              "post-downgrade edit must be dropped");
  } finally {
    ownerProvider.provider.destroy();
    userWs.close();
  }
});
