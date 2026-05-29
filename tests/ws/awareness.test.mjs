import { test } from "node:test";
import assert from "node:assert/strict";
import {
  registerUser, createDocument,
  makeProvider, waitConnected, waitUntil,
} from "./helpers.mjs";

test("client A's awareness state propagates to client B", async () => {
  const { cookie } = await registerUser("aware");
  const doc = await createDocument(cookie);

  const a = makeProvider(doc.id, cookie);
  const b = makeProvider(doc.id, cookie);
  try {
    await waitConnected(a.provider);
    await waitConnected(b.provider);

    a.provider.awareness.setLocalStateField("user", { name: "Alice", color: "#f00" });

    // B sees A's awareness entry (keyed by A's clientID).
    await waitUntil(() => {
      for (const [, state] of b.provider.awareness.getStates()) {
        if (state?.user?.name === "Alice") return true;
      }
      return false;
    });
    const names = [...b.provider.awareness.getStates().values()].map((s) => s?.user?.name);
    assert.ok(names.includes("Alice"));
  } finally {
    a.provider.destroy();
    b.provider.destroy();
  }
});

// Note: awareness *removal* on disconnect is a y-protocols client concern (a clean removal
// broadcast that races the socket close, or the ~30s awareness timeout) — not a property of
// our relay, which simply forwards awareness frames. So we only assert propagation here.
