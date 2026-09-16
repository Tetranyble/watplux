#!/usr/bin/env node

import { createRequire } from "node:module";
import {
  access,
  lstat,
  mkdir,
  readlink,
  realpath,
  symlink,
  unlink,
} from "node:fs/promises";
import path from "node:path";

const applicationRoot = process.cwd();
const runtimeDirectory = path.join(applicationRoot, "runtime");

try {
  await access(path.join(runtimeDirectory, "server.js"));
} catch {
  console.log(
    "No packaged cPanel runtime found; runtime dependency linking skipped.",
  );
  process.exit(0);
}

const applicationRequire = createRequire(
  path.join(applicationRoot, "package.json"),
);

const dependencies = [
  {
    name: "@prisma/client",
    source: path.dirname(
      applicationRequire.resolve("@prisma/client/package.json"),
    ),
    target: path.join(runtimeDirectory, "node_modules/@prisma/client"),
  },
  {
    name: "Prisma generated client",
    source: path.dirname(
      path.dirname(applicationRequire.resolve(".prisma/client/default")),
    ),
    target: path.join(runtimeDirectory, "node_modules/.prisma"),
  },
  {
    name: "@node-rs/argon2",
    source: path.dirname(
      applicationRequire.resolve("@node-rs/argon2/package.json"),
    ),
    target: path.join(runtimeDirectory, "node_modules/@node-rs/argon2"),
  },
  {
    name: "sharp",
    source: path.dirname(applicationRequire.resolve("sharp/package.json")),
    target: path.join(runtimeDirectory, "node_modules/sharp"),
  },
];

for (const dependency of dependencies) {
  const source = await realpath(dependency.source);
  await mkdir(path.dirname(dependency.target), { recursive: true });

  try {
    const targetState = await lstat(dependency.target);
    if (!targetState.isSymbolicLink()) {
      throw new Error(
        `${dependency.target} already exists and is not a symbolic link; deploy into a new empty release directory`,
      );
    }

    const existingLink = await readlink(dependency.target);
    const existingSource = await realpath(
      path.resolve(path.dirname(dependency.target), existingLink),
    );
    if (existingSource === source) {
      console.log(`${dependency.name} is already linked into the runtime.`);
      continue;
    }

    await unlink(dependency.target);
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "ENOENT"
    ) {
      throw error;
    }
  }

  await symlink(source, dependency.target, "dir");
  console.log(`${dependency.name} linked into the packaged runtime.`);
}
