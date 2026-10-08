/**
 * Seed de desenvolvimento (idempotente). Recria as viagens de exemplo a cada execução.
 *
 *   ana@boraali.dev    — proprietária (senha: boraali123)
 *   bruno@boraali.dev  — editor na viagem de Lisboa
 *   carla@boraali.dev  — visualizadora na viagem de Lisboa
 */
import { ActivityCategory, BillingProduct, OrderStatus, PrismaClient, TripPlan, TripRole } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

const PASSWORD = 'boraali123';
const LISBON_TRIP = '00000000-0000-4000-8000-000000000001';
const PARATY_TRIP = '00000000-0000-4000-8000-000000000002';

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const hm = (time: string) => {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
};

async function user(email: string, name: string, passwordHash: string) {
  return prisma.user.upsert({ where: { email }, update: { name }, create: { email, name, passwordHash } });
}

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Seed de desenvolvimento não roda em produção.');
  const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
  const ana = await user('ana@boraali.dev', 'Ana Souza', passwordHash);
  const bruno = await user('bruno@boraali.dev', 'Bruno Lima', passwordHash);
  const carla = await user('carla@boraali.dev', 'Carla Dias', passwordHash);

  await prisma.order.deleteMany({ where: { tripId: { in: [LISBON_TRIP, PARATY_TRIP] } } });
  await prisma.trip.deleteMany({ where: { id: { in: [LISBON_TRIP, PARATY_TRIP] } } });

  // ── Lisboa: PRO_AI, com colaboradores e link público ──
  await prisma.trip.create({
    data: {
      id: LISBON_TRIP,
      ownerId: ana.id,
      name: 'Férias em Lisboa',
      destination: 'Lisboa, Portugal',
      startDate: day('2026-12-20'),
      endDate: day('2026-12-23'),
      timeZone: 'Europe/Lisbon',
      stay: 'Hotel em Alfama',
      coverUrl: 'https://images.unsplash.com/photo-1585208798174-6cedd86e019a',
      plan: TripPlan.PRO_AI,
      members: {
        create: [
          { userId: ana.id, role: TripRole.OWNER },
          { userId: bruno.id, role: TripRole.EDITOR },
          { userId: carla.id, role: TripRole.VIEWER },
        ],
      },
      shareLink: { create: { token: 'seed-lisboa-link-publico-0001', enabled: true, showNotes: false } },
      // Pedido pago fictício (identificadores sem relação com o Stripe) para manter o plano coerente.
      orders: {
        create: {
          buyerId: ana.id,
          product: BillingProduct.PRO_AI,
          targetPlan: TripPlan.PRO_AI,
          amount: 1990,
          currency: 'brl',
          status: OrderStatus.PAID,
          stripePriceId: 'price_seed',
          paidAt: new Date(),
        },
      },
    },
  });

  const lisbonDays = ['2026-12-20', '2026-12-21', '2026-12-22', '2026-12-23'];
  const lisbonActivities: Record<string, [string, string, ActivityCategory, number | null, string | null][]> = {
    '2026-12-20': [
      ['14:00', 'Check-in no hotel', 'hospedagem', 30, 'Alfama'],
      ['16:00', 'Miradouro de Santa Luzia', 'passeio', 60, 'Largo Santa Luzia'],
      ['20:00', 'Jantar com fado', 'alimentacao', 120, 'Alfama'],
    ],
    '2026-12-21': [
      ['09:30', 'Pastéis de Belém', 'alimentacao', 30, 'R. de Belém 84'],
      ['10:00', 'Mosteiro dos Jerónimos', 'passeio', 90, 'Belém'],
      ['10:00', 'Comprar bilhete do elétrico 28', 'transporte', null, null],
      ['13:00', 'Almoço no LX Factory', 'alimentacao', 90, 'Alcântara'],
      ['15:30', 'Torre de Belém', 'passeio', 60, 'Belém'],
    ],
    '2026-12-22': [['11:00', 'Bate-volta a Sintra', 'passeio', 360, 'Sintra']],
    '2026-12-23': [],
  };

  for (const date of lisbonDays) {
    const created = await prisma.tripDay.create({ data: { tripId: LISBON_TRIP, date: day(date) } });
    const slots = new Map<number, number>();
    for (const [time, title, category, durationMinutes, location] of lisbonActivities[date]) {
      const startMinutes = hm(time);
      const position = slots.get(startMinutes) ?? 0;
      slots.set(startMinutes, position + 1);
      await prisma.activity.create({
        data: {
          tripId: LISBON_TRIP,
          dayId: created.id,
          title,
          startMinutes,
          category,
          durationMinutes,
          location,
          position,
          createdById: ana.id,
          updatedById: ana.id,
        },
      });
    }
  }

  // ── Paraty: FREE, só da Ana (1º dia no limite do plano) ──
  await prisma.trip.create({
    data: {
      id: PARATY_TRIP,
      ownerId: ana.id,
      name: 'Fim de semana em Paraty',
      destination: 'Paraty, RJ',
      startDate: day('2027-01-15'),
      endDate: day('2027-01-17'),
      timeZone: 'America/Sao_Paulo',
      members: { create: { userId: ana.id, role: TripRole.OWNER } },
      days: { create: ['2027-01-15', '2027-01-16', '2027-01-17'].map((d) => ({ date: day(d) })) },
    },
  });
  const firstParatyDay = await prisma.tripDay.findFirstOrThrow({ where: { tripId: PARATY_TRIP }, orderBy: { date: 'asc' } });
  await prisma.activity.createMany({
    data: [
      { title: 'Centro histórico', startMinutes: hm('10:00'), category: ActivityCategory.passeio, durationMinutes: 120 },
      { title: 'Almoço no centro', startMinutes: hm('12:30'), category: ActivityCategory.alimentacao, durationMinutes: 60 },
      { title: 'Passeio de escuna', startMinutes: hm('14:00'), category: ActivityCategory.passeio, durationMinutes: 240 },
      { title: 'Pôr do sol no cais', startMinutes: hm('18:30'), category: ActivityCategory.descanso, durationMinutes: 45 },
      { title: 'Jantar na Rua do Comércio', startMinutes: hm('20:00'), category: ActivityCategory.alimentacao, durationMinutes: 90 },
    ].map((a) => ({ ...a, tripId: PARATY_TRIP, dayId: firstParatyDay.id, createdById: ana.id })),
  });

  console.log(`Seed concluído. Usuários: ana@, bruno@, carla@boraali.dev — senha "${PASSWORD}".`);
  console.log('Link público de exemplo: /api/v1/public/trips/seed-lisboa-link-publico-0001');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
