import { defineConfig } from "vite";

export default defineConfig({
  // GitHub Pages serves the game from /<repo>/; local builds stay at the root.
  base: process.env.BASE_PATH ?? "/",
  server: { port: 5180 },
  worker: { format: "es" },
});
