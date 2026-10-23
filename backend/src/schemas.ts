import { z } from 'zod';
import { isValidDate } from './time.js';

export const email = z.string().trim().max(254).email();
export const password = z.string().min(8).max(128);
export const name = z.string().trim().min(1).max(100);
export const phone = z.string().trim().regex(/^[0-9+ ]{6,20}$/, 'phone must be 6-20 characters: digits, + or space');
export const lang = z.enum(['bg', 'en']);
export const role = z.enum(['CLIENT', 'INSTRUCTOR', 'ADMIN']);
export const dateStr = z.string().refine(isValidDate, 'must be a date YYYY-MM-DD');
export const timeStr = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must be HH:mm');
export const isoDate = z.string().refine((s) => !Number.isNaN(Date.parse(s)) && /^\d{4}-\d{2}-\d{2}T/.test(s), 'must be an ISO-8601 timestamp').transform((s) => new Date(s));
export const id = z.string().min(1).max(64);

export const registerBody = z.object({ email, password, name, phone, lang: lang.default('bg') });
export const loginBody = z.object({ email: z.string().min(1).max(254), password: z.string().min(1).max(128) });
export const patchMeBody = z.object({ name: name.optional(), phone: phone.optional(), lang: lang.optional() });
export const deleteMeBody = z.object({ password: z.string().min(1).max(128) });

export const sessionsQuery = z.object({ from: dateStr.optional(), to: dateStr.optional() });
export const bookingsQuery = z.object({ scope: z.enum(['upcoming', 'past']).default('upcoming') });
export const instructorSessionsQuery = z.object({ date: dateStr.optional() });
export const clientSearchQuery = z.object({ q: z.string().trim().min(2).max(100) });
export const attendanceBody = z.object({ status: z.enum(['ATTENDED', 'NO_SHOW']) });
export const walkInBody = z.object({ userId: id });

const templateFields = {
  name: z.string().trim().min(1).max(100),
  instructorId: id,
  weekday: z.number().int().min(1).max(7),
  startTime: timeStr,
  durationMin: z.number().int().min(15).max(240),
  capacity: z.number().int().min(1).max(50),
  validFrom: dateStr,
};
export const createTemplateBody = z.object({ ...templateFields, capacity: templateFields.capacity.default(14) });
export const patchTemplateBody = z.object(templateFields).partial().extend({ active: z.boolean().optional() });

export const createSessionBody = z.object({
  name: templateFields.name,
  instructorId: id,
  startsAt: isoDate,
  durationMin: templateFields.durationMin,
  capacity: templateFields.capacity,
});
export const patchSessionBody = z.object({
  name: templateFields.name.optional(),
  instructorId: id.optional(),
  startsAt: isoDate.optional(),
  durationMin: templateFields.durationMin.optional(),
  capacity: templateFields.capacity.optional(),
});
export const cancelSessionBody = z.object({ reason: z.string().trim().max(500).optional() });

export const adminUsersQuery = z.object({
  q: z.string().trim().max(100).optional(),
  role: role.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export const adminCreateUserBody = z.object({ email, password, name, phone, role, lang: lang.default('bg') });
export const adminPatchUserBody = z.object({
  name: name.optional(),
  phone: phone.optional(),
  role: role.optional(),
  lang: lang.optional(),
  blocked: z.boolean().optional(),
  password: password.optional(),
});
export const createCardBody = z.object({
  type: z.enum(['SINGLE', 'PACK_8', 'PACK_12', 'UNLIMITED_MONTH']),
  paymentMethod: z.enum(['CASH', 'BANK_TRANSFER']),
  priceBgn: z.number().min(0).max(100000).optional(),
  validFrom: dateStr.optional(),
});
export const patchCardBody = z.object({ expiresAt: dateStr, note: z.string().trim().max(500).optional() });
export const monthlyQuery = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'must be YYYY-MM') });
