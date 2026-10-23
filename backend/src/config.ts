export interface Config {
  nodeEnv: string;
  isProd: boolean;
  port: number;
  host: string;
  databaseUrl: string;
  jwtSecret: string;
  corsOrigin: string[];
  appUrl: string;
  uiUrl: string;
  smtp: { host: string | null; port: number; user: string | null; password: string | null; secure: boolean };
  mailFrom: string;
  staticDir: string | null;
  adminEmail: string | null;
  adminPassword: string | null;
  jobsEnabled: boolean;
  trustProxy: boolean;
  rateLimitMax: number;
}

const bool = (v: string | undefined, def: boolean) => (v === undefined || v === '' ? def : v.toLowerCase() === 'true');
const opt = (v: string | undefined) => (v && v.trim() !== '' ? v : null);

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const nodeEnv = env.NODE_ENV ?? 'development';
  const isProd = nodeEnv === 'production';
  const missing: string[] = [];
  const databaseUrl = opt(env.DATABASE_URL);
  if (!databaseUrl) missing.push('DATABASE_URL');
  const jwtSecret = opt(env.JWT_SECRET);
  if (!jwtSecret) missing.push('JWT_SECRET'); // never has a fallback, in any environment
  const smtpHost = opt(env.SMTP_HOST);
  if (isProd && !smtpHost) missing.push('SMTP_HOST');
  if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  if (jwtSecret!.length < 16) throw new Error('JWT_SECRET must be at least 16 characters');

  const port = Number(env.PORT ?? 5080);
  return {
    nodeEnv,
    isProd,
    port,
    host: env.HOST ?? '127.0.0.1',
    databaseUrl: databaseUrl!,
    jwtSecret: jwtSecret!,
    corsOrigin: (env.CORS_ORIGIN ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    appUrl: env.APP_URL ?? `http://localhost:${port}`,
    uiUrl: env.UI_URL ?? 'http://localhost:5173',
    smtp: {
      host: smtpHost,
      port: Number(env.SMTP_PORT ?? 1025),
      user: opt(env.SMTP_USER),
      password: opt(env.SMTP_PASSWORD),
      secure: bool(env.SMTP_SECURE, false),
    },
    mailFrom: env.MAIL_FROM ?? 'StudioBook <no-reply@studiobook.local>',
    staticDir: opt(env.STATIC_DIR),
    adminEmail: opt(env.ADMIN_EMAIL),
    adminPassword: opt(env.ADMIN_PASSWORD),
    jobsEnabled: bool(env.JOBS_ENABLED, nodeEnv !== 'test'),
    trustProxy: bool(env.TRUST_PROXY, false),
    rateLimitMax: Number(env.AUTH_RATE_LIMIT_MAX ?? 10),
  };
}
