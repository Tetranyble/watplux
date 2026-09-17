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
    resolveSource: () =>
      path.dirname(applicationRequire.resolve("@prisma/client/package.json")),
    target: path.join(runtimeDirectory, "node_modules/@prisma/client"),
  },
  {
    name: "Prisma generated client",
    resolveSource: () =>
      path.dirname(
        path.dirname(applicationRequire.resolve(".prisma/client/default")),
      ),
    target: path.join(runtimeDirectory, "node_modules/.prisma"),
  },
  {
    name: "@node-rs/argon2",
    resolveSource: () =>
      path.dirname(applicationRequire.resolve("@node-rs/argon2/package.json")),
    target: path.join(runtimeDirectory, "node_modules/@node-rs/argon2"),
  },
  {
    name: "sharp",
    resolveSource: () =>
      path.dirname(applicationRequire.resolve("sharp/package.json")),
    target: path.join(runtimeDirectory, "node_modules/sharp"),
  },
];

for (const dependency of dependencies) {
  await mkdir(path.dirname(dependency.target), { recursive: true });

  try {
    const targetState = await lstat(dependency.target);
    if (!targetState.isSymbolicLink()) {
      console.log(`${dependency.name} is packaged inside the runtime.`);
      continue;
    }

    const existingLink = await readlink(dependency.target);
    try {
      await realpath(
        path.resolve(path.dirname(dependency.target), existingLink),
      );
      console.log(`${dependency.name} is already linked into the runtime.`);
      continue;
    } catch {
      await unlink(dependency.target);
    }
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "ENOENT"
    ) {
      throw error;
    }
  }

  let source;
  try {
    source = await realpath(dependency.resolveSource());
  } catch (error) {
    throw new Error(
      `${dependency.name} is absent from both runtime/node_modules and the application dependency directory. Deploy a freshly built self-contained cPanel archive.`,
      { cause: error },
    );
  }
  await symlink(source, dependency.target, "dir");
  console.log(`${dependency.name} linked into the packaged runtime.`);
}

try {
  const runtimeRequire = createRequire(
    path.join(runtimeDirectory, "server.js"),
  );
  const sharp = runtimeRequire("sharp");
  await sharp({
    create: {
      width: 1,
      height: 1,
      channels: 3,
      background: "white",
    },
  })
    .webp()
    .toBuffer();
  console.log("Sharp native runtime verified.");
} catch (error) {
  throw new Error(
    `Sharp cannot run on this host. Deploy a freshly built self-contained cPanel archive. ${error instanceof Error ? error.message : String(error)}`,
    { cause: error },
  );
}
