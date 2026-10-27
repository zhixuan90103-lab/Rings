import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/** Dev-only. Writes public/levels/1.json … 5.json. */
function levelSavePlugin(): Plugin {
  return {
    name: 'level-save',
    configureServer(server) {
      server.middlewares.use('/__levels', (req, res, next) => {
        const match = req.url?.match(/^\/([1-5])\/?$/);
        if (!match || req.method !== 'PUT') {
          next();
          return;
        }
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
          try {
            const text = Buffer.concat(chunks).toString('utf8');
            JSON.parse(text);
            const file = path.resolve('public/levels', `${match[1]}.json`);
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, text);
            res.statusCode = 204;
            res.end();
          } catch (error) {
            res.statusCode = 400;
            res.end(error instanceof Error ? error.message : 'bad json');
          }
        });
      });
    },
  };
}

/**
 * base: './' is REQUIRED for Capacitor (capacitor:// / file:// asset loading).
 * Absolute /assets/... paths break inside the iOS WebView.
 */
export default defineConfig({
  base: './',
  plugins: [levelSavePlugin()],
  server: {
    host: true,
    port: 5190,
    strictPort: true,
  },
  preview: {
    host: true,
    port: 5190,
    strictPort: true,
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
  esbuild: {
    target: 'es2022',
  },
  optimizeDeps: {
    esbuildOptions: {
      target: 'es2022',
    },
  },
});
