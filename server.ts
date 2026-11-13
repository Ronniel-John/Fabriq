/**
 * LaundryOS - Full-Stack Express Server with Vite Middleware
 */

import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import apiRouter from './server/routes/api.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = process.env.PORT || 3000;
  const isProd = process.env.NODE_ENV === 'production';

  // Standard middleware (2mb limit supports QR code image uploads)
  app.use(express.json({ limit: '2mb' }));

  // Mount API endpoints
  app.use('/api', apiRouter);

  // Health check endpoint
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'healthy',
      app: 'LaundryOS Multi-Tenant SaaS',
      database: 'Cloud Firestore (ai-studio-laundryosmultite-80576504-c141-4d16-a217-226de2b938ed)',
      version: '1.1.0-firestore',
      environment: process.env.NODE_ENV || 'development',
      timestamp: new Date().toISOString(),
    });
  });

  if (!isProd) {
    // Development mode: Vite middleware
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // Production mode: Serve built static files
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, () => {
    console.log(`LaundryOS Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start LaundryOS server:', err);
  process.exit(1);
});
