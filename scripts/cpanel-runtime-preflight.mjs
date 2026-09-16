#!/usr/bin/env node

import { access, lstat, readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const problems = [];
const [nodeMajor, nodeMinor, nodePatch] = process.versions.node
  .split(".")
  .map(Number);

if (nodeMajor !== 22 || nodeMinor < 23 || (nodeMinor === 23 && nodePatch < 1)) {
  problems.push(
    `Node 22.23.1 or newer Node 22 is required; found ${process.versions.node}`,
  );
}

for (const file of [
  "runtime/server.js",
  "runtime/.next/BUILD_ID",
  "runtime/.next/server/webpack-runtime.js",
  "runtime/node_modules/next/dist/compiled/cookie/index.js",
]) {
  try {
    await access(file);
  } catch {
    problems.push(`${file} is missing`);
  }
}

const serverOutputDirectory = "runtime/.next/server";
let turbopackRuntime;
let hashedPrismaExternal;

async function inspectServerOutput(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      await inspectServerOutput(file);
      continue;
    }

    if (entry.name === "[turbopack]_runtime.js") {
      turbopackRuntime ??= file;
    }

    if (entry.name.endsWith(".js")) {
      const contents = await readFile(file, "utf8");
      if (/@prisma\/client-[0-9a-f]{8,}/i.test(contents)) {
        hashedPrismaExternal ??= file;
      }
    }
  }
}

try {
  await inspectServerOutput(serverOutputDirectory);
} catch (error) {
  problems.push(
    `${serverOutputDirectory} could not be inspected: ${error instanceof Error ? error.message : String(error)}`,
  );
}

if (turbopackRuntime) {
  problems.push(
    `stale Turbopack runtime found at ${turbopackRuntime}; deploy into a new empty release directory instead of extracting over an older runtime`,
  );
}

if (hashedPrismaExternal) {
  problems.push(
    `non-installable hashed Prisma external found in ${hashedPrismaExternal}; rebuild with npm run build:cpanel`,
  );
}

for (const packageName of ["sharp", "@node-rs/argon2", "@prisma/client"]) {
  try {
    await import(packageName);
  } catch (error) {
    problems.push(
      `${packageName} could not load on this host: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

for (const runtimeDependency of [
  "runtime/node_modules/sharp",
  "runtime/node_modules/@node-rs/argon2",
  "runtime/node_modules/@prisma/client",
  "runtime/node_modules/.prisma",
]) {
  try {
    const state = await lstat(runtimeDependency);
    if (!state.isSymbolicLink()) {
      problems.push(
        `${runtimeDependency} is not linked to the cPanel-installed Linux dependency`,
      );
    }
  } catch {
    problems.push(
      `${runtimeDependency} is missing; run npm run prepare:cpanel:runtime after npm ci`,
    );
  }
}

const runtimeRequire = createRequire(path.resolve("runtime/server.js"));
for (const packageName of [
  "sharp",
  "@node-rs/argon2",
  "@prisma/client",
  ".prisma/client/default",
]) {
  try {
    runtimeRequire.resolve(packageName);
  } catch (error) {
    problems.push(
      `${packageName} is not resolvable from runtime/server.js: ${error instanceof Error ? error.message : String(error)}. Run npm run prepare:cpanel:runtime after npm ci.`,
    );
  }
}

if (problems.length) {
  console.error("cPanel runtime preflight failed:\n- " + problems.join("\n- "));
  process.exit(1);
}

console.log("cPanel runtime preflight passed.");
