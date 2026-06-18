import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    /** Listen on LAN — default is localhost-only, so other machines cannot open :5173. */
    host: true,
    allowedHosts: ["app.msiwebapp.com"],
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
        proxyTimeout: 600000,
        timeout: 600000,
      },
    },
  },
});
