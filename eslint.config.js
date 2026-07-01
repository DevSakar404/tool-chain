// @ts-check
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import importPlugin from "eslint-plugin-import";

// D11 (docs/ARCHITECTURE.md): packages/core stays framework-agnostic — no
// Next/Supabase/React import ever lands in the engine. This is the one rule
// this config exists to enforce; everything else is baseline TS hygiene.
const FRAMEWORK_PACKAGES = ["next", "@supabase/supabase-js", "react", "react-dom"];

export default [
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/.next/**",
      "apps/web/src/components/ui/**",
      "apps/web/next-env.d.ts",
    ],
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      import: importPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },
  {
    // D11 boundary: packages/core must not depend on framework packages.
    files: ["packages/core/src/**/*.ts"],
    plugins: { import: importPlugin },
    rules: {
      "import/no-extraneous-dependencies": "off",
      "no-restricted-imports": [
        "error",
        {
          paths: FRAMEWORK_PACKAGES.map((name) => ({
            name,
            message: `packages/core is framework-agnostic (ARCHITECTURE.md D11) — "${name}" belongs in apps/web, behind a capability interface if core needs to call it.`,
          })),
        },
      ],
    },
  },
  {
    // NodeNext ESM (packages/core's module resolution) requires explicit .js
    // extensions on relative imports even though the sources are .ts.
    files: ["packages/core/src/**/*.ts"],
    ignores: ["packages/core/src/**/*.test.ts"],
    plugins: { import: importPlugin },
    rules: {
      "import/extensions": ["error", "ignorePackages", { ts: "never", js: "always" }],
    },
  },
];
