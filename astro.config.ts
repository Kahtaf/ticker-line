import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://ticker-line.com",
  srcDir: "./site",
  publicDir: "./public",
  outDir: "./dist",
  output: "static",
  build: {
    inlineStylesheets: "auto",
  },
});
