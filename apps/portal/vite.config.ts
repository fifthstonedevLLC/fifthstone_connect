import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The portal calls the API at /api; in development Vite forwards that to apps/api, so the browser
// talks to one origin and the API needs no CORS rules.
//
// `npm run dev:phone` (mode `phone`) is for trying the portal on a phone on the same Wi-Fi: it
// listens on the local network at port 5174 and also forwards sign-in at /supabase to the local
// Supabase stack, since a phone cannot reach this computer's 127.0.0.1. Mock data only; stop it
// when done.
export default defineConfig(({ mode }) => {
  const phone = mode === 'phone';
  return {
    plugins: [react()],
    server: {
      host: phone ? '0.0.0.0' : '127.0.0.1',
      port: phone ? 5174 : 5173,
      strictPort: true,
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:8787',
          rewrite: (path) => path.replace(/^\/api/, ''),
        },
        ...(phone
          ? {
              '/supabase': {
                target: 'http://127.0.0.1:54321',
                rewrite: (path) => path.replace(/^\/supabase/, ''),
              },
            }
          : {}),
      },
    },
  };
});
