import fs from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { ZodError } from 'zod';
import type { Config } from './config.js';
import type { Ctx } from './context.js';
import { AppError } from './errors.js';
import { buildOpenApi } from './openapi.js';
import { swaggerTopBar } from './swagger-topbar.js';
import { adminRoutes } from './routes/admin.js';
import { authRoutes } from './routes/auth.js';
import { clientRoutes } from './routes/client.js';
import { instructorRoutes } from './routes/instructor.js';

const errorBody = (code: string, message: string, details?: unknown) => ({ error: { code, message, ...(details ? { details } : {}) } });

export async function buildApp(ctx: Ctx, opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const { config } = ctx;
  const app = Fastify({
    logger: opts.logger
      ? { level: 'info', redact: ['req.headers.authorization', 'req.headers.cookie'] }
      : false,
    trustProxy: config.trustProxy,
    bodyLimit: 100 * 1024,
  });

  // JSON bodies: an empty body is fine (endpoints without a body); malformed JSON is a validation error.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    const text = String(body);
    if (text.trim() === '') return done(null, undefined);
    try {
      done(null, JSON.parse(text));
    } catch {
      done(new AppError(400, 'VALIDATION_ERROR', 'Malformed JSON body'), undefined);
    }
  });

  app.setErrorHandler((err: Error & { statusCode?: number; code?: string }, req, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.status).send(errorBody(err.code, err.message, err.details));
    }
    if (err instanceof ZodError) {
      return reply.status(400).send(errorBody('VALIDATION_ERROR', 'Invalid input', err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))));
    }
    if (err.statusCode === 429) return reply.status(429).send(errorBody('RATE_LIMITED', 'Too many attempts, please try again later'));
    if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
      return reply.status(err.statusCode).send(errorBody(err.statusCode === 413 ? 'VALIDATION_ERROR' : err.statusCode === 404 ? 'NOT_FOUND' : 'VALIDATION_ERROR', err.message));
    }
    req.log.error({ err: { message: err.message, stack: err.stack } }, 'unhandled error');
    return reply.status(500).send(errorBody('INTERNAL_ERROR', 'Internal server error'));
  });

  if (config.corsOrigin.length) await app.register(cors, { origin: config.corsOrigin, methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'] });
  await app.register(jwt, { secret: config.jwtSecret, sign: { expiresIn: '30d' } });
  await app.register(rateLimit, {
    global: false,
    errorResponseBuilder: () => new AppError(429, 'RATE_LIMITED', 'Too many attempts, please try again later'),
  });

  app.get('/health', async () => ({ status: 'ok' }));

  // API
  await app.register(
    async (api) => {
      authRoutes(api, ctx);
      clientRoutes(api, ctx);
      instructorRoutes(api, ctx);
      adminRoutes(api, ctx);
      api.setNotFoundHandler((_req, reply) => reply.status(404).send(errorBody('NOT_FOUND', 'Not found')));
    },
    { prefix: '/api' },
  );

  // Swagger UI at /swagger, raw spec at /swagger.json
  const spec = buildOpenApi();
  await app.register(swagger, { mode: 'static', specification: { document: spec as never } });
  const topBar = swaggerTopBar([['UI', config.uiUrl]]);
  await app.register(swaggerUi, {
    routePrefix: '/swagger',
    uiConfig: { persistAuthorization: true, docExpansion: 'list' },
  });
  // Inline the top-bar buttons (style + script from .claude/templates/swagger-topbar.js) into the Swagger UI page.
  app.addHook('onSend', async (req, reply, payload) => {
    const type = String(reply.getHeader('content-type') ?? '');
    if (typeof payload !== 'string' || !type.includes('text/html') || !req.url.startsWith('/swagger') || !payload.includes('</body>')) return payload;
    return payload
      .replace('</head>', () => `<style>${topBar.customCss}</style></head>`)
      .replace('</body>', () => `<script>${topBar.customJsStr}</script></body>`);
  });
  app.get('/swagger.json', { schema: { hide: true } }, async () => spec);

  // Built UI (production image) with SPA fallback
  const staticDir = config.staticDir && fs.existsSync(path.join(config.staticDir, 'index.html')) ? path.resolve(config.staticDir) : null;
  if (staticDir) {
    await app.register(fastifyStatic, { root: staticDir, wildcard: false, index: ['index.html'] });
    app.get('/*', async (req, reply) => {
      const p = req.url.split('?')[0];
      if (p.startsWith('/api/') || p === '/api' || p.startsWith('/swagger')) return reply.status(404).send(errorBody('NOT_FOUND', 'Not found'));
      const file = path.join(staticDir, p);
      if (file.startsWith(staticDir + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()) return reply.sendFile(p.slice(1));
      return reply.type('text/html').sendFile('index.html');
    });
  }
  app.setNotFoundHandler((_req, reply) => reply.status(404).send(errorBody('NOT_FOUND', 'Not found')));

  return app;
}

export type { Config };
