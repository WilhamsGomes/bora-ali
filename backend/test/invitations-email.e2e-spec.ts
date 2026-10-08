import { Logger } from '@nestjs/common';
import { AuthService } from '../src/modules/auth/auth.service';
import { UnconfiguredMailSender } from '../src/modules/mail/mail.service';
import { ResendMailSender } from '../src/modules/mail/resend.mail-sender';
import { FakeResendClient } from './fakes';
import { createTestApp, createTrip, createUser, resetDb, TestContext, TestUser } from './helpers';

describe('Convites por e-mail (Resend simulado)', () => {
  let ctx: TestContext;
  let owner: TestUser;
  const resend = new FakeResendClient();
  const sender = new ResendMailSender(resend, { from: 'BoraAli <convites@teste.dev>', maxRetries: 2, sleep: async () => {} });

  beforeAll(async () => {
    ctx = await createTestApp({ mail: sender });
  });
  beforeEach(async () => {
    await resetDb(ctx);
    resend.reset();
    owner = await createUser(ctx, 'Ana <b>Souza</b>');
  });
  afterAll(() => ctx.app.close());

  const invite = (tripId: string, email = 'convidada@teste.dev') =>
    ctx.http().post(`/api/v1/trips/${tripId}/invitations`).set(owner.auth).send({ email, role: 'EDITOR' });
  const resendInvite = (tripId: string, id: string) =>
    ctx.http().post(`/api/v1/trips/${tripId}/invitations/${id}/resend`).set(owner.auth);
  const tokenFrom = (text: string) => decodeURIComponent(/convites\/([^\s"<]+)/.exec(text)![1]);
  /** Libera o intervalo mínimo entre envios. */
  const age = (id: string) =>
    ctx.prisma.invitation.update({ where: { id }, data: { lastSendRequestedAt: new Date(Date.now() - 3_600_000) } });

  async function proTrip(name = 'Lisboa <script>alert(1)</script> & "amigos"') {
    const trip = await createTrip(ctx, owner, { plan: 'PRO' });
    await ctx.prisma.trip.update({ where: { id: trip.id }, data: { name } });
    return trip;
  }

  it('envia template em português (HTML escapado + texto) com chave de idempotência', async () => {
    const trip = await proTrip();
    const res = await invite(trip.id).expect(201);
    expect(res.body.status).toBe('PENDING');
    expect(res.body.delivery).toMatchObject({ status: 'PROVIDER_ACCEPTED', provider: 'resend', sends: 1, errorCode: null });
    expect(res.body.delivery.providerAcceptedAt).toEqual(expect.any(String));
    expect(JSON.stringify(res.body)).not.toMatch(/convites\//); // o token não volta na API

    expect(resend.calls).toHaveLength(1);
    const { payload, options } = resend.calls[0];
    expect(options).toEqual({ idempotencyKey: `invitation/${res.body.id}/send-1` });
    expect(payload).toMatchObject({ from: 'BoraAli <convites@teste.dev>', to: ['convidada@teste.dev'] });
    const html = payload.html as string;
    const text = payload.text as string;
    // Conteúdo de usuários escapado no HTML.
    expect(html).toContain('Lisboa &lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;amigos&quot;');
    expect(html).toContain('Ana &lt;b&gt;Souza&lt;/b&gt;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('Aceitar convite');
    expect(html).toContain('editar o roteiro');
    expect(text).toMatch(/vale até .+ \(horário de Brasília\)/);
    expect(payload.subject).toContain('convidou você para a viagem');

    // O link usa FRONTEND_URL e o token; o mesmo token aparece no HTML e no texto, e aceita o convite.
    const token = tokenFrom(text);
    expect(text).toContain(`http://localhost:3000/convites/${encodeURIComponent(token)}`);
    expect(tokenFrom(html)).toBe(token);
    const stored = await ctx.prisma.invitation.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(stored).toMatchObject({ providerMessageId: 'email_1', deliveryAttempts: 1 });
    expect(stored.tokenHash).not.toContain(token);

    const guest = await ctx.app.get(AuthService).register({ name: 'C', email: 'convidada@teste.dev', password: 'senha-segura-123' }, {});
    await ctx.http().post('/api/v1/invitations/accept').set({ Authorization: `Bearer ${guest.accessToken}` }).send({ token }).expect(200);
  });

  it('falha de envio mantém o convite; reenvio reaproveita a chave e o link, sem duplicar', async () => {
    const trip = await proTrip('Paraty');
    const fail = { kind: 'error' as const, name: 'application_error', statusCode: 500 };
    resend.script = [fail, fail, fail]; // tentativa + 2 novas tentativas automáticas
    const res = await invite(trip.id).expect(201);
    expect(res.body.delivery).toMatchObject({ status: 'FAILED', errorCode: 'retryable:application_error' });
    expect(resend.calls).toHaveLength(3);
    expect(new Set(resend.calls.map((c) => c.options?.idempotencyKey))).toEqual(new Set([`invitation/${res.body.id}/send-1`]));
    const firstToken = tokenFrom(resend.calls[0].payload.text as string);

    // Limite de frequência entre envios.
    const tooSoon = await resendInvite(trip.id, res.body.id).expect(429);
    expect(tooSoon.body).toMatchObject({ code: 'INVITATION_RESEND_LIMITED', details: { retryAfterSeconds: expect.any(Number) } });

    await age(res.body.id);
    const ok = await resendInvite(trip.id, res.body.id).expect(200);
    expect(ok.body.id).toBe(res.body.id);
    expect(ok.body.delivery).toMatchObject({ status: 'PROVIDER_ACCEPTED', sends: 1 });
    expect(resend.calls.at(-1)!.options?.idempotencyKey).toBe(`invitation/${res.body.id}/send-1`);
    expect(tokenFrom(resend.calls.at(-1)!.payload.text as string)).toBe(firstToken); // link não mudou
    expect(resend.acceptedCount).toBe(1);
    expect(await ctx.prisma.invitation.count({ where: { tripId: trip.id } })).toBe(1);
  });

  it('respeita retry-after do provedor dentro do envio', async () => {
    const waits: number[] = [];
    const s = new ResendMailSender(resend, { from: 'x <x@teste.dev>', maxRetries: 2, sleep: async (ms) => void waits.push(ms) });
    resend.script = [{ kind: 'error', name: 'rate_limit_exceeded', statusCode: 429, retryAfter: '2' }];
    await s.send({ to: 'a@teste.dev', subject: 's', text: 't', html: 'h' }, { idempotencyKey: 'k-1' });
    expect(waits).toEqual([2_000]);
    expect(resend.calls).toHaveLength(2);
  });

  it('falha definitiva abre novo envio (nova chave) no reenvio', async () => {
    const trip = await proTrip('Bonito');
    resend.script = [{ kind: 'error', name: 'validation_error', statusCode: 422 }];
    const res = await invite(trip.id).expect(201);
    expect(res.body.delivery).toMatchObject({ status: 'FAILED', errorCode: 'final:validation_error' });
    expect(resend.calls).toHaveLength(1); // sem novas tentativas automáticas

    await age(res.body.id);
    const ok = await resendInvite(trip.id, res.body.id).expect(200);
    expect(ok.body.delivery).toMatchObject({ status: 'PROVIDER_ACCEPTED', sends: 2 });
    expect(resend.calls.at(-1)!.options?.idempotencyKey).toBe(`invitation/${res.body.id}/send-2`);
  });

  it('reenvio após aceite conta como novo envio e respeita o máximo por convite', async () => {
    const trip = await proTrip('Recife');
    const res = await invite(trip.id).expect(201);
    for (const n of [2, 3]) {
      await age(res.body.id);
      const r = await resendInvite(trip.id, res.body.id).expect(200);
      expect(r.body.delivery.sends).toBe(n);
    }
    expect(resend.acceptedCount).toBe(3);
    await age(res.body.id);
    const limited = await resendInvite(trip.id, res.body.id).expect(403);
    expect(limited.body).toMatchObject({ code: 'INVITATION_RESEND_LIMITED', details: { maxSends: 3 } });
  });

  it('não reenvia convite revogado, expirado ou aceito', async () => {
    const trip = await proTrip('Olinda');
    const res = await invite(trip.id).expect(201);
    await age(res.body.id);
    await ctx.prisma.invitation.update({ where: { id: res.body.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await resendInvite(trip.id, res.body.id).expect(409)).body.code).toBe('INVITATION_NOT_RESENDABLE');

    const other = await invite(trip.id, 'outra@teste.dev').expect(201);
    await age(other.body.id);
    await ctx.http().delete(`/api/v1/trips/${trip.id}/invitations/${other.body.id}`).set(owner.auth).expect(204);
    expect((await resendInvite(trip.id, other.body.id).expect(409)).body.code).toBe('INVITATION_NOT_RESENDABLE');
  });

  it('reenvios concorrentes geram um único envio', async () => {
    const trip = await proTrip('Natal');
    const res = await invite(trip.id).expect(201);
    await age(res.body.id);
    resend.delayMs = 50;
    const results = await Promise.all([0, 1, 2].map(() => resendInvite(trip.id, res.body.id)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    results.filter((r) => r.status !== 200).forEach((r) => expect(r.body.code).toBe('INVITATION_DELIVERY_IN_PROGRESS'));
    expect(resend.acceptedCount).toBe(2); // envio inicial + um reenvio
  });

  it('nunca registra token, link ou conteúdo do e-mail em log', async () => {
    const spies = (['log', 'warn', 'error'] as const).map((m) => jest.spyOn(Logger.prototype, m));
    try {
      const trip = await proTrip('Manaus');
      resend.script = [{ kind: 'error', name: 'validation_error', statusCode: 422 }];
      await invite(trip.id).expect(201);
      await invite(trip.id, 'segunda@teste.dev').expect(201);
      const tokens = resend.calls.map((c) => tokenFrom(c.payload.text as string));
      const logged = JSON.stringify(spies.flatMap((s) => s.mock.calls));
      for (const t of tokens) expect(logged).not.toContain(t);
      expect(logged).not.toContain('convites/');
      expect(logged).not.toContain('segunda@teste.dev');
    } finally {
      spies.forEach((s) => s.mockRestore());
    }
  });
});

describe('Convites sem provedor de e-mail', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp({ mail: new UnconfiguredMailSender() });
  });
  beforeEach(() => resetDb(ctx));
  afterAll(() => ctx.app.close());

  it('responde EMAIL_DELIVERY_UNAVAILABLE e não cria convite', async () => {
    const owner = await createUser(ctx, 'Ana');
    const trip = await createTrip(ctx, owner, { plan: 'PRO' });
    const res = await ctx
      .http()
      .post(`/api/v1/trips/${trip.id}/invitations`)
      .set(owner.auth)
      .send({ email: 'x@teste.dev', role: 'VIEWER' })
      .expect(503);
    expect(res.body.code).toBe('EMAIL_DELIVERY_UNAVAILABLE');
    expect(await ctx.prisma.invitation.count()).toBe(0);
  });
});
