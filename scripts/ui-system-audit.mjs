import fs from "node:fs";
import path from "node:path";

const roots = ["app", "components"];
const violations = [];
const files = [];

function walk(directory) {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(target);
    else if (entry.isFile() && target.endsWith(".tsx")) files.push(target);
  }
}

for (const root of roots) walk(root);

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

for (const file of files) {
  if (file.startsWith(`components${path.sep}ui${path.sep}`)) continue;
  const source = stripComments(fs.readFileSync(file, "utf8"));
  const rawControl = source.match(/<(input|select|textarea|button)(?=[\s>])/);
  if (rawControl)
    violations.push(
      `${file}: raw <${rawControl[1]}> control; use a components/ui primitive instead.`,
    );
  if (/window\.confirm\s*\(/.test(source))
    violations.push(
      `${file}: window.confirm is not part of the Watplux dialog system.`,
    );
  if (/from\s+["\']sonner["\']/.test(source))
    violations.push(
      `${file}: import the Watplux Base UI toast system from @/components/ui/toast instead of Sonner.`,
    );
  if (/components\/forms\/server-message/.test(source))
    violations.push(
      `${file}: form-level mutation feedback belongs in the toaster; keep field validation inline.`,
    );
  if (/new\s+FormData\s*\(\s*(?:event|e)\.currentTarget\s*\)/.test(source))
    violations.push(
      `${file}: manual form scraping; use React Hook Form controlled fields.`,
    );
  if (
    /useForm\s*</.test(source) &&
    !/mode\s*:\s*["']onChange["']/.test(source)
  ) {
    violations.push(
      `${file}: React Hook Form must use mode: "onChange" for live validation/state.`,
    );
  }
}

if (violations.length) {
  console.error(
    `UI system audit failed (${violations.length} violation${violations.length === 1 ? "" : "s"}):`,
  );
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log(`UI system audit passed: ${files.length} TSX files inspected.`);
