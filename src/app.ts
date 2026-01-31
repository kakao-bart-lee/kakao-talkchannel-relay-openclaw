import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import { secureHeaders } from 'hono/secure-headers';
import { HTTP_STATUS } from '@/config/constants';
import { errorHandler, requestLogger } from '@/middleware/error-handler';
import { adminRoutes } from '@/routes/admin';
import { healthRoutes } from '@/routes/health';
import { kakaoRoutes } from '@/routes/kakao';
import { openclawRoutes } from '@/routes/openclaw';
import { portalRoutes } from '@/routes/portal';

const app = new Hono();

app.use(
  '*',
  secureHeaders({
    xFrameOptions: 'DENY',
    xContentTypeOptions: 'nosniff',
    referrerPolicy: 'strict-origin-when-cross-origin',
    strictTransportSecurity: 'max-age=31536000; includeSubDomains',
  })
);
app.use('*', requestLogger());

app.route('/health', healthRoutes);
app.route('/kakao', kakaoRoutes);
app.route('/openclaw', openclawRoutes);
app.route('/admin', adminRoutes);
app.route('/portal', portalRoutes);

app.get('/admin', serveStatic({ path: './public/admin/index.html' }));
app.get('/admin/*', async (c, next) => {
  if (c.req.path.startsWith('/admin/api/')) return next();
  const staticHandler = serveStatic({ root: './public' });
  const res = await staticHandler(c, next);
  if (res) return res;
  return serveStatic({ path: './public/admin/index.html' })(c, next);
});

app.get('/portal', serveStatic({ path: './public/portal/index.html' }));
app.get('/portal/*', async (c, next) => {
  if (c.req.path.startsWith('/portal/api/')) return next();
  const staticHandler = serveStatic({ root: './public' });
  const res = await staticHandler(c, next);
  if (res) return res;
  return serveStatic({ path: './public/portal/index.html' })(c, next);
});

app.notFound((c) => {
  return c.json({ error: 'Not Found' }, HTTP_STATUS.NOT_FOUND);
});

app.onError(errorHandler);

export { app };
