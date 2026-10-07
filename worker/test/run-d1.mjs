// Second pass of the worker tests, against the D1 data layer (see d1-harness.mjs).
// Needs Node's built-in SQLite (Node 22.13+, or 22.5+ with --experimental-sqlite).
try {
  await import("node:sqlite");
} catch {
  console.log("SKIP D1 test pass: this Node has no node:sqlite (" + process.version + ")");
  // GitHub Actions must always run it; elsewhere (e.g. the deploy build) skipping is allowed.
  process.exit(process.env.GITHUB_ACTIONS ? 1 : 0);
}
process.env.DB_BACKEND = "d1";
await import("./worker.test.mjs");
