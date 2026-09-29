// Builds the site (../build.sh -> ../dist) and runs every browser test; exits non-zero if any fails.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
fs.mkdirSync(path.join(here, ".out"), { recursive: true });
const build = spawnSync("sh", ["build.sh"], { cwd: path.join(here, ".."), stdio: "inherit" });
if (build.status !== 0) process.exit(1);

const tests = [
  ...fs.readdirSync(path.join(here, "admin")).filter(f => f.endsWith(".test.mjs")).map(f => path.join("admin", f)),
  ...fs.readdirSync(path.join(here, "site")).filter(f => f.endsWith(".test.cjs")).map(f => path.join("site", f)),
];
let failed = 0;
for (const t of tests) {
  const r = spawnSync("node", [t], { cwd: here, encoding: "utf8", timeout: 180000 });
  const out = (r.stdout || "") + (r.stderr || "");
  const fails = out.split("\n").filter(l => /^(FAIL|ASSERT FAIL)/.test(l));
  const ok = r.status === 0 && !fails.length;
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${t}`);
  if (!ok) console.log((fails.length ? fails.join("\n") : out.slice(-3000)).replace(/^/gm, "    "));
}
console.log(failed ? `\n${failed} of ${tests.length} browser test files failed` : `\nAll ${tests.length} browser test files passed`);
process.exit(failed ? 1 : 0);
