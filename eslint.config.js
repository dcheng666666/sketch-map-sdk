import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettierConfig from "eslint-config-prettier";
import globals from "globals";
import importX from "eslint-plugin-import-x";
import boundaries from "eslint-plugin-boundaries";

export default tseslint.config(
  {
    ignores: ["dist/", "node_modules/", "patches/", "coverage/", "*.tgz", "src/core/data/"],
  },
  js.configs.recommended,
  {
    files: ["src/**/*.ts"],
    extends: [...tseslint.configs.recommendedTypeChecked],
    plugins: {
      "import-x": importX,
      boundaries,
    },
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Clean Code: complexity/size guards (enforced as error).
      complexity: ["error", 30],
      "max-lines-per-function": ["error", { max: 120, skipBlankLines: true, skipComments: true }],
      "max-lines": ["error", { max: 1500, skipBlankLines: true, skipComments: true }],
      "max-params": ["error", 8],
      "max-depth": ["error", 4],
      "max-statements": ["error", 80],

      // Architecture: cycles & dependency governance.
      "import-x/no-cycle": ["error", { ignoreExternal: true }],
      "import-x/no-extraneous-dependencies": [
        "error",
        {
          devDependencies: ["scripts/**", "**/*.test.ts", "**/*.spec.ts", "**/*.bench.ts"],
          optionalDependencies: false,
          peerDependencies: true,
        },
      ],

      // Architecture: internal path blacklist (soft public API constraint).
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "jsdom",
              message: "jsdom is headless-only; do not use it in core/browser.",
            },
          ],
          patterns: ["**/internal/**", "**/private/**", "**/__private__/**"],
        },
      ],
    },
  },
  {
    files: ["src/browser/**/*.ts", "src/browser.ts"],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      // Browser layer should not depend on Node built-ins.
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "fs", message: "Do not use Node built-ins in browser layer." },
            { name: "node:fs", message: "Do not use Node built-ins in browser layer." },
            { name: "path", message: "Do not use Node built-ins in browser layer." },
            { name: "node:path", message: "Do not use Node built-ins in browser layer." },
            { name: "os", message: "Do not use Node built-ins in browser layer." },
            { name: "node:os", message: "Do not use Node built-ins in browser layer." },
            { name: "child_process", message: "Do not use Node built-ins in browser layer." },
            { name: "node:child_process", message: "Do not use Node built-ins in browser layer." },
          ],
        },
      ],
    },
  },
  {
    files: ["src/headless/**/*.ts", "src/headless.ts"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // Allow headless adapter to use jsdom.
      "no-restricted-imports": [
        "error",
        {
          patterns: ["**/internal/**", "**/private/**", "**/__private__/**"],
        },
      ],
    },
  },
  {
    files: ["src/core/**/*.ts"],
    languageOptions: {
      globals: {},
    },
    rules: {
      // Core should stay runtime-agnostic: disallow obvious platform APIs.
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "fs", message: "Core must be runtime-agnostic; use adapters." },
            { name: "node:fs", message: "Core must be runtime-agnostic; use adapters." },
            { name: "path", message: "Core must be runtime-agnostic; use adapters." },
            { name: "node:path", message: "Core must be runtime-agnostic; use adapters." },
          ],
          patterns: ["**/internal/**", "**/private/**", "**/__private__/**"],
        },
      ],
    },
  },
  {
    files: ["src/core/**/*.ts"],
    rules: {
      // Layer guardrail: core must not import browser/headless adapters.
      "boundaries/element-types": [
        "error",
        {
          default: "disallow",
          rules: [
            {
              from: ["core"],
              disallow: ["browser", "headless"],
            },
            {
              from: ["browser"],
              allow: ["core", "browser"],
            },
            {
              from: ["headless"],
              allow: ["core", "headless"],
              disallow: ["browser"],
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/**/*.ts"],
    settings: {
      "boundaries/elements": [
        { type: "core", pattern: "src/core/**" },
        { type: "browser", pattern: "src/browser/**" },
        { type: "headless", pattern: "src/headless/**" },
      ],
    },
  },
  {
    files: ["scripts/**/*.{js,mjs,cjs}"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // Don't block scripts with strict size/complexity caps.
      complexity: "off",
      "max-lines": "off",
      "max-lines-per-function": "off",
      "max-statements": "off",
      "max-depth": "off",
    },
  },
  prettierConfig,
);
