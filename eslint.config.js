import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import nextjs from "@next/eslint-plugin-next";

export default tseslint.config(
  eslint.configs.recommended,
  {
    ignores: [".next/**"],
  },
  ...tseslint.configs.recommended,
  {
    files: ["**/*.js", "**/*.jsx", "**/*.ts", "**/*.tsx"],
    plugins: {
      react: react,
      reactHooks: reactHooks,
      "@next/next": nextjs,
    },
    rules: {
      // Add any custom rules here
      "reactHooks/exhaustive-deps": "warn", // Add this rule with the correct prefix
      "react/prop-types": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      ...react.configs.recommended.rules,
      ...react.configs["jsx-runtime"].rules,
      ...nextjs.configs.recommended.rules,
      ...nextjs.configs["core-web-vitals"].rules,
    },
    languageOptions: {
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    settings: {
      react: {
        version: "detect",
      },
    },
  },
);
