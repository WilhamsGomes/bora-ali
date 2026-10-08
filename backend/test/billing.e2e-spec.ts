import { ReconciliationService } from '../src/modules/billing/reconciliation.service';
import { signedEvent } from './fakes';
import { activity, addMember, createTestApp, createTrip, createUser, resetDb, TestContext, TestUser } from './helpers';

describe('Pagamentos (Stripe Checkout + webhooks)', () => {
  let ctx: TestContext;
  let owner: TestUser;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  beforeEach(async () => {
    await resetDb(ctx);
    owner = await createUser(ctx, 'Ana');
  });
  afterAll(() => ctx.app.close());

  const checkout = (tripId: string, plan: string, user = owner) =>
    ctx.http().post('/api/v1/billing/checkout').set(user.auth).send({ tripId, plan });

  const webhook = (type: string, object: { id: string }, eventId?: string) => {
    const evt = signedEvent(type, object, eventId);
    return ctx
      .http()
      .post('/api/v1/billing/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', evt.signature)
      .send(evt.payload);
  };

  const plan = async (tripId: string) => (await ctx.prisma.trip.findUniqueOrThrow({ where: { id: tripId } })).plan;

  async function paidCheckout(tripId: string, desired: string) {
    const res = await checkout(tripId, desired).expect(201);
    const sessionId = res.body.order && (await ctx.prisma.order.findUniqueOrThrow({ where: { id: res.body.order.id } })).stripeCheckoutSessionId!;
    ctx.stripe.pay(sessionId);
    await webhook('checkout.session.completed', { id: sessionId }).expect(200);
    return { orderId: res.body.order.id as string, sessionId };
  }

  describe('elegibilidade e preço decididos pelo servidor', () => {
    it('FREE → PRO cria pedido de R$9,90 e sessão com idempotency key e metadados', async () => {
      const trip = await createTrip(ctx, owner);
      const res = await checkout(trip.id, 'PRO').expect(201);
      expect(res.body.order).toMatchObject({ product: 'PRO', amount: 990, currency: 'BRL', status: 'OPEN', tripPlan: 'FREE' });
      expect(res.body.checkoutUrl).toMatch(/^https:\/\/checkout\.stripe\.test\//);

      const call = ctx.stripe.createCalls.at(-1)!;
      expect(call.idempotencyKey).toBe(`checkout:${res.body.order.id}`);
      expect(call.params).toMatchObject({
        mode: 'payment',
        client_reference_id: res.body.order.id,
        metadata: { orderId: res.body.order.id, tripId: trip.id, product: 'PRO' },
        line_items: [{ price: 'price_pro', quantity: 1 }],
      });
      expect(await plan(trip.id)).toBe('FREE'); // nada liberado antes do pagamento
    });

    it('FREE → PRO_AI direto custa R$19,90', async () => {
      const trip = await createTrip(ctx, owner);
      const res = await checkout(trip.id, 'PRO_AI').expect(201);
      expect(res.body.order).toMatchObject({ product: 'PRO_AI', amount: 1990 });
    });

    it('PRO → PRO_AI vira upgrade de R$10,00; PRO → PRO e PRO_AI → PRO são recusados', async () => {
      const trip = await createTrip(ctx, owner, { plan: 'PRO' });
      const same = await checkout(trip.id, 'PRO').expect(409);
      expect(same.body.code).toBe('PLAN_ALREADY_ACTIVE');
      const up = await checkout(trip.id, 'PRO_AI').expect(201);
      expect(up.body.order).toMatchObject({ product: 'UPGRADE_PRO_AI', amount: 1000, targetPlan: 'PRO_AI' });

      const top = await createTrip(ctx, owner, { plan: 'PRO_AI' });
      const down = await checkout(top.id, 'PRO').expect(422);
      expect(down.body.code).toBe('PLAN_NOT_ELIGIBLE');
      expect((await checkout(top.id, 'PRO_AI').expect(409)).body.code).toBe('PLAN_ALREADY_ACTIVE');
    });

    it('somente o proprietário compra; o cliente não escolhe valor', async () => {
      const trip = await createTrip(ctx, owner, { plan: 'PRO' });
      const editor = await createUser(ctx, 'Bruno');
      await addMember(ctx, trip.id, editor, 'EDITOR');
      await checkout(trip.id, 'PRO_AI', editor).expect(403);
      await ctx
        .http()
        .post('/api/v1/billing/checkout')
        .set(owner.auth)
        .send({ tripId: trip.id, plan: 'PRO_AI', amount: 1 })
        .expect(400);
    });
  });

  describe('compras duplicadas', () => {
    it('reaproveita a sessão aberta do mesmo produto e evita pedidos paralelos', async () => {
      const trip = await createTrip(ctx, owner);
      const results = await Promise.all([0, 1, 2, 3].map(() => checkout(trip.id, 'PRO')));
      const ok = results.filter((r) => r.status === 201);
      expect(ok.length).toBeGreaterThanOrEqual(1);
      results.filter((r) => r.status !== 201).forEach((r) => expect(r.body.code).toBe('PAYMENT_PENDING'));
      expect(await ctx.prisma.order.count({ where: { status: { in: ['CREATED', 'OPEN'] } } })).toBe(1);

      const again = await checkout(trip.id, 'PRO').expect(201);
      expect(again.body.reused).toBe(true);
      expect(again.body.order.id).toBe(ok[0].body.order.id);
    });

    it('trocar de produto expira a sessão anterior', async () => {
      const trip = await createTrip(ctx, owner);
      const first = await checkout(trip.id, 'PRO').expect(201);
      const second = await checkout(trip.id, 'PRO_AI').expect(201);
      expect(second.body.order.id).not.toBe(first.body.order.id);
      const old = await ctx.prisma.order.findUniqueOrThrow({ where: { id: first.body.order.id } });
      expect(old.status).toBe('EXPIRED');
      expect(ctx.stripe.sessions.get(old.stripeCheckoutSessionId!)!.status).toBe('expired');
    });

    it('não troca de produto se a sessão anterior já foi paga', async () => {
      const trip = await createTrip(ctx, owner);
      const first = await checkout(trip.id, 'PRO').expect(201);
      const order = await ctx.prisma.order.findUniqueOrThrow({ where: { id: first.body.order.id } });
      ctx.stripe.pay(order.stripeCheckoutSessionId!); // pago, mas webhook ainda não chegou
      const res = await checkout(trip.id, 'PRO_AI').expect(409);
      expect(res.body.code).toBe('PAYMENT_PENDING');
      expect(await plan(trip.id)).toBe('PRO');
    });
  });

  describe('webhooks', () => {
    it('recusa assinatura inválida', async () => {
      const evt = signedEvent('checkout.session.completed', { id: 'cs_x' });
      const res = await ctx
        .http()
        .post('/api/v1/billing/webhooks/stripe')
        .set('Content-Type', 'application/json')
        .set('Stripe-Signature', evt.signature)
        .send(evt.payload.replace('cs_x', 'cs_y'))
        .expect(400);
      expect(res.body.code).toBe('WEBHOOK_SIGNATURE_INVALID');
    });

    it('libera somente após pagamento confirmado; o redirect não libera', async () => {
      const trip = await createTrip(ctx, owner);
      const res = await checkout(trip.id, 'PRO').expect(201);
      // Usuário volta do Checkout sem pagar: consulta do pedido não libera nada.
      const polled = await ctx.http().get(`/api/v1/billing/orders/${res.body.order.id}`).set(owner.auth).expect(200);
      expect(polled.body).toMatchObject({ status: 'OPEN', tripPlan: 'FREE' });

      const sessionId = (await ctx.prisma.order.findUniqueOrThrow({ where: { id: res.body.order.id } })).stripeCheckoutSessionId!;
      ctx.stripe.pay(sessionId);
      const hook = await webhook('checkout.session.completed', { id: sessionId }).expect(200);
      expect(hook.body).toMatchObject({ received: true, outcome: 'paid' });
      expect(await plan(trip.id)).toBe('PRO');

      const order = await ctx.http().get(`/api/v1/billing/orders/${res.body.order.id}`).set(owner.auth).expect(200);
      expect(order.body).toMatchObject({ status: 'PAID', tripPlan: 'PRO', checkoutUrl: null });
    });

    it('é idempotente com eventos repetidos e entregas concorrentes', async () => {
      const trip = await createTrip(ctx, owner);
      const res = await checkout(trip.id, 'PRO').expect(201);
      const sessionId = (await ctx.prisma.order.findUniqueOrThrow({ where: { id: res.body.order.id } })).stripeCheckoutSessionId!;
      ctx.stripe.pay(sessionId);

      const evt = signedEvent('checkout.session.completed', { id: sessionId }, 'evt_repetido');
      const send = () =>
        ctx
          .http()
          .post('/api/v1/billing/webhooks/stripe')
          .set('Content-Type', 'application/json')
          .set('Stripe-Signature', evt.signature)
          .send(evt.payload);
      const concurrent = await Promise.all([send(), send(), send()]);
      concurrent.forEach((r) => expect(r.status).toBe(200));
      const replay = await send().expect(200);
      expect(replay.body.duplicate).toBe(true);

      // Mesmo pagamento notificado por outro evento (async_payment_succeeded) também não duplica nada.
      await webhook('checkout.session.async_payment_succeeded', { id: sessionId }).expect(200);

      expect(await plan(trip.id)).toBe('PRO');
      expect(await ctx.prisma.order.count({ where: { status: 'PAID' } })).toBe(1);
      const record = await ctx.prisma.stripeWebhookEvent.findUniqueOrThrow({ where: { id: 'evt_repetido' } });
      expect(record).toMatchObject({ status: 'PROCESSED', attempts: 4 });
    });

    it('tolera eventos fora de ordem (expired depois de completed)', async () => {
      const trip = await createTrip(ctx, owner);
      const { orderId, sessionId } = await paidCheckout(trip.id, 'PRO');
      await webhook('checkout.session.expired', { id: sessionId }).expect(200);
      const order = await ctx.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
      expect(order.status).toBe('PAID');
      expect(await plan(trip.id)).toBe('PRO');
    });

    it('não libera quando valor ou moeda não conferem com o pedido', async () => {
      const trip = await createTrip(ctx, owner);
      const res = await checkout(trip.id, 'PRO_AI').expect(201);
      const sessionId = (await ctx.prisma.order.findUniqueOrThrow({ where: { id: res.body.order.id } })).stripeCheckoutSessionId!;
      ctx.stripe.pay(sessionId, { amountTotal: 990 });
      const hook = await webhook('checkout.session.completed', { id: sessionId }).expect(200);
      expect(hook.body.outcome).toBe('rejected');
      expect(await plan(trip.id)).toBe('FREE');
      const order = await ctx.prisma.order.findUniqueOrThrow({ where: { id: res.body.order.id } });
      expect(order).toMatchObject({ requiresReview: true, failureReason: 'validation_mismatch:amount' });
    });

    it('checkout expirado libera nova compra', async () => {
      const trip = await createTrip(ctx, owner);
      const res = await checkout(trip.id, 'PRO').expect(201);
      const sessionId = (await ctx.prisma.order.findUniqueOrThrow({ where: { id: res.body.order.id } })).stripeCheckoutSessionId!;
      await ctx.stripe.expireCheckoutSession(sessionId);
      await webhook('checkout.session.expired', { id: sessionId }).expect(200);
      expect((await ctx.prisma.order.findUniqueOrThrow({ where: { id: res.body.order.id } })).status).toBe('EXPIRED');
      const next = await checkout(trip.id, 'PRO').expect(201);
      expect(next.body.reused).toBe(false);
    });

    it('pagamento assíncrono: PROCESSING até confirmar; falha não libera', async () => {
      const trip = await createTrip(ctx, owner);
      const res = await checkout(trip.id, 'PRO').expect(201);
      const sessionId = (await ctx.prisma.order.findUniqueOrThrow({ where: { id: res.body.order.id } })).stripeCheckoutSessionId!;
      ctx.stripe.pay(sessionId, { async: true });
      await webhook('checkout.session.completed', { id: sessionId }).expect(200);
      expect((await ctx.prisma.order.findUniqueOrThrow({ where: { id: res.body.order.id } })).status).toBe('PROCESSING');
      expect(await plan(trip.id)).toBe('FREE');
      expect((await checkout(trip.id, 'PRO_AI').expect(409)).body.code).toBe('PAYMENT_PENDING');

      ctx.stripe.settleAsync(sessionId, true);
      await webhook('checkout.session.async_payment_succeeded', { id: sessionId }).expect(200);
      expect(await plan(trip.id)).toBe('PRO');

      const other = await createTrip(ctx, owner);
      const r2 = await checkout(other.id, 'PRO').expect(201);
      const s2 = (await ctx.prisma.order.findUniqueOrThrow({ where: { id: r2.body.order.id } })).stripeCheckoutSessionId!;
      ctx.stripe.pay(s2, { async: true });
      await webhook('checkout.session.completed', { id: s2 }).expect(200);
      ctx.stripe.settleAsync(s2, false);
      await webhook('checkout.session.async_payment_failed', { id: s2 }).expect(200);
      expect((await ctx.prisma.order.findUniqueOrThrow({ where: { id: r2.body.order.id } })).status).toBe('FAILED');
      expect(await plan(other.id)).toBe('FREE');
    });

    it('upgrade aplica PRO_AI sem rebaixar e sem duplicar', async () => {
      const trip = await createTrip(ctx, owner);
      await paidCheckout(trip.id, 'PRO');
      await paidCheckout(trip.id, 'PRO_AI');
      expect(await plan(trip.id)).toBe('PRO_AI');
      const orders = await ctx.prisma.order.findMany({ where: { tripId: trip.id, status: 'PAID' } });
      expect(orders.map((o) => o.product).sort()).toEqual(['PRO', 'UPGRADE_PRO_AI']);
    });
  });

  describe('reembolso e disputa', () => {
    it('reembolso total reverte o plano sem apagar atividades; FREE bloqueia novas adições no dia cheio', async () => {
      const trip = await createTrip(ctx, owner);
      const { sessionId } = await paidCheckout(trip.id, 'PRO');
      const day = trip.days[0].id;
      for (const t of ['08:00', '09:00', '10:00', '11:00', '12:00']) {
        await ctx.http().post(`/api/v1/trips/${trip.id}/days/${day}/activities`).set(owner.auth).send(activity(t, t)).expect(201);
      }

      const chargeId = ctx.stripe.refund(sessionId, true);
      const res = await webhook('charge.refunded', { id: chargeId }).expect(200);
      expect(res.body.outcome).toBe('refunded');
      expect(await plan(trip.id)).toBe('FREE');
      expect(await ctx.prisma.activity.count({ where: { dayId: day } })).toBe(5);
      await ctx
        .http()
        .post(`/api/v1/trips/${trip.id}/days/${day}/activities`)
        .set(owner.auth)
        .send(activity('nova', '18:00'))
        .expect(403);

      // Evento repetido/atrasado de pagamento não reaplica um pedido reembolsado.
      await webhook('checkout.session.completed', { id: sessionId }).expect(200);
      expect(await plan(trip.id)).toBe('FREE');
    });

    it('reembolso do PRO após upgrade derruba também o upgrade', async () => {
      const trip = await createTrip(ctx, owner);
      const pro = await paidCheckout(trip.id, 'PRO');
      await paidCheckout(trip.id, 'PRO_AI');
      await webhook('charge.refunded', { id: ctx.stripe.refund(pro.sessionId) }).expect(200);
      expect(await plan(trip.id)).toBe('FREE');
    });

    it('reembolso parcial mantém o benefício', async () => {
      const trip = await createTrip(ctx, owner);
      const { sessionId } = await paidCheckout(trip.id, 'PRO');
      await webhook('charge.refunded', { id: ctx.stripe.refund(sessionId, false) }).expect(200);
      expect(await plan(trip.id)).toBe('PRO');
    });

    it('disputa suspende; disputa ganha restaura', async () => {
      const trip = await createTrip(ctx, owner);
      const { sessionId } = await paidCheckout(trip.id, 'PRO_AI');
      const disputeId = ctx.stripe.dispute(sessionId, 'needs_response');
      await webhook('charge.dispute.created', { id: disputeId }).expect(200);
      expect(await plan(trip.id)).toBe('FREE');

      ctx.stripe.dispute(sessionId, 'won');
      await webhook('charge.dispute.closed', { id: disputeId }).expect(200);
      expect(await plan(trip.id)).toBe('PRO_AI');
    });
  });

  describe('reconciliação', () => {
    it('confirma pedidos pagos cujo webhook não chegou e marca pedidos interrompidos', async () => {
      const trip = await createTrip(ctx, owner);
      const res = await checkout(trip.id, 'PRO').expect(201);
      const order = await ctx.prisma.order.findUniqueOrThrow({ where: { id: res.body.order.id } });
      ctx.stripe.pay(order.stripeCheckoutSessionId!);
      // Simula pedido aberto há muito tempo sem notícia.
      await ctx.prisma.$executeRaw`UPDATE "Order" SET "updatedAt" = now() - interval '1 hour' WHERE id = ${order.id}::uuid`;

      const other = await createTrip(ctx, owner);
      const stale = await ctx.prisma.order.create({
        data: {
          tripId: other.id,
          buyerId: owner.id,
          product: 'PRO',
          targetPlan: 'PRO',
          amount: 990,
          currency: 'brl',
          stripePriceId: 'price_pro',
          createdAt: new Date(Date.now() - 3_600_000),
        },
      });

      const result = await ctx.app.get(ReconciliationService).reconcile();
      expect(result).toMatchObject({ checked: 1, interrupted: 1 });
      expect(await plan(trip.id)).toBe('PRO');
      expect((await ctx.prisma.order.findUniqueOrThrow({ where: { id: stale.id } })).status).toBe('FAILED');
    });
  });
});
