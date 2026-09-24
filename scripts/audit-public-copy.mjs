import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const roots = [
  "app/(storefront)",
  "app/_components",
  "components/storefront",
  "components/brand",
];
const explicitFiles = [
  "app/error.tsx",
  "app/global-error.tsx",
  "app/layout.tsx",
  "app/manifest.ts",
  "app/opengraph-image.tsx",
  "components/theme-toggle.tsx",
  "src/integrations/email/templates.ts",
];

function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  });
}

const files = [
  ...roots.flatMap((directory) => walk(path.join(root, directory))),
  ...explicitFiles.map((file) => path.join(root, file)),
].filter((file) => /\.(ts|tsx)$/.test(file));

const violations = [];
for (const file of files) {
  const source = fs.readFileSync(file, "utf8");
  const relative = path.relative(root, file);
  source.split(/\r?\n/).forEach((line, index) => {
    const lineNumber = index + 1;
    if (/<([A-Za-z][A-Za-z0-9.]*)\b[^>]*>\s*[A-Za-z][^<{]*<\/\1>/.test(line)) {
      violations.push(`${relative}:${lineNumber}: raw JSX text`);
    }
    if (
      /\b(?:aria-label|placeholder|alt|title|description|label)=["'][^"']*[A-Za-z][^"']*["']/.test(
        line,
      )
    ) {
      violations.push(
        `${relative}:${lineNumber}: literal public attribute text`,
      );
    }
    if (/toast\.(?:success|error|info|warning)\(\s*["'][A-Za-z]/.test(line)) {
      violations.push(`${relative}:${lineNumber}: literal public toast text`);
    }
  });
}

if (violations.length) {
  console.error(
    "Public copy audit failed. Move the following public-facing text into database-backed copy:",
  );
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log(`Public copy audit passed (${files.length} source files checked).`);
