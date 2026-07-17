import { defineConfig } from "vite";

export default defineConfig({
  root: ".",
  // Relative base so the site works under a sub-path (GitHub Pages: /WorldMaker/)
  base: "./",
  build: {
    outDir: "dist",
    rollupOptions: {
      input: {
        main: "index.html",
        map: "map.html",
        play: "play.html",
        playProvince: "playProvince.html",
      },
    },
  },
});
