// Flat config. Type-checked rules give us the extra sharp-edge lints that
// the review called out (unsafe-assignment/argument/return, floating
// promises, switch-exhaustiveness). Keep the rule set tight — this code
// pre-dates lint and we don't want to bury real problems in formatting
// noise.

import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
    {
        ignores: ["node_modules/**", "out/**", "tools/**/VERSION"]
    },
    js.configs.recommended,
    ...tseslint.configs.recommendedTypeChecked,
    {
        files: ["tools/**/*.ts"],
        languageOptions: {
            parserOptions: {
                project: "./tsconfig.json",
                tsconfigRootDir: import.meta.dirname
            }
        },
        rules: {
            "@typescript-eslint/no-floating-promises": "error",
            "@typescript-eslint/switch-exhaustiveness-check": "error",
            "@typescript-eslint/no-explicit-any": "warn",
            // Unused vars: mirror the tsconfig flags but allow _-prefixed.
            "@typescript-eslint/no-unused-vars": [
                "error",
                { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }
            ],
            // The ensign-dom / xslt-cleanup layer talks to xpath / xmldom /
            // saxon-js — untyped boundaries. Keep as warnings so the core
            // logic doesn't drown in `unsafe-*` noise; tighten once those
            // wrappers exist.
            "@typescript-eslint/no-unsafe-assignment": "warn",
            "@typescript-eslint/no-unsafe-argument": "warn",
            "@typescript-eslint/no-unsafe-call": "warn",
            "@typescript-eslint/no-unsafe-member-access": "warn",
            "@typescript-eslint/no-unsafe-return": "warn"
        }
    }
);
