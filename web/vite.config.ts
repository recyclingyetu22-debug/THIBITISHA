import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    // Vite 5's Host-header allowlist blocks requests through a tunnel
    // (localtunnel/ngrok/etc.) by default since the Host header won't say
    // "localhost". `true` trusts any Host — fine for a throwaway dev tunnel,
    // not something to carry into a real deployment.
    allowedHosts: true,
  },
});
