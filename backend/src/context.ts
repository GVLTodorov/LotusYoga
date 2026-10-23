import type { Prisma, PrismaClient } from '@prisma/client';
import type { Config } from './config.js';
import type { Mailer } from './email/mailer.js';

export type Tx = Prisma.TransactionClient;
export type Db = PrismaClient | Tx;

export interface Logger {
  info(obj: object | string, msg?: string): void;
  warn(obj: object | string, msg?: string): void;
  error(obj: object | string, msg?: string): void;
}

export interface Ctx {
  prisma: PrismaClient;
  config: Config;
  /** Injectable clock (tests move time). */
  now: () => Date;
  mailer: Mailer;
  log: Logger;
}

export interface AuthUser {
  id: string;
  role: 'CLIENT' | 'INSTRUCTOR' | 'ADMIN';
  name: string;
  blocked: boolean;
}
