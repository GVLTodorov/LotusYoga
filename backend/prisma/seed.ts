// Dev seed data: `npm run seed`. Never run in production.
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { generateSessions } from '../src/services/sessions.js';
import { cardExpiry } from '../src/services/cards.js';
import { sofiaDate } from '../src/time.js';

const prisma = new PrismaClient();

async function user(email: string, name: string, role: 'ADMIN' | 'INSTRUCTOR' | 'CLIENT', password: string) {
  return prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, name, role, phone: '+359 888 000 000', passwordHash: await bcrypt.hash(password, 10) },
  });
}

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed production');
  await user('admin@studiobook.local', 'Администратор', 'ADMIN', 'Admin12345');
  const elena = await user('elena@studiobook.local', 'Елена', 'INSTRUCTOR', 'Instructor12345');
  const client = await user('client@studiobook.local', 'Ивана Петрова', 'CLIENT', 'Client12345');

  if ((await prisma.template.count()) === 0) {
    const today = sofiaDate(new Date());
    for (const [name, weekday, startTime] of [['Хатха йога', 2, '18:30'], ['Виняса флоу', 4, '19:00'], ['Сутрешна йога', 6, '09:30']] as const) {
      await prisma.template.create({ data: { name, instructorId: elena.id, weekday, startTime, durationMin: 75, capacity: 14, validFrom: today } });
    }
    await generateSessions(prisma, new Date());
  }
  if ((await prisma.card.count({ where: { userId: client.id } })) === 0) {
    const validFrom = sofiaDate(new Date());
    await prisma.card.create({
      data: { userId: client.id, type: 'PACK_8', totalClasses: 8, validFrom, expiresAt: cardExpiry(validFrom, 'PACK_8'), paymentMethod: 'CASH', priceBgn: 120 },
    });
  }
  console.log('Seed done: admin@studiobook.local / Admin12345, elena@studiobook.local / Instructor12345, client@studiobook.local / Client12345');
}

main().finally(() => prisma.$disconnect());
