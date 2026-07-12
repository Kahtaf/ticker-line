import { defineConfig } from "astro/config";

export default defineConfig({
  srcDir: "./site",
  publicDir: "./public",
  outDir: "./dist",
  output: "static",
  build: {
    inlineStylesheets: "auto",
  },
});
