// Spawn N anonymous y-websocket ghost clients with distinct awareness identities.
// Used for visual-testing the AvatarGroup in the editor — each ghost shows up
// as a separate collaborator chip.
//
// Usage: node _ghost-spawn.mjs <docId> <anonToken> <count> <activeFileId>
// Stays connected until you Ctrl-C; awareness only stays alive while the
// process runs.
//
// activeFileId MUST match the file the watching browser tab is focused on —
// the FE filters awareness states by activeFile (utils/editor.ts), so without
// this the ghosts are invisible in the AvatarGroup even though their WS is up.

import { joinAnonymous, makeProvider } from "./helpers.mjs";

const [, , docId, token, countStr, activeFileId] = process.argv;
if (!docId || !token || !countStr || !activeFileId) {
  console.error("usage: node _ghost-spawn.mjs <docId> <anonToken> <count> <activeFileId>");
  process.exit(1);
}
const count = parseInt(countStr, 10);

const COLORS = [
  "hsla(0, 70%, 50%, 1)",
  "hsla(40, 70%, 50%, 1)",
  "hsla(80, 70%, 50%, 1)",
  "hsla(120, 70%, 50%, 1)",
  "hsla(180, 70%, 50%, 1)",
  "hsla(220, 70%, 50%, 1)",
  "hsla(260, 70%, 50%, 1)",
  "hsla(300, 70%, 50%, 1)",
];

const ghosts = [];

for (let i = 0; i < count; i++) {
  const join = await joinAnonymous(token);
  if (!join.grantCookie) {
    console.error(`ghost ${i}: join failed (status ${join.res.status})`);
    continue;
  }
  const { ydoc, provider } = makeProvider(docId, join.grantCookie);
  // Awareness shape must match the FE's expectation (utils/editor.ts):
  // { user: { name, color, colorLight } }
  provider.awareness.setLocalStateField("user", {
    name: `Ghost ${i + 1}`,
    color: COLORS[i % COLORS.length],
    colorLight: COLORS[i % COLORS.length].replace("1)", "0.25)"),
  });
  provider.awareness.setLocalStateField("activeFile", activeFileId);
  ghosts.push({ ydoc, provider, idx: i });
  console.log(`ghost ${i + 1}/${count} connected as Ghost ${i + 1}`);
}

console.log(`\n${ghosts.length} ghosts active. Ctrl-C to disconnect.`);

// Stay alive
await new Promise((resolve) => {
  process.on("SIGINT", () => {
    console.log("\ndisconnecting ghosts…");
    for (const { provider } of ghosts) provider.destroy();
    resolve();
  });
});
