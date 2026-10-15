import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

const TARGET_API_URL =
  process.env.VITE_MANAGEMENT_API_URL || 'http://localhost:8000';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  server: {
    port: 3000,
    proxy: {
      '/api/v1': {
        target: TARGET_API_URL,
        changeOrigin: true,
      },
    },
  },
  css: {
    postcss: './postcss.config.js',
  },
});
