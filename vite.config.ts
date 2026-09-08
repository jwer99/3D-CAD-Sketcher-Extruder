import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';
import { handleCommerce } from './server/commerce';
import { handleReconstruction } from './server/reconstruct';

export default defineConfig(({ mode }) => {
  const commerceEnv = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  return {
    plugins: [
      react(), 
      tailwindcss(),
      {
        name: 'api-reconstruction-middleware',
        configureServer(server) {
          server.middlewares.use('/api/commerce', (req, res) => handleCommerce(req, res, commerceEnv));
          server.middlewares.use('/api/convert-step', async (req: any, res: any) => {
            const { handleStepConversion } = await import('./server/step-converter.ts');
            await handleStepConversion(req, res);
          });
          server.middlewares.use('/api/export-step', async (req: any, res: any) => {
            const { handleStepExport } = await import('./server/step-converter.ts');
            await handleStepExport(req, res);
          });
          server.middlewares.use(async (req: any, res: any, next: any) => {
            const url = req.url || '';
            if (url.startsWith('/api/projects')) {
              const { handleProjectsApi } = await import('./server/project_storage.ts');
              const pathname = url.split('?')[0];
              await handleProjectsApi(req, res, pathname);
              return;
            }
            if (url.startsWith('/api/step-split')) {
              const { handleStepSplitterApi } = await import('./server/step_splitter_api.ts');
              const pathname = url.split('?')[0];
              await handleStepSplitterApi(req, res, pathname);
              return;
            }
            next();
          });
          server.middlewares.use('/api/reconstruct', (req: any, res: any) => {
            if (req.method !== 'POST') {
              res.writeHead(405, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Método no permitido. Use POST.' }));
              return;
            }

            let body = '';
            req.on('data', (chunk: any) => {
              body += chunk;
            });

            req.on('end', async () => {
              try {
                req.body = JSON.parse(body);
                await handleReconstruction(req, res);
              } catch (err: any) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Payload JSON inválido: ' + err.message }));
              }
            });
          });
        }
      }
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      rollupOptions: {
        input: {
          main: path.resolve(__dirname, 'index.html'),
          splitter: path.resolve(__dirname, 'splitter.html'),
        },
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
