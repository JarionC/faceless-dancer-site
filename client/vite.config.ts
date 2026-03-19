import { defineConfig } from "vite";

export default defineConfig({
  resolve: {
    alias: {
      react: "preact/compat",
      "react-dom": "preact/compat",
      "react-dom/test-utils": "preact/test-utils",
      "react/jsx-runtime": "preact/jsx-runtime",
    },
  },
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "preact",
  },
  server: {
    port: 5173,
  },
});
