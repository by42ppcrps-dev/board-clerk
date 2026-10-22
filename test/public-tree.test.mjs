import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { SERVER_VERSION } from "../src/server.js";

const root = fileURLToPath(new URL("..", import.meta.url));

const removed = [
  "STATUS.md",
  "SUBMIT.md",
  "scripts/prepare-public-history.sh",
  "docs/RED-TEAM-1011.md",
  "docs/REVIEW-FINDINGS-1011.md",
  "docs/REVIEW-ROUND2.md",
  "docs/ROUND3.md",
  "docs/ROUND4.md",
  "docs/SPEC-v0.2.md",
];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".git") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

test("server version is consistent across package, docs, and health", () => {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const readme = readFileSync(join(root, "README.md"), "utf8");
  const arch = readFileSync(join(root, "docs/ARCHITECTURE.md"), "utf8");
  const judges = readFileSync(join(root, "docs/JUDGES.md"), "utf8");
  const license = readFileSync(join(root, "LICENSE"), "utf8");
  assert.equal(SERVER_VERSION, "0.4.1");
  assert.equal(pkg.version, SERVER_VERSION);
  assert.equal(pkg.license, "MIT");
  assert.match(license, /MIT License/);
  assert.match(readme, new RegExp(`version \`${SERVER_VERSION}\``));
  assert.match(arch, new RegExp(`\`board-clerk\` ${SERVER_VERSION}`));
  assert.match(judges, new RegExp(`version \`${SERVER_VERSION}\``));
  assert.doesNotMatch(readme, /version `0\.3\.0`/);
  assert.doesNotMatch(arch, /0\.3\.0/);
  assert.match(readme, /lumegridai\.workers\.dev/);
});

test("internal QA notes are not in the working tree", () => {
  for (const rel of removed) {
    assert.equal(existsSync(join(root, rel)), false, rel);
  }
});

test("working tree has no account ids or credential material", () => {
  const skip = new Set([join(root, "package-lock.json")]);
  const wrangler = readFileSync(join(root, "wrangler.toml"), "utf8");
  assert.doesNotMatch(wrangler, /account_id\s*=/);
  assert.match(wrangler, /name = "lumegrid-board-clerk-v02"/);
  const patterns = [
    [/account_id\s*=\s*"[0-9a-fA-F]{32}"/, "cloudflare account id"],
    [/AKIA[0-9A-Z]{16}/, "aws access key"],
    [/sk_(?:live|test)_/, "stripe key"],
    [/ghp_[0-9A-Za-z]{20,}/, "github token"],
    [/github_pat_[0-9A-Za-z_]{20,}/, "github fine-grained token"],
    [/-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/, "private key"],
  ];
  const hits = [];
  for (const path of walk(root)) {
    if (skip.has(path)) continue;
    let text;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    for (const [pattern, label] of patterns) {
      if (pattern.test(text)) hits.push(`${label} in ${path.slice(root.length + 1)}`);
    }
  }
  assert.deepEqual(hits, []);
});
