import express from 'express';
import apiRouter from '../server/routes/api.ts';

const app = express();

app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'healthy',
    app: 'Fabriq Multi-Tenant SaaS',
    database: 'Cloud Firestore (ai-studio-laundryosmultite-80576504-c141-4d16-a217-226de2b938ed)',
    version: '1.1.0-firestore',
    environment: process.env.NODE_ENV || 'production',
    platform: 'vercel',
    timestamp: new Date().toISOString(),
  });
});

app.use('/api', apiRouter);

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'API endpoint not found', code: 'NOT_FOUND' });
});

export default app;
