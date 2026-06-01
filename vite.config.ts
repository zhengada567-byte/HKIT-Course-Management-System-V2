import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api/hk-public-holidays-ics/en": {
        target: "https://www.1823.gov.hk",
        changeOrigin: true,
        rewrite: () => "/common/ical/en.ics",
      },
      "/api/hk-public-holidays-ics/tc": {
        target: "https://www.1823.gov.hk",
        changeOrigin: true,
        rewrite: () => "/common/ical/tc.ics",
      },
      "/api/hk-public-holidays-ics/sc": {
        target: "https://www.1823.gov.hk",
        changeOrigin: true,
        rewrite: () => "/common/ical/sc.ics",
      },
    },
  },
});
