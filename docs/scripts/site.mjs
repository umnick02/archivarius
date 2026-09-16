import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { root, input } from './framework.mjs';

// Serve the local viewer against this repository's built library and the
// documentation model. Bind to loopback only.
export async function createDocumentationServer() {
  const viewer = fileURLToPath(new URL('./viewer/', import.meta.url));
  const dist = path.join(root, 'dist');
  return createServer({
    configFile: false,
    root: viewer,
    publicDir: false,
    cacheDir: path.join(root, 'node_modules/.vite-docs'),
    appType: 'mpa',
    resolve: {
      alias: [
        { find: /^archivarius$/, replacement: path.join(dist, 'src/index.js') },
        {
          find: 'archivarius/style.css',
          replacement: path.join(dist, 'style.css'),
        },
      ],
      dedupe: ['react', 'react-dom'],
    },
    server: {
      host: '127.0.0.1',
      port: 4174,
      strictPort: true,
      fs: { allow: [viewer, dist, path.join(root, 'node_modules')] },
    },
    plugins: [
      {
        name: 'archivarius-documentation',
        configureServer(server) {
          return () => {
            server.middlewares.use(async (request, response, next) => {
              if (request.url?.split('?')[0] !== '/project.json') return next();
              response.setHeader('Cache-Control', 'no-store');
              response.setHeader(
                'Content-Type',
                'application/json; charset=utf-8',
              );
              if (!['GET', 'HEAD'].includes(request.method)) {
                response.statusCode = 405;
                response.setHeader('Allow', 'GET, HEAD');
                response.end();
                return;
              }
              response.end(
                request.method === 'HEAD'
                  ? undefined
                  : await readFile(input, 'utf8'),
              );
            });
          };
        },
      },
    ],
  });
}
