import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const packageJson = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
);
const lock = JSON.parse(
  fs.readFileSync(path.join(root, "package-lock.json"), "utf8"),
);
const lockRoot = lock.packages?.[""];

if (!lockRoot) {
  console.error("package-lock.json does not contain a root package entry.");
  process.exit(1);
}

const sections = ["dependencies", "devDependencies"];
const problems = [];

for (const section of sections) {
  const expected = packageJson[section] ?? {};
  const actual = lockRoot[section] ?? {};

  for (const [name, version] of Object.entries(expected)) {
    if (!(name in actual)) {
      problems.push(`${section}: ${name} is missing from package-lock.json`);
      continue;
    }
    if (actual[name] !== version) {
      problems.push(
        `${section}: ${name} is ${JSON.stringify(actual[name])} in package-lock.json but ${JSON.stringify(version)} in package.json`,
      );
    }
  }

  for (const name of Object.keys(actual)) {
    if (!(name in expected)) {
      problems.push(
        `${section}: ${name} exists in package-lock.json but not package.json`,
      );
    }
  }
}

if (problems.length > 0) {
  console.error("package.json and package-lock.json are not synchronized:\n");
  for (const problem of problems) console.error(`- ${problem}`);
  console.error(
    "\nRun `npm install`, review the resulting lockfile, and commit package-lock.json before CI/release.",
  );
  process.exit(1);
}

console.log(
  "package.json and package-lock.json root dependency declarations are synchronized.",
);
