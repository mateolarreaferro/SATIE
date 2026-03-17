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
        manualChunks: {
          'vendor-three': ['three', '@react-three/fiber', '@react-three/drei', '@react-three/postprocessing'],
          'vendor-monaco': ['monaco-editor'],
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
});
