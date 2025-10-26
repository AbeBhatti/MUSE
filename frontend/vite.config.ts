import { defineConfig } from 'vite'

export default defineConfig({
  root: '.',
  publicDir: 'public',
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/upload': {
        target: 'http://localhost:1234',
        changeOrigin: true,
      },
      '/midi': {
        target: 'http://localhost:1234',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'frontend/dist',
    emptyOutDir: true,
  },
})
