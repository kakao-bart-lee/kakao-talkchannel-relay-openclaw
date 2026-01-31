import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { HTTP_STATUS } from '@/config/constants';
import { errorHandler, requestLogger } from '@/middleware/error-handler';
import { healthRoutes } from '@/routes/health';
import { kakaoRoutes } from '@/routes/kakao';
import { openclawRoutes } from '@/routes/openclaw';

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

app.notFound((c) => {
  return c.json({ error: 'Not Found' }, HTTP_STATUS.NOT_FOUND);
});

app.onError(errorHandler);

export { app };
