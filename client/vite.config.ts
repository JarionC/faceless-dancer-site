import { defineConfig } from "vite";

const clientDevPort = Number.parseInt(process.env.CLIENT_DEV_PORT ?? "5173", 10);
const apiDevPort = Number.parseInt(process.env.PORT ?? "3001", 10);
const apiTarget =
  process.env.VITE_DEV_API_ORIGIN?.trim() ||
  `http://localhost:${Number.isFinite(apiDevPort) ? apiDevPort : 3001}`;

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
    port: Number.isFinite(clientDevPort) ? clientDevPort : 5173,
    proxy: {
      "/api": {
        target: apiTarget,
        changeOrigin: true,
      },
      "/socket.io": {
        target: apiTarget,
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
