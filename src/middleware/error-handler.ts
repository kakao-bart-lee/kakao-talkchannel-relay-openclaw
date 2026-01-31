import type { ErrorHandler, MiddlewareHandler } from 'hono';
import { ZodError } from 'zod';
import { HTTP_STATUS } from '@/config/constants';
import { ServiceError } from '@/errors/service.error';
import { logger } from '@/utils/logger';

export const errorHandler: ErrorHandler = (err, c) => {
  if (err instanceof ServiceError) {
    logger.warn('Service error', {
      code: err.code,
      message: err.message,
      context: err.context,
    });

    return c.json(
      {
        error: err.message,
        code: err.code,
      },
      err.statusCode as 400 | 401 | 403 | 404 | 500
    );
  }

  if (err instanceof ZodError) {
    logger.warn('Validation error', {
      errors: err.issues,
    });

    return c.json(
      {
        error: 'Validation failed',
        details: err.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      },
      HTTP_STATUS.BAD_REQUEST
    );
  }

  logger.error('Unexpected error', {
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
    name: err instanceof Error ? err.name : 'Unknown',
  });

  const message =
    process.env.NODE_ENV === 'production'
      ? 'Internal server error'
      : err instanceof Error
        ? err.message
        : String(err);

  return c.json({ error: message }, HTTP_STATUS.INTERNAL_ERROR);
};

export function requestLogger(): MiddlewareHandler {
  return async (c, next) => {
    const start = Date.now();

    await next();

    const elapsed = Date.now() - start;
    logger.info('Request completed', {
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      elapsed,
    });
  };
}
