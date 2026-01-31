import type { Context, Next } from 'hono';
import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { HTTP_STATUS } from '@/config/constants';
import { errorHandler, requestLogger } from '@/middleware/error-handler';
import { adminRoutes } from '@/routes/admin';
import { healthRoutes } from '@/routes/health';
import { kakaoRoutes } from '@/routes/kakao';
import { openclawRoutes } from '@/routes/openclaw';
import { portalRoutes } from '@/routes/portal';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function createSpaHandler(basePath: string) {
  const indexFile = Bun.file(`./public${basePath}/index.html`);

  return async (c: Context, next: Next) => {
    if (c.req.path.startsWith(`${basePath}/api/`)) return next();

    const filePath = `./public${c.req.path}`;
    const file = Bun.file(filePath);

    if (await file.exists()) {
      const ext = filePath.substring(filePath.lastIndexOf('.'));
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      return new Response(file, { headers: { 'Content-Type': contentType } });
    }

    return new Response(indexFile, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
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

app.get('/admin', (c) => c.redirect('/admin/', 301));
app.get('/admin/*', createSpaHandler('/admin'));

app.get('/portal', (c) => c.redirect('/portal/', 301));
app.get('/portal/*', createSpaHandler('/portal'));

app.notFound((c) => {
  return c.json({ error: 'Not Found' }, HTTP_STATUS.NOT_FOUND);
});

app.onError(errorHandler);

export { app };
