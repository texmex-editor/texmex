import { test } from "node:test";
import assert from "node:assert/strict";
import {
  registerUser, createDocument, uploadFile, addCollaborator,
  removeCollaborator, createVersion, restoreVersion,
  createAnonymousLink, deleteAnonymousLink, joinAnonymous,
  makeRawWs, waitOpen, waitClose,
} from "./helpers.mjs";

test("version restore evicts connected clients (close 1000 'version_restored')", async () => {
  const { cookie } = await registerUser("evict-restore");
  const doc = await createDocument(cookie);
  await uploadFile(cookie, doc.id, "main.tex",
    "\\documentclass{article}\\begin{document}V\\end{document}");
  const version = await createVersion(cookie, doc.id, "v1");

  const ws = makeRawWs(doc.id, cookie);
  await waitOpen(ws);
  const closed = waitClose(ws);

  await restoreVersion(cookie, doc.id, version.id);

  const { code, reason } = await closed;
  assert.equal(code, 1000);
  assert.equal(reason, "version_restored");
});

test("removing a collaborator force-closes their socket (1008 'Access revoked')", async () => {
  const owner = await registerUser("evict-owner");
  const collab = await registerUser("evict-collab");
  const doc = await createDocument(owner.cookie);
  await addCollaborator(owner.cookie, doc.id, collab.email, "editor");

  const ws = makeRawWs(doc.id, collab.cookie);
  await waitOpen(ws);
  const closed = waitClose(ws);

  await removeCollaborator(owner.cookie, doc.id, collab.userId);

  const { code } = await closed;
  assert.equal(code, 1008);
});

test("revoking an anonymous link disconnects its grant holders (1008)", async () => {
  const owner = await registerUser("evict-anon-owner");
  const doc = await createDocument(owner.cookie);
  const link = await createAnonymousLink(owner.cookie, doc.id, "editor");
  const { grantCookie } = await joinAnonymous(link.token);
  assert.ok(grantCookie, "anonymous join should set a grant cookie");

  const ws = makeRawWs(doc.id, grantCookie);
  await waitOpen(ws);
  const closed = waitClose(ws);

  await deleteAnonymousLink(owner.cookie, doc.id, link.id);

  const { code } = await closed;
  assert.equal(code, 1008);
});
