import type { Context, Next } from 'hono';
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

function createSpaHandler(basePath: string) {
  const indexPath = `./public${basePath}/index.html`;
  return async (c: Context, next: Next) => {
    if (c.req.path.startsWith(`${basePath}/api/`)) return next();
    const staticHandler = serveStatic({ root: './public' });
    const res = await staticHandler(c, next);
    if (res) return res;
    return serveStatic({ path: indexPath })(c, next);
  };
}

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
app.get('/admin/*', createSpaHandler('/admin'));

app.get('/portal', serveStatic({ path: './public/portal/index.html' }));
app.get('/portal/*', createSpaHandler('/portal'));

app.notFound((c) => {
  return c.json({ error: 'Not Found' }, HTTP_STATUS.NOT_FOUND);
});

app.onError(errorHandler);

export { app };
