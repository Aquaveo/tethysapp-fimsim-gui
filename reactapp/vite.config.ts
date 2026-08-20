import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import path from 'path';

export default defineConfig(({ mode }) => ({
  // BASE URL: dev = '/', production = Tethys app URL
  base: mode === 'production' ? '/apps/fimsim-gui/' : '/',

  plugins: [react()],

  build: {
    outDir: path.resolve(__dirname, '../tethysapp/fimsim_gui/public/frontend'),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        entryFileNames: 'main.js',
        chunkFileNames: 'chunks/[name].js',
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith('.css')) {
            return 'main.css';
          }
          return 'assets/[name][extname]';
        },
      },
    },
  },

  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },

  server: {
    proxy: {
      '/apps': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      // Family chrome images live in Tethys statics; proxy them so the banner
      // and logos render in `npm run dev` too (404s harmlessly if Tethys is down).
      '/static': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
}));
