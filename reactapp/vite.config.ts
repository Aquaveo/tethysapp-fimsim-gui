import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react-swc';
import path from 'path';
import fs from 'fs';

const DIRNAME = import.meta.dirname;

// In production, Tethys serves the app's public/ dir at /static/fimsim_gui/.
// This plugin does the same for `npm run dev`, so the family chrome (banners,
// logos) renders without a running Tethys. Registered via configureServer's
// direct use(), so it runs before Vite's proxy middleware.
function serveTethysStatics(): Plugin {
  const root = path.resolve(DIRNAME, '../tethysapp/fimsim_gui/public');
  const prefix = '/static/fimsim_gui/';
  const types: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.css': 'text/css',
    '.js': 'text/javascript',
  };
  return {
    name: 'serve-tethys-statics',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith(prefix)) return next();
        const rel = decodeURIComponent(req.url.slice(prefix.length).split('?')[0]);
        const file = path.normalize(path.join(root, rel));
        if (!file.startsWith(root) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
          return next();
        }
        res.setHeader('Content-Type', types[path.extname(file).toLowerCase()] ?? 'application/octet-stream');
        fs.createReadStream(file).pipe(res);
      });
    },
  };
}

export default defineConfig(({ mode }) => ({
  // BASE URL: dev = '/', production = Tethys app URL
  base: mode === 'production' ? '/apps/fimsim-gui/' : '/',

  plugins: [react(), serveTethysStatics()],

  build: {
    outDir: path.resolve(DIRNAME, '../tethysapp/fimsim_gui/public/frontend'),
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
      '@': path.resolve(DIRNAME, 'src'),
    },
  },

  server: {
    proxy: {
      '/apps': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      // Anything else under /static (portal-level assets) still goes to Tethys
      // when it's running; the app's own statics are served by the plugin above.
      '/static': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
}));
