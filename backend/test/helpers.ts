import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import { TripPlan, TripRole } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { AiProvider } from '../src/modules/ai/ai-provider';
import { AiWorkerService } from '../src/modules/ai/ai-worker.service';
import { AuthService } from '../src/modules/auth/auth.service';
import { MailSender } from '../src/modules/mail/mail.service';
import { StripeGateway } from '../src/modules/billing/stripe.gateway';
import { PrismaService } from '../src/prisma/prisma.service';
import { GeocodingProvider } from '../src/modules/locations/geocoding-provider';
import { LocationsService } from '../src/modules/locations/locations.service';
import { FakeAiProvider, FakeGeocodingProvider, FakeStripeGateway } from './fakes';

/** Esperas solicitadas pelo worker de IA entre tentativas (para asserções). */
export const aiWaits: number[] = [];

export interface TestContext {
  app: NestExpressApplication;
  prisma: PrismaService;
  stripe: FakeStripeGateway;
  ai: FakeAiProvider;
  geocoding: FakeGeocodingProvider;
  http: () => ReturnType<typeof request>;
}

export async function createTestApp(options: { mail?: MailSender } = {}): Promise<TestContext> {
  const stripe = new FakeStripeGateway();
  const ai = new FakeAiProvider();
  const geocoding = new FakeGeocodingProvider();
  let builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(GeocodingProvider)
    .useValue(geocoding)
    .overrideProvider(StripeGateway)
    .useValue(stripe)
    .overrideProvider(AiProvider)
    .useValue(ai);
  if (options.mail) builder = builder.overrideProvider(MailSender).useValue(options.mail);
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ rawBody: true, logger: false });
  configureApp(app);
  await app.listen(0); // uma única porta efêmera, reaproveitada por todas as requisições
  // Esperas entre novas tentativas da IA não atrasam os testes (os valores ficam registrados).
  const worker = app.get(AiWorkerService);
  worker.sleep = async (ms: number) => {
    aiWaits.push(ms);
  };
  return { app, prisma: app.get(PrismaService), stripe, ai, geocoding, http: () => request(app.getHttpServer()) };
}

/** Limpa o banco e os contadores de rate limit (em memória) entre testes. */
export async function resetDb(ctx: TestContext) {
  const throttle = ctx.app.get(ThrottlerStorage) as unknown as { storage: Map<string, unknown>; hitExpirations: Map<string, unknown> };
  throttle.storage.clear();
  throttle.hitExpirations.clear();
  // Cache e limites da busca de locais também são em memória.
  const locations = ctx.app.get(LocationsService) as unknown as Record<'cache' | 'inFlight' | 'userCalls', Map<string, unknown>>;
  locations.cache.clear();
  locations.inFlight.clear();
  locations.userCalls.clear();
  Object.assign(ctx.app.get(LocationsService).stats, { memory: 0, database: 0, provider: 0 });
  ctx.geocoding.reset();
  await ctx.prisma.$executeRawUnsafe(`
    TRUNCATE "PlaceSearchCache", "AiAttempt", "AiJob", "StripeWebhookEvent", "Order", "BillingCustomer", "ShareLink", "Invitation",
      "Activity", "TripDay", "TripMember", "Trip", "Session", "User" CASCADE`);
}

let userSeq = 0;

/** Cria usuário e devolve um access token (sem passar pelo rate limit do HTTP). */
export async function createUser(ctx: TestContext, name = 'Usuário') {
  const email = `user${++userSeq}-${Date.now()}@teste.dev`;
  const auth = ctx.app.get(AuthService);
  const issued = await auth.register({ name, email, password: 'senha-segura-123' }, {});
  return { id: issued.user.id, email, token: issued.accessToken, auth: { Authorization: `Bearer ${issued.accessToken}` } };
}

export type TestUser = Awaited<ReturnType<typeof createUser>>;

export async function createTrip(
  ctx: TestContext,
  owner: TestUser,
  overrides: Partial<{ startDate: string; endDate: string; plan: TripPlan }> = {},
) {
  const res = await ctx
    .http()
    .post('/api/v1/trips')
    .set(owner.auth)
    .send({
      name: 'Viagem de teste',
      destination: 'Lisboa',
      startDate: overrides.startDate ?? '2026-12-20',
      endDate: overrides.endDate ?? '2026-12-22',
      timeZone: 'Europe/Lisbon',
    })
    .expect(201);
  if (overrides.plan) await ctx.prisma.trip.update({ where: { id: res.body.id }, data: { plan: overrides.plan } });
  return res.body as { id: string; days: { id: string; date: string }[] };
}

export async function addMember(ctx: TestContext, tripId: string, user: TestUser, role: TripRole) {
  await ctx.prisma.tripMember.create({ data: { tripId, userId: user.id, role } });
}

export function activity(title: string, time: string, extra: Record<string, unknown> = {}) {
  return { title, time, ...extra };
}
