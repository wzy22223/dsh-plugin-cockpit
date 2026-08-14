import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    copyPublicDir: false,
  },
  server: {
    host: "127.0.0.1",
    port: 7877,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:7799",
      },
    },
  },
});
