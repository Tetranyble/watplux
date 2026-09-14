#!/usr/bin/env node
import { createWriteStream, mkdirSync } from "node:fs";
import { basename, resolve } from "node:path";
import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required.");
const url = new URL(databaseUrl);
if (url.protocol !== "mysql:") throw new Error("DATABASE_URL must be mysql://");

const outputDir = resolve(process.env.BACKUP_DIR ?? "./backups");
mkdirSync(outputDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const dbName = basename(url.pathname);
const output = resolve(outputDir, `${dbName}-${stamp}.sql.gz`);

const args = [
  `--host=${url.hostname}`,
  `--port=${url.port || "3306"}`,
  `--user=${decodeURIComponent(url.username)}`,
  "--single-transaction",
  "--quick",
  "--set-gtid-purged=OFF",
  "--routines",
  "--triggers",
  "--events",
  dbName,
];

const dump = spawn("mysqldump", args, {
  stdio: ["ignore", "pipe", "inherit"],
  env: { ...process.env, MYSQL_PWD: decodeURIComponent(url.password) },
});

const gzip = createGzip({ level: 9 });
const file = createWriteStream(output, { mode: 0o600 });
await pipeline(dump.stdout, gzip, file);
const exitCode = await new Promise((resolveCode) =>
  dump.on("close", resolveCode),
);
if (exitCode !== 0) {
  console.error(`mysqldump failed with exit code ${exitCode}`);
  process.exit(Number(exitCode) || 1);
}
console.log(output);
