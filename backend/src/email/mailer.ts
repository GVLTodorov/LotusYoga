import nodemailer from 'nodemailer';
import type { Config } from '../config.js';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  send(msg: MailMessage): Promise<void>;
}

/** SMTP mailer; without SMTP_HOST (dev/test only) messages are rendered but not delivered. */
export function createMailer(config: Config): Mailer {
  const transport = config.smtp.host
    ? nodemailer.createTransport({
        host: config.smtp.host,
        port: config.smtp.port,
        secure: config.smtp.secure,
        auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.password ?? '' } : undefined,
      })
    : nodemailer.createTransport({ jsonTransport: true });
  return {
    async send(msg) {
      await transport.sendMail({ from: config.mailFrom, ...msg });
    },
  };
}
