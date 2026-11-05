import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The portal calls the API at /api; in development Vite forwards that to apps/api, so the browser
// talks to one origin and the API needs no CORS rules.
export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
});
