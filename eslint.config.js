// Flat ESLint config (ESLint 9+).
//
// Intentionally minimal: this is not a full style ruleset. Its sole job is to
// keep `console.*` out of server runtime code so logging stays structured and
// leveled (see logger.ts). Use the `logger` instead.
//
// Scripts (build_scripts/) and tests keep `console` — it's fine there.
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      "ts_emitted/**",
      "src/generated/**",
      "ogm_types.ts",
      "schema.introspection.json",
      "eslint.config.js",
    ],
  },
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: 2022,
      sourceType: "module",
    },
    rules: {
      "no-console": "error",
    },
  },
  {
    // console is acceptable in one-off scripts and tests.
    files: ["build_scripts/**", "tests/**", "**/*.test.ts"],
    rules: {
      "no-console": "off",
    },
  }
);
