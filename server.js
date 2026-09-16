"use strict";

/* eslint-disable @typescript-eslint/no-require-imports -- cPanel startup is CommonJS and delegates to Next's generated standalone CommonJS server. */

process.env.NODE_ENV = "production";
process.env.HOSTNAME ||= "0.0.0.0";

const { existsSync } = require("node:fs");
const path = require("node:path");

const environmentFile = path.join(__dirname, ".env.production");
const standaloneServer = path.join(__dirname, "runtime", "server.js");

if (existsSync(environmentFile)) {
  process.loadEnvFile(environmentFile);
}

if (!existsSync(standaloneServer)) {
  throw new Error(
    "Packaged runtime/server.js is missing. Upload and extract a Watplux cPanel release archive before starting the application.",
  );
}

// cPanel/Passenger supplies PORT. The generated Next.js standalone server
// handles the HTTP lifecycle; this file only loads runtime configuration and
// delegates to it.
require(standaloneServer);
