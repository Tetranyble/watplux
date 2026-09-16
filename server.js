process.env.NODE_ENV = "production";

const { existsSync } = require("node:fs");
const path = require("node:path");

const standaloneServer = path.join(__dirname, "runtime", "server.js");

if (existsSync(standaloneServer)) {
  try {
    process.loadEnvFile(path.join(__dirname, ".env.production"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  require(standaloneServer);
  return;
}

const { createServer } = require("node:http");
const next = require("next");

const port = Number.parseInt(process.env.PORT || "3000", 10);
const hostname = "0.0.0.0";
const app = next({ dev: false, hostname, port });
const handle = app.getRequestHandler();

app
  .prepare()
  .then(() => {
    createServer((request, response) => handle(request, response)).listen(
      port,
      hostname,
      () => console.log(`Watplux is ready on ${hostname}:${port}`),
    );
  })
  .catch((error) => {
    console.error("Unable to start Watplux", error);
    process.exit(1);
  });
