import { expect } from '@playwright/test';
import { MAILPIT_URL } from './api';

export interface MailSummary { ID: string; Subject: string; Snippet: string; To: { Address: string }[] }

export async function mailsTo(address: string): Promise<MailSummary[]> {
  const r = await fetch(`${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${address}`)}&limit=50`);
  if (!r.ok) throw new Error(`mailpit search ${r.status}`);
  const j = (await r.json()) as { messages?: MailSummary[] };
  return j.messages ?? [];
}

export async function mailBody(id: string): Promise<{ Subject: string; Text: string; HTML: string }> {
  const r = await fetch(`${MAILPIT_URL}/api/v1/message/${id}`);
  return (await r.json()) as { Subject: string; Text: string; HTML: string };
}

/** Polls Mailpit (the outbox worker runs every 30 s). Returns the first mail matching `subject`. */
export async function waitForMail(address: string, subject?: RegExp, timeoutMs = 90_000) {
  let found: MailSummary | undefined;
  await expect
    .poll(async () => {
      const all = await mailsTo(address);
      found = all.find((m) => !subject || subject.test(m.Subject));
      return !!found;
    }, { timeout: timeoutMs, intervals: [1000, 2000, 3000] })
    .toBe(true);
  const body = await mailBody(found!.ID);
  return { ...found!, Text: body.Text, HTML: body.HTML };
}

/** Asserts no mail with the subject arrives for the given address after the outbox had time to run once. */
export async function expectNoMail(address: string, subject?: RegExp) {
  const all = await mailsTo(address);
  expect(all.filter((m) => !subject || subject.test(m.Subject))).toHaveLength(0);
}
