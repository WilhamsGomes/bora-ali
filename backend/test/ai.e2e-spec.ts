import { AiProviderError } from '../src/modules/ai/ai-provider';
import { AiWorkerService } from '../src/modules/ai/ai-worker.service';
import { AiBudgetExhaustedError, AiCostService } from '../src/modules/entitlements/ai-cost.service';
import {
  activity,
  addMember,
  aiWaits,
  createTestApp,
  createTrip,
  createUser,
  resetDb,
  TestContext,
  TestUser,
} from './helpers';

// Preços do claude-sonnet-5-5 (catálogo padrão): US$ 2 / MTok entrada, US$ 10 / MTok saída.
// FAKE_USAGE = 1000 entrada + 500 saída → 1000*2 + 500*10 = 7000 micro-USD.
const FAKE_CALL_COST = 7_000;

describe('IA (reserva de uso, custo e trabalhos assíncronos)', () => {
  let ctx: TestContext;
  let worker: AiWorkerService;
  let cost: AiCostService;
  let owner: TestUser;

  beforeAll(async () => {
    ctx = await createTestApp();
    worker = ctx.app.get(AiWorkerService);
    cost = ctx.app.get(AiCostService);
  });
  beforeEach(async () => {
    await resetDb(ctx);
    ctx.ai.reset();
    aiWaits.length = 0;
    owner = await createUser(ctx, 'Ana');
  });
  afterAll(() => ctx.app.close());

  const daySuggestions = (tripId: string, dayId: string, user = owner, key?: string, extra: object = {}) => {
    const req = ctx.http().post(`/api/v1/trips/${tripId}/ai/day-suggestions`).set(user.auth);
    if (key) req.set('Idempotency-Key', key);
    return req.send({ dayId, pace: 'tranquilo', interests: ['museus'], ...extra });
  };
  const usage = async (tripId: string) =>
    (await ctx.http().get(`/api/v1/trips/${tripId}/ai/usage`).set(owner.auth).expect(200)).body;
  const job = async (tripId: string, jobId: string) =>
    (await ctx.http().get(`/api/v1/trips/${tripId}/ai/jobs/${jobId}`).set(owner.auth).expect(200)).body;
  const drain = async () => {
    while (await worker.processNext()) {
      /* processa a fila */
    }
  };
  const attempts = (jobId: string) =>
    ctx.prisma.aiAttempt.findMany({ where: { jobId }, orderBy: [{ callIndex: 'asc' }, { attemptNumber: 'asc' }] });
  /** Simula gasto anterior registrado (sem expor nada ao usuário). */
  const spend = async (tripId: string, micros: number) => {
    const j = await ctx.prisma.aiJob.create({
      data: { tripId, requestedById: owner.id, kind: 'DAY_SUGGESTIONS', idempotencyKey: `spent-${micros}-${Math.random()}`, input: {}, status: 'FAILED' },
    });
    await ctx.prisma.aiAttempt.create({
      data: {
        jobId: j.id,
        tripId,
        callIndex: 0,
        attemptNumber: 1,
        provider: 'anthropic',
        requestedModel: 'claude-sonnet-5-5',
        status: 'SUCCEEDED',
        reservedCostMicros: micros,
        costMicros: micros,
        costStatus: 'ESTIMATED',
        currency: 'USD',
        pricingReferenceDate: '2026-10-07',
      },
    });
  };

  describe('permissões e fluxo básico', () => {
    it('exige PRO_AI e papel OWNER/EDITOR', async () => {
      const pro = await createTrip(ctx, owner, { plan: 'PRO' });
      const res = await daySuggestions(pro.id, pro.days[0].id).expect(403);
      expect(res.body).toMatchObject({ code: 'TRIP_UPGRADE_REQUIRED', details: { feature: 'ai' } });

      const trip = await createTrip(ctx, owner, { plan: 'PRO_AI' });
      const viewer = await createUser(ctx, 'Carla');
      const editor = await createUser(ctx, 'Bruno');
      await addMember(ctx, trip.id, viewer, 'VIEWER');
      await addMember(ctx, trip.id, editor, 'EDITOR');
      expect((await daySuggestions(trip.id, trip.days[0].id, viewer).expect(403)).body.code).toBe('FORBIDDEN');
      await daySuggestions(trip.id, trip.days[0].id, editor).expect(202);
    });

    it('reserva, processa e consome somente após sucesso, sem alterar o roteiro', async () => {
      const trip = await createTrip(ctx, owner, { plan: 'PRO_AI' });
      const day = trip.days[0].id;
      await ctx.http().post(`/api/v1/trips/${trip.id}/days/${day}/activities`).set(owner.auth).send(activity('Já marcado', '10:00')).expect(201);

      const before = await usage(trip.id);
      expect(before).toMatchObject({ enabled: true, available: true, canRequest: true });
      expect(before.usage.DAY_SUGGESTIONS).toEqual({ limit: 2, used: 0, reserved: 0, remaining: 2 });

      const created = await daySuggestions(trip.id, day).expect(202);
      expect(created.body).toMatchObject({ status: 'QUEUED', kind: 'DAY_SUGGESTIONS', result: null });
      expect((await usage(trip.id)).usage.DAY_SUGGESTIONS).toMatchObject({ used: 0, reserved: 1, remaining: 1 });

      await drain();
      const done = await job(trip.id, created.body.id);
      expect(done.status).toBe('SUCCEEDED');
      expect(done.usage).toMatchObject({ provider: 'fake', model: 'claude-sonnet-5-5', inputTokens: 1000, outputTokens: 500, attempts: 1 });
      const suggestions = done.result.suggestions as { dayId: string; time: string; verification: { status: string } }[];
      expect(suggestions.length).toBeGreaterThan(0);
      suggestions.forEach((s) => {
        expect(s.dayId).toBe(day);
        expect(s.verification.status).toBe('UNVERIFIED');
      });
      expect((await usage(trip.id)).usage.DAY_SUGGESTIONS).toMatchObject({ used: 1, reserved: 0, remaining: 1 });
      expect(await ctx.prisma.activity.count({ where: { tripId: trip.id } })).toBe(1); // nada aplicado

      // A chamada usou o modelo configurado e ficou registrada com custo estimado.
      expect(ctx.ai.calls).toEqual([{ model: 'claude-sonnet-5-5', maxOutputTokens: 1000, effort: 'medium' }]);
      const [a] = await attempts(created.body.id);
      expect(a).toMatchObject({
        status: 'SUCCEEDED',
        provider: 'fake',
        requestedModel: 'claude-sonnet-5-5',
        model: 'claude-sonnet-5-5',
        costStatus: 'ESTIMATED',
        costMicros: FAKE_CALL_COST,
        currency: 'USD',
        pricingReferenceDate: '2026-10-07',
      });
      expect(a.reservedCostMicros).toBeGreaterThan(FAKE_CALL_COST);
      expect(a.durationMs).toEqual(expect.any(Number));
    });
  });

  describe('recusa', () => {
    it('é resultado explícito: sem nova tentativa, sem troca de modelo, cota liberada e custo registrado', async () => {
      const trip = await createTrip(ctx, owner, { plan: 'PRO_AI' });
      ctx.ai.script = [{ kind: 'refuse', category: 'general_harms' }];
      const created = await daySuggestions(trip.id, trip.days[0].id).expect(202);
      await drain();

      const failed = await job(trip.id, created.body.id);
      expect(failed.status).toBe('FAILED');
      expect(failed.error.code).toBe('AI_REQUEST_REFUSED');
      expect(failed.error.message).toMatch(/não pôde atender/);
      expect(failed.result).toBeNull();

      expect(ctx.ai.calls).toHaveLength(1);
      expect(ctx.ai.calls[0].model).toBe('claude-sonnet-5-5');
      expect(aiWaits).toEqual([]);
      expect((await usage(trip.id)).usage.DAY_SUGGESTIONS).toMatchObject({ used: 0, reserved: 0, remaining: 2 });

      const [a] = await attempts(created.body.id);
      expect(a).toMatchObject({ status: 'REFUSED', refusalCategory: 'general_harms', costStatus: 'ESTIMATED', costMicros: FAKE_CALL_COST });
    });
  });

  describe('novas tentativas', () => {
    it('repete só erros transitórios, com backoff e retry-after, consumindo uma utilização', async () => {
      const trip = await createTrip(ctx, owner, { plan: 'PRO_AI' });
      ctx.ai.script = [
        { kind: 'error', error: new AiProviderError('AI_PROVIDER_ERROR', 'overloaded', true, { httpStatus: 529 }) },
        { kind: 'error', error: new AiProviderError('AI_RATE_LIMITED', 'rate', true, { httpStatus: 429, retryAfterMs: 2_000 }) },
        { kind: 'success' },
      ];
      const created = await daySuggestions(trip.id, trip.days[0].id).expect(202);
      await drain();

      expect((await job(trip.id, created.body.id)).status).toBe('SUCCEEDED');
      expect(ctx.ai.calls.map((c) => c.model)).toEqual(['claude-sonnet-5-5', 'claude-sonnet-5-5', 'claude-sonnet-5-5']);
      expect(aiWaits).toHaveLength(2);
      expect(aiWaits[0]).toBeGreaterThanOrEqual(1_000); // backoff base
      expect(aiWaits[1]).toBe(2_000); // retry-after respeitado

      const list = await attempts(created.body.id);
      expect(list.map((a) => [a.attemptNumber, a.status, a.costStatus])).toEqual([
        [1, 'TRANSIENT_ERROR', 'UNKNOWN'],
        [2, 'TRANSIENT_ERROR', 'UNKNOWN'],
        [3, 'SUCCEEDED', 'ESTIMATED'],
      ]);
      expect(list[0].errorCode).toBe('AI_PROVIDER_ERROR:529');
      expect((await usage(trip.id)).usage.DAY_SUGGESTIONS).toMatchObject({ used: 1, reserved: 0 });
    });

    it('esgotadas as tentativas, falha, libera a cota e preserva o custo (desconhecido conta a reserva)', async () => {
      const trip = await createTrip(ctx, owner, { plan: 'PRO_AI' });
      const transient = () => ({ kind: 'error' as const, error: new AiProviderError('AI_TIMEOUT', 't', true) });
      ctx.ai.script = [transient(), transient(), transient(), transient()];
      const created = await daySuggestions(trip.id, trip.days[0].id).expect(202);
      await drain();

      const failed = await job(trip.id, created.body.id);
      expect(failed).toMatchObject({ status: 'FAILED', error: { code: 'AI_TIMEOUT' } });
      expect(ctx.ai.calls).toHaveLength(3); // 1 + AI_MAX_RETRIES (2)
      expect((await usage(trip.id)).usage.DAY_SUGGESTIONS).toMatchObject({ used: 0, reserved: 0, remaining: 2 });

      const list = await attempts(created.body.id);
      expect(list.every((a) => a.costStatus === 'UNKNOWN' && a.costMicros === null)).toBe(true);
      const reserved = list.reduce((n, a) => n + a.reservedCostMicros, 0);
      expect(await cost.spentMicros(trip.id)).toBe(reserved); // falha não significa custo zero
    });

    it('não repete erros definitivos nem esperas acima do limite', async () => {
      const trip = await createTrip(ctx, owner, { plan: 'PRO_AI' });
      // Limite de gasto mensal do provedor (429 sem retry-after): não transitório.
      ctx.ai.script = [{ kind: 'error', error: new AiProviderError('AI_RATE_LIMITED', 'spend cap', false, { httpStatus: 429 }) }];
      const a = await daySuggestions(trip.id, trip.days[0].id).expect(202);
      await drain();
      expect((await job(trip.id, a.body.id)).error.code).toBe('AI_RATE_LIMITED');
      expect(ctx.ai.calls).toHaveLength(1);

      ctx.ai.reset();
      ctx.ai.script = [{ kind: 'error', error: new AiProviderError('AI_RATE_LIMITED', 'rate', true, { retryAfterMs: 60_000 }) }];
      const b = await daySuggestions(trip.id, trip.days[1].id).expect(202);
      await drain();
      expect((await job(trip.id, b.body.id)).status).toBe('FAILED');
      expect(ctx.ai.calls).toHaveLength(1);
      expect(aiWaits).toEqual([]);
    });

    it('saída truncada ou inválida não é repetida e mantém o custo estimado', async () => {
      const trip = await createTrip(ctx, owner, { plan: 'PRO_AI' });
      ctx.ai.script = [{ kind: 'truncated', usage: { outputTokens: 1000 } }];
      const created = await daySuggestions(trip.id, trip.days[0].id).expect(202);
      await drain();
      expect((await job(trip.id, created.body.id)).error.code).toBe('AI_OUTPUT_TRUNCATED');
      expect(ctx.ai.calls).toHaveLength(1);
      const [a] = await attempts(created.body.id);
      expect(a).toMatchObject({ status: 'TRUNCATED', costStatus: 'ESTIMATED', costMicros: 1000 * 2 + 1000 * 10 });
    });

    it('modelo efetivo sem preço conhecido fica com custo desconhecido, não zero', async () => {
      const trip = await createTrip(ctx, owner, { plan: 'PRO_AI' });
      ctx.ai.script = [{ kind: 'success', model: 'claude-modelo-desconhecido' }];
      const created = await daySuggestions(trip.id, trip.days[0].id).expect(202);
      await drain();
      const [a] = await attempts(created.body.id);
      expect(a).toMatchObject({ model: 'claude-modelo-desconhecido', costStatus: 'UNKNOWN', costMicros: null });
    });
  });

  describe('idempotência e concorrência', () => {
    it('mesma Idempotency-Key devolve o mesmo trabalho; chave reaproveitada com outro pedido é recusada', async () => {
      const trip = await createTrip(ctx, owner, { plan: 'PRO_AI' });
      const first = await daySuggestions(trip.id, trip.days[0].id, owner, 'chave-1').expect(202);
      const again = await daySuggestions(trip.id, trip.days[0].id, owner, 'chave-1').expect(200);
      expect(again.body.id).toBe(first.body.id);
      expect((await usage(trip.id)).usage.DAY_SUGGESTIONS.reserved).toBe(1);
      const reused = await daySuggestions(trip.id, trip.days[1].id, owner, 'chave-1').expect(422);
      expect(reused.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
    });

    it('solicitações concorrentes geram uma única reserva', async () => {
      const trip = await createTrip(ctx, owner, { plan: 'PRO_AI' });
      const results = await Promise.all([0, 1, 2, 3, 4].map((i) => daySuggestions(trip.id, trip.days[0].id, owner, `k${i}`)));
      expect(results.filter((r) => r.status === 202)).toHaveLength(1);
      results.filter((r) => r.status !== 202).forEach((r) => expect(r.body.code).toBe('AI_JOB_IN_PROGRESS'));
      expect(await ctx.prisma.aiJob.count()).toBe(1);
    });
  });

  describe('limites funcionais e de tamanho', () => {
    it('bloqueia ao atingir o limite da viagem (compartilhado entre colaboradores)', async () => {
      const trip = await createTrip(ctx, owner, { plan: 'PRO_AI' });
      const editor = await createUser(ctx, 'Bruno');
      await addMember(ctx, trip.id, editor, 'EDITOR');
      await daySuggestions(trip.id, trip.days[0].id, owner).expect(202);
      await drain();
      await daySuggestions(trip.id, trip.days[1].id, editor).expect(202);
      await drain();
      const res = await daySuggestions(trip.id, trip.days[2].id, editor).expect(403);
      expect(res.body).toMatchObject({ code: 'AI_USAGE_LIMIT_REACHED', details: { limit: 2, used: 2, remaining: 0 } });
    });

    it('limita tamanho do pedido e quantidade de dias por geração', async () => {
      const trip = await createTrip(ctx, owner, { plan: 'PRO_AI', startDate: '2026-12-01', endDate: '2026-12-08' });
      const big = await daySuggestions(trip.id, trip.days[0].id, owner, undefined, { prompt: 'x'.repeat(101) }).expect(422);
      expect(big.body).toMatchObject({ code: 'AI_REQUEST_TOO_LARGE', details: { maxChars: 100 } });

      const tooMany = await ctx.http().post(`/api/v1/trips/${trip.id}/ai/trip-suggestions`).set(owner.auth).send({}).expect(422);
      expect(tooMany.body).toMatchObject({ code: 'AI_TOO_MANY_DAYS', details: { maxDays: 5, requestedDays: 8 } });
      const adjust = await ctx.http().post(`/api/v1/trips/${trip.id}/ai/adjustments`).set(owner.auth).send({ instruction: 'x' }).expect(422);
      expect(adjust.body.code).toBe('AI_TOO_MANY_DAYS');

      // Com seleção de dias dentro do limite: 3 dias em blocos de 2 → 2 chamadas, 1 utilização.
      const dayIds = trip.days.slice(0, 3).map((d) => d.id);
      const ok = await ctx.http().post(`/api/v1/trips/${trip.id}/ai/trip-suggestions`).set(owner.auth).send({ dayIds, pace: 'intenso' }).expect(202);
      await drain();
      const done = await job(trip.id, ok.body.id);
      expect(done.status).toBe('SUCCEEDED');
      expect(ctx.ai.calls).toHaveLength(2);
      const perDay = new Map<string, number>();
      for (const s of done.result.suggestions as { dayId: string }[]) perDay.set(s.dayId, (perDay.get(s.dayId) ?? 0) + 1);
      expect([...perDay.keys()].sort()).toEqual([...dayIds].sort());
      expect(Math.max(...perDay.values())).toBeLessThanOrEqual(2); // AI_MAX_SUGGESTIONS_PER_DAY
      expect((await usage(trip.id)).usage.TRIP_SUGGESTIONS).toMatchObject({ used: 1 });
    });
  });

  describe('orçamento interno por viagem', () => {
    it('bloqueia novas gerações quando o orçamento acaba, sem expor valores', async () => {
      const trip = await createTrip(ctx, owner, { plan: 'PRO_AI' });
      await spend(trip.id, 490_000); // orçamento de teste: 0.50 USD
      const status = await usage(trip.id);
      expect(status).toMatchObject({ available: false, unavailableReason: 'AI_BUDGET_EXHAUSTED', canRequest: false });
      expect(JSON.stringify(status)).not.toMatch(/micros|USD|cost|spent|0\.5/i); // nenhum valor ou moeda exposto

      const res = await daySuggestions(trip.id, trip.days[0].id).expect(403);
      expect(res.body.code).toBe('AI_BUDGET_EXHAUSTED');
      expect(res.body.details).toBeUndefined();
      expect(await ctx.prisma.aiJob.count({ where: { tripId: trip.id, status: 'QUEUED' } })).toBe(0);
    });

    it('esgotar o orçamento durante o trabalho falha sem chamar o provedor e libera a cota', async () => {
      const trip = await createTrip(ctx, owner, { plan: 'PRO_AI' });
      const created = await daySuggestions(trip.id, trip.days[0].id).expect(202);
      await spend(trip.id, 495_000); // gasto concorrente entre a solicitação e o processamento
      await drain();
      const failed = await job(trip.id, created.body.id);
      expect(failed.error.code).toBe('AI_BUDGET_EXHAUSTED');
      expect(ctx.ai.calls).toHaveLength(0);
      expect((await usage(trip.id)).usage.DAY_SUGGESTIONS).toMatchObject({ used: 0, reserved: 0 });
    });

    it('reservas concorrentes nunca ultrapassam o orçamento', async () => {
      const trip = await createTrip(ctx, owner, { plan: 'PRO_AI' });
      const j = await daySuggestions(trip.id, trip.days[0].id).expect(202);
      const reservation = 100_000;
      await spend(trip.id, 500_000 - reservation - 1); // cabe exatamente uma reserva
      const results = await Promise.allSettled(
        [1, 2, 3, 4, 5].map((n) =>
          cost.reserveAttempt({
            jobId: j.body.id,
            tripId: trip.id,
            callIndex: 0,
            attemptNumber: n,
            provider: 'fake',
            model: 'claude-sonnet-5-5',
            reservedCostMicros: reservation,
          }),
        ),
      );
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      results
        .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
        .forEach((r) => expect(r.reason).toBeInstanceOf(AiBudgetExhaustedError));
      expect(await cost.spentMicros(trip.id)).toBeLessThanOrEqual(500_000);
    });
  });

  it('gera a viagem inteira e propõe ajustes com versões de base', async () => {
    const trip = await createTrip(ctx, owner, { plan: 'PRO_AI' });
    const created = await ctx
      .http()
      .post(`/api/v1/trips/${trip.id}/days/${trip.days[1].id}/activities`)
      .set(owner.auth)
      .send(activity('Museu', '10:00', { durationMinutes: 90 }))
      .expect(201);

    const full = await ctx.http().post(`/api/v1/trips/${trip.id}/ai/trip-suggestions`).set(owner.auth).send({ pace: 'tranquilo' }).expect(202);
    await drain();
    const fullDone = await job(trip.id, full.body.id);
    const dates = new Set((fullDone.result.suggestions as { date: string }[]).map((s) => s.date));
    expect([...dates].sort()).toEqual(trip.days.map((d) => d.date));

    const adj = await ctx.http().post(`/api/v1/trips/${trip.id}/ai/adjustments`).set(owner.auth).send({ instruction: 'Comece mais tarde' }).expect(202);
    await drain();
    const adjDone = await job(trip.id, adj.body.id);
    const update = adjDone.result.changes.find((c: { type: string }) => c.type === 'update');
    expect(update).toMatchObject({ activityId: created.body.activity.id, baseVersion: 1 });
    await ctx
      .http()
      .patch(`/api/v1/trips/${trip.id}/activities/${update.activityId}`)
      .set(owner.auth)
      .send({ version: update.baseVersion, time: update.activity.time })
      .expect(200);
  });

  it('recupera trabalhos abandonados e marca a chamada em andamento como custo desconhecido', async () => {
    const trip = await createTrip(ctx, owner, { plan: 'PRO_AI' });
    const created = await daySuggestions(trip.id, trip.days[0].id).expect(202);
    await ctx.prisma.aiJob.update({
      where: { id: created.body.id },
      data: { status: 'RUNNING', attempts: 2, lockedUntil: new Date(Date.now() - 1000) },
    });
    const pending = await cost.reserveAttempt({
      jobId: created.body.id,
      tripId: trip.id,
      callIndex: 0,
      attemptNumber: 1,
      provider: 'fake',
      model: 'claude-sonnet-5-5',
      reservedCostMicros: 20_000,
    });
    await worker.recoverAbandoned();
    expect(await ctx.prisma.aiJob.findUniqueOrThrow({ where: { id: created.body.id } })).toMatchObject({
      status: 'FAILED',
      errorCode: 'AI_WORKER_TIMEOUT',
    });
    expect(await ctx.prisma.aiAttempt.findUniqueOrThrow({ where: { id: pending.id } })).toMatchObject({
      status: 'ABANDONED',
      costStatus: 'UNKNOWN',
    });
    expect(await cost.spentMicros(trip.id)).toBe(20_000);
    expect((await usage(trip.id)).usage.DAY_SUGGESTIONS.reserved).toBe(0);
  });
});
