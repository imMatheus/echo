import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // 127.0.0.1, not localhost: node may resolve localhost to ::1 first and
      // silently fall back to whatever else squats the port on 127.0.0.1.
      '/api': 'http://127.0.0.1:3246',
      '/mcp': 'http://127.0.0.1:3246',
    },
  },
  build: {
    outDir: 'dist',
  },
});
