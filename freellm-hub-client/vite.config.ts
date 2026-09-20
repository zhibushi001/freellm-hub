import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/admin/static/',
  server: {
    proxy: {
      '/api': 'http://localhost:3303',
      '/v1': 'http://localhost:3303',
      '/admin': 'http://localhost:3303',
      '/health': 'http://localhost:3303',
      '/static': 'http://localhost:3303',
    },
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  },
});
