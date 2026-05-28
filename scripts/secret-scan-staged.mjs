import { spawnSync } from "node:child_process";

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, {
    stdio: "inherit",
    shell: false,
    ...opts,
  });
  if (res.error) throw res.error;
  return res.status ?? 1;
}

function getStagedFiles() {
  const res = spawnSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACMR"], {
    encoding: "utf8",
  });
  if (res.error) throw res.error;
  if (res.status !== 0) return [];
  return res.stdout
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((p) => !p.startsWith(".husky/"));
}

const files = getStagedFiles();
if (files.length === 0) process.exit(0);

// Run via package manager binary resolution (no global install).
const status = run("pnpm", ["exec", "secretlint", ...files]);
process.exit(status);
