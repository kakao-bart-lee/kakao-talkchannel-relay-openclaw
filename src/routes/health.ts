import { Hono } from 'hono';
import { HTTP_STATUS } from '@/config/constants';
import { checkDatabaseConnection } from '@/db';

export const healthRoutes = new Hono();

healthRoutes.get('/', async (c) => {
  const dbConnected = await checkDatabaseConnection();

  const response = {
    status: dbConnected ? 'healthy' : 'unhealthy',
    checks: {
      database: dbConnected ? 'ok' : 'error',
    },
    timestamp: new Date().toISOString(),
  };

  const statusCode = dbConnected ? HTTP_STATUS.OK : HTTP_STATUS.SERVICE_UNAVAILABLE;

  return c.json(response, statusCode);
});
