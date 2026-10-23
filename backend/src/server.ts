import { PrismaClient } from '@prisma/client';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import type { Ctx } from './context.js';
import { createMailer } from './email/mailer.js';
import { ensureInitialAdmin } from './services/accounts.js';
import { startJobs } from './services/jobs.js';

// Dev / test: values come from the committed .env.<NODE_ENV> (npm run dev loads it via --env-file).
// Production: everything comes from the host environment; there are no fallbacks for secrets.
async function main() {
  const config = loadConfig(); // throws (and stops startup) when JWT_SECRET / DATABASE_URL / prod SMTP_HOST are missing
  const prisma = new PrismaClient({ datasources: { db: { url: config.databaseUrl } } });
  const log = {
    info: (o: object | string, m?: string) => app.log.info(o, m),
    warn: (o: object | string, m?: string) => app.log.warn(o, m),
    error: (o: object | string, m?: string) => app.log.error(o, m),
  };
  const ctx: Ctx = { prisma, config, now: () => new Date(), mailer: createMailer(config), log };
  const app = await buildApp(ctx, { logger: true });

  if (await ensureInitialAdmin(ctx)) app.log.info('initial admin created');
  const stopJobs = config.jobsEnabled ? startJobs(ctx) : () => undefined;

  const shutdown = async () => {
    stopJobs();
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  await app.listen({ port: config.port, host: config.host });
  console.log(`Listening on http://localhost:${config.port}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
