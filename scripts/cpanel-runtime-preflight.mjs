#!/usr/bin/env node

import { access } from "node:fs/promises";

const problems = [];
const [nodeMajor, nodeMinor, nodePatch] = process.versions.node
  .split(".")
  .map(Number);

if (nodeMajor !== 22 || nodeMinor < 23 || (nodeMinor === 23 && nodePatch < 1)) {
  problems.push(
    `Node 22.23.1 or newer Node 22 is required; found ${process.versions.node}`,
  );
}

for (const file of ["runtime/server.js", "runtime/.next/BUILD_ID"]) {
  try {
    await access(file);
  } catch {
    problems.push(`${file} is missing`);
  }
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

if (problems.length) {
  console.error("cPanel runtime preflight failed:\n- " + problems.join("\n- "));
  process.exit(1);
}

console.log("cPanel runtime preflight passed.");
