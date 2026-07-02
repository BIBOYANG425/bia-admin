import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    include: ["**/__tests__/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      // bia-shared's service-role factory carries `import "server-only"`
      // (build-time client-graph guard) — stub it out for Node test runs.
      "server-only": path.resolve(__dirname, "test/server-only-stub.ts"),
    },
  },
});
