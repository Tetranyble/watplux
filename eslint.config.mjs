import { defineConfig, globalIgnores } from "eslint/config";
import boundaries from "eslint-plugin-boundaries";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettierConfig from "eslint-config-prettier";

// Architectural layers, per docs/ARCHITECTURE.md §1. Enforced as lint
// errors, not just review comments — see §21 (Phase 1 scope).
const architectureBoundaries = {
  files: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}", "src/**/*.{ts,tsx}"],
  plugins: { boundaries },
  settings: {
    "boundaries/elements": [
      { type: "presentation", pattern: "app/**" },
      { type: "component", pattern: "components/**" },
      { type: "use-case", pattern: "src/modules/*/use-cases/**" },
      { type: "domain", pattern: "src/modules/*/domain/**" },
      { type: "integration", pattern: "src/integrations/**" },
      { type: "job", pattern: "src/jobs/**" },
    ],
    "boundaries/files": [
      { category: "repo", pattern: "src/modules/*/repo.ts" },
      { category: "schema", pattern: "src/modules/*/schema.ts" },
      { category: "module-types", pattern: "src/modules/*/types.ts" },
    ],
  },
  rules: {
    // Presentation (app/**) may orchestrate through use-cases only — never
    // reach into a module's repo/domain directly, and never call another
    // module's integration client directly.
    "boundaries/dependencies": [
      "error",
      {
        default: "allow",
        policies: [
          {
            from: { element: { type: "presentation" } },
            disallow: {
              to: [
                { file: { categories: "repo" } },
                {
                  element: {
                    types: { anyOf: ["domain", "integration", "job"] },
                  },
                },
              ],
            },
            message:
              "Presentation (app/**) must go through a use-case — it may not import a repo, domain, integration, or job module directly. See docs/ARCHITECTURE.md §1.",
          },
          {
            from: { element: { type: "component" } },
            disallow: {
              to: [
                { file: { categories: "repo" } },
                {
                  element: {
                    types: {
                      anyOf: ["domain", "integration", "use-case", "job"],
                    },
                  },
                },
              ],
            },
            message:
              "Shared UI components must stay presentational — no repo, domain, integration, use-case, or job imports. See docs/ARCHITECTURE.md §1.",
          },
          {
            from: { element: { type: "domain" } },
            disallow: {
              to: [
                { file: { categories: "repo" } },
                {
                  element: {
                    types: {
                      anyOf: [
                        "integration",
                        "use-case",
                        "presentation",
                        "component",
                        "job",
                      ],
                    },
                  },
                },
              ],
            },
            message:
              "domain/* must have zero I/O (docs/ARCHITECTURE.md §1) — it cannot import a repo, integration, use-case, presentation, component, or job module.",
          },
          {
            from: { file: { categories: "repo" } },
            disallow: {
              to: {
                element: {
                  types: {
                    anyOf: [
                      "use-case",
                      "presentation",
                      "component",
                      "domain",
                      "job",
                    ],
                  },
                },
              },
            },
            message:
              "repo.ts is data access only — it cannot import a use-case, presentation, component, domain, or job module. See docs/ARCHITECTURE.md §1.",
          },
          {
            from: { element: { type: "integration" } },
            disallow: {
              to: [
                { file: { categories: "repo" } },
                {
                  element: {
                    types: {
                      anyOf: [
                        "use-case",
                        "presentation",
                        "component",
                        "domain",
                        "job",
                      ],
                    },
                  },
                },
              ],
            },
            message:
              "Integrations are thin external clients with no business logic — they cannot import a use-case, presentation, component, domain, or job module. See docs/ARCHITECTURE.md §1.",
          },
          {
            from: { element: { type: "job" } },
            disallow: {
              to: [
                { file: { categories: "repo" } },
                {
                  element: {
                    types: { anyOf: ["presentation", "component", "domain"] },
                  },
                },
              ],
            },
            message:
              "Jobs orchestrate through use-cases only — they cannot import a repo, presentation, component, or domain module directly. See docs/ARCHITECTURE.md §6.3.",
          },
        ],
      },
    ],
  },
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  architectureBoundaries,
  prettierConfig,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "playwright-report/**",
    "test-results/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
