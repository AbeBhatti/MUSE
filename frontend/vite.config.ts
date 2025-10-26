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
        external: (id) => {
          // Externalize React and socket.io
          if (id === 'react' || id === 'react-dom' || id === 'React' || id === 'ReactDOM') return true;
          if (id.includes('/socket.io/') || id.includes('collab-client')) return true;
          return false;
        }
    }
  },
  base: '/'
})
