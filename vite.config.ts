import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  root: 'web',
  base: './',
  publicDir: false,
  build: {
    outDir: '../dist-nebula3',
    emptyOutDir: true,
    assetsInlineLimit: 0,
    rollupOptions: {
      input: {
        nebula3: resolve(import.meta.dirname, 'web/nebula3.html'),
        lab: resolve(import.meta.dirname, 'web/nebula3-webgpu.html')
      },
      output: {
        entryFileNames: 'assets/nebula3-[hash].js',
        chunkFileNames: 'assets/nebula3-[hash].js',
        assetFileNames: 'assets/nebula3-[hash][extname]'
      }
    }
  }
});
