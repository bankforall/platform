import { defineConfig, type Plugin } from "vitest/config";
import { loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { fileURLToPath } from "node:url";

/** Production bundles should pin the chain; without pins the built app refuses to sign (src/wallet/chain.ts). */
function requireChainPins(): Plugin {
  return {
    name: "bankforall-chain-pins",
    apply: "build",
    configResolved(config) {
      const env = loadEnv(config.mode, config.envDir || process.cwd(), "VITE_");
      const missing = ["VITE_CHAIN_ID", "VITE_FORWARDER_ADDRESS", "VITE_FACTORY_ADDRESS"].filter((k) => !env[k] && !process.env[k]);
      if (missing.length) config.logger.warn(`\n[bankforall] ${missing.join(", ")} not set: this build will refuse to sign any transaction.\n`);
    },
  };
}

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  plugins: [
    requireChainPins(),
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg"],
      manifest: {
        name: "Bank For All — วงแชร์โปร่งใส",
        short_name: "Bank For All",
        description: "จัดการวงแชร์ (เปียแชร์) อย่างโปร่งใส บันทึกถาวร ตรวจสอบได้",
        lang: "th",
        theme_color: "#7165E3",
        background_color: "#7165E3",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" },
        ],
      },
      workbox: {
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [],
      },
    }),
  ],
  server: {
    port: 5173,
    // API_PROXY_TARGET lets you point the dev server at another API instance (e.g. for E2E).
    proxy: { "/api": { target: process.env.API_PROXY_TARGET ?? "http://localhost:4000", changeOrigin: false } },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    // Build-time chain pins, as a production build would have them (see src/wallet/chain.ts).
    env: {
      VITE_CHAIN_ID: "84532",
      VITE_FORWARDER_ADDRESS: "0x00000000000000000000000000000000000000f0",
      VITE_FACTORY_ADDRESS: "0x00000000000000000000000000000000000000fa",
    },
    testTimeout: 30_000,
  },
});
