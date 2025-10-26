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
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
        input: 'workspace.html',
        external: ['/socket.io/socket.io.js', '/collab-client.js']
    }
  },
  base: '/'
})
