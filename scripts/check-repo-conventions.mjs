#!/usr/bin/env node
/**
 * Conventions a single main should keep: import-voices.py present and valid,
 * compose project name xintian-edu-hot (containers xintian-edu-hot-api-1 / -db-1),
 * and Postgres 18 in compose.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];

const importer = path.join(ROOT, "scripts/import-voices.py");
if (!existsSync(importer)) {
  errors.push("scripts/import-voices.py is missing");
} else {
  try {
    execFileSync("python3", ["-m", "py_compile", importer], { cwd: ROOT, stdio: "pipe" });
  } catch (error) {
    errors.push("scripts/import-voices.py failed py_compile");
    if (error.stderr) errors.push(String(error.stderr));
  }
}

const compose = readFileSync(path.join(ROOT, "docker-compose.yml"), "utf8");
const name = compose.match(/^name:\s*(\S+)/m)?.[1];
if (name !== "xintian-edu-hot") {
  errors.push(`docker-compose.yml name must be xintian-edu-hot (got ${name ?? "missing"}) so the API container is xintian-edu-hot-api-1`);
}
const pg = compose.match(/image:\s*(postgres:[^\s]+)/);
if (!pg || !/^postgres:18\b/.test(pg[1])) {
  errors.push(`docker-compose.yml must pin postgres:18 (got ${pg?.[1] ?? "missing"})`);
}

if (errors.length) {
  for (const e of errors) console.error(`check-repo-conventions: ${e}`);
  process.exit(1);
}
console.log("check-repo-conventions: ok (import-voices.py, compose name xintian-edu-hot, postgres 18)");
