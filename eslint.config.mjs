import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

/**
 * Flat config, using eslint-config-next 16's native flat exports directly
 * rather than the `FlatCompat` shim — the shim throws on this combination of
 * ESLint 9 and the Next config's plugin graph.
 */
const config = [
  ...coreWebVitals,
  ...typescript,
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "drizzle/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
      "evals/reports/**",
      "tests/e2e/.auth/**",
      "storybook-static/**",
    ],
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
    },
  },
];

export default config;
