import { test } from "node:test";
import assert from "node:assert/strict";
import {
  registerUser, createDocument, getMainFileId,
  makeProvider, waitConnected, waitUntil,
} from "./helpers.mjs";

// On-demand load/soak test: NOT named *.test.mjs so the `ws/*.test.mjs` glob
// (npm run test:ws) does not auto-run it. Run with `npm run test:load`.
//
// Stresses the WebSocket relay with ~20 concurrent clients all editing the SAME
// Y.Text. Verifies convergence under fan-out: every marker lands exactly once
// (no duplication, no loss) and all clients agree on the final string.

const N = 20;
const count = (s, marker) =>
  (s.match(new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length;

test(`${N} concurrent clients converge on the same Y.Text, all markers present once`, async () => {
  const { cookie } = await registerUser("load");
  const doc = await createDocument(cookie);
  const fileId = await getMainFileId(cookie, doc.id);

  const clients = Array.from({ length: N }, () => makeProvider(doc.id, cookie));
  const errors = [];
  for (let i = 0; i < clients.length; i++) {
    clients[i].provider.on("connection-error", (e) =>
      errors.push(`client ${i} connection-error: ${e?.message ?? e}`));
    clients[i].ydoc.on("error", (e) =>
      errors.push(`client ${i} ydoc error: ${e?.message ?? e}`));
  }

  try {
    // All clients connect (generous per-client timeout for a 20-way fan-in).
    await Promise.all(clients.map((c) => waitConnected(c.provider, 20000)));

    const texts = clients.map((c) => c.ydoc.getText(fileId));
    const markers = Array.from({ length: N }, (_, i) => `[${i}]`);

    // Every client inserts its distinct marker into the SAME Y.Text, concurrently.
    for (let i = 0; i < clients.length; i++) {
      texts[i].insert(texts[i].length, markers[i]);
    }

    // Poll until ALL clients converge to one string AND every marker is present
    // exactly once. Generous timeout — concurrency test, must not be flaky.
    await waitUntil(() => {
      const strings = texts.map((t) => t.toString());
      const first = strings[0];
      if (!strings.every((s) => s === first)) return false;
      return markers.every((m) => count(first, m) === 1);
    }, { timeout: 20000, interval: 100 });

    const final = texts[0].toString();
    for (let i = 0; i < texts.length; i++) {
      assert.equal(texts[i].toString(), final, `client ${i} did not converge`);
    }
    for (const m of markers) {
      assert.equal(count(final, m), 1, `marker ${m} not present exactly once`);
    }
    const expectedLen = markers.reduce((acc, m) => acc + m.length, 0);
    assert.equal(final.length, expectedLen, "final length should equal sum of all marker lengths");
    assert.deepEqual(errors, [], `no client should error: ${errors.join("; ")}`);
  } finally {
    for (const c of clients) c.provider.destroy();
  }
});
