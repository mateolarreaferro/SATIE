import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@engine': path.resolve(__dirname, 'src/engine'),
      '@ui': path.resolve(__dirname, 'src/ui'),
      '@api': path.resolve(__dirname, 'src/api'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Only React is manually chunked — it's needed eagerly on every page, so a
        // stable `vendor-react` chunk improves repeat-visit caching across deploys.
        //
        // Three.js and Monaco are deliberately NOT manually chunked: the old object
        // form let Rollup co-locate Vite's shared `__vitePreload` helper into the
        // big vendor-three chunk, so the entry statically imported ~1.1MB of Three
        // just to get that helper — forcing it to be eagerly preloaded on the
        // landing page. Letting Rollup auto-split them keeps the helper in the
        // entry and emits Three.js as an on-demand chunk imported only by routes
        // that render 3D (Editor, SketchView, Embed, Gallery, Library) and by Chat
        // once a soundscape is generated.
        manualChunks(id) {
          if (
            id.includes('node_modules/react/') ||
            id.includes('node_modules/react-dom/') ||
            id.includes('node_modules/react-router') ||
            id.includes('node_modules/scheduler/')
          ) {
            return 'vendor-react';
          }
        },
      },
    },
  },
});
