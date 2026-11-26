import { defineConfig } from 'vite';

// Relative base so the build works on GitHub Pages under any repo name
// (https://<user>.github.io/<repo>/) as well as from any static host.
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    target: 'es2020',
    chunkSizeWarningLimit: 1200,
  },
  server: {
    host: true,
    port: 5173,
  },
});
