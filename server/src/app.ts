import express from 'express';
import helmet from 'helmet';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { adminRouter } from './admin/routes.js';
import { authRouter } from './auth/routes.js';
import { itemsRouter } from './items/routes.js';
import { prisma } from './lib/db.js';
import { loadEnv } from './lib/env.js';
import { sendError, sendSuccess } from './lib/envelope.js';
import { notificationsRouter } from './notifications/routes.js';
import { getOutboxHealth } from './outbox/process-batch.js';

export function createApp() {
  const env = loadEnv();
  const app = express();

  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(express.json({ limit: '100kb' }));

  app.get('/health', async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      const outbox = await getOutboxHealth();
      sendSuccess(res, {
        status: outbox.status,
        db: 'ok',
        outbox,
      });
    } catch {
      res.status(503).json({
        success: false,
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Database unavailable',
        },
      });
    }
  });

  app.use('/api/v1', authRouter);
  app.use('/api/v1', itemsRouter);
  app.use('/api/v1', notificationsRouter);
  app.use('/api/v1', adminRouter);

  app.get('/api/v1/health', async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      const outbox = await getOutboxHealth();
      sendSuccess(res, { status: outbox.status, db: 'ok', outbox });
    } catch (err) {
      sendError(res, err);
    }
  });

  const webDist = env.WEB_DIST ?? path.resolve(process.cwd(), '../web/dist');
  if (existsSync(webDist)) {
    app.use(express.static(webDist));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) {
        next();
        return;
      }
      res.sendFile(path.join(webDist, 'index.html'));
    });
  }

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    sendError(res, err);
  });

  return app;
}
