import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  // Lets tests render chat components (tsconfig keeps JSX for Next.js to compile).
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    include: ["lib/**/__tests__/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
