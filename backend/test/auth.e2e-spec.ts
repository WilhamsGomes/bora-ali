import { Logger } from '@nestjs/common';
import { createTestApp, resetDb, TestContext } from './helpers';

function refreshCookie(res: { headers: Record<string, unknown> }): string {
  const cookies = res.headers['set-cookie'] as string[] | undefined;
  const c = cookies?.find((x) => x.startsWith('boraali_rt='));
  if (!c) throw new Error('cookie de refresh ausente');
  return c.split(';')[0];
}

describe('Autenticação', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  beforeEach(() => resetDb(ctx));
  afterAll(() => ctx.app.close());

  const register = (email = 'ana@teste.dev') =>
    ctx.http().post('/api/v1/auth/register').send({ name: 'Ana', email, password: 'senha-segura-123' });

  it('cadastra com hash de senha, cookie httpOnly e sem expor segredos', async () => {
    const res = await register('Ana@Teste.dev').expect(201);
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.user).toMatchObject({ email: 'ana@teste.dev', name: 'Ana' });
    expect(res.body).not.toHaveProperty('refreshToken');
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');

    const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('boraali_rt='))!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Path=\/api\/v1\/auth/);

    const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email: 'ana@teste.dev' } });
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    const session = await ctx.prisma.session.findFirstOrThrow({ where: { userId: user.id } });
    expect(refreshCookie(res)).not.toContain(session.refreshTokenHash); // só o hash fica no banco
  });

  it('recusa e-mail duplicado', async () => {
    await register().expect(201);
    const res = await register().expect(409);
    expect(res.body.code).toBe('EMAIL_ALREADY_REGISTERED');
  });

  it('login com credenciais erradas retorna erro padronizado', async () => {
    await register().expect(201);
    const res = await ctx.http().post('/api/v1/auth/login').send({ email: 'ana@teste.dev', password: 'errada-123' }).expect(401);
    expect(res.body).toMatchObject({ code: 'INVALID_CREDENTIALS', requestId: expect.any(String) });
  });

  it('/auth/me exige token e devolve o usuário', async () => {
    const reg = await register().expect(201);
    await ctx.http().get('/api/v1/auth/me').expect(401);
    const me = await ctx.http().get('/api/v1/auth/me').set('Authorization', `Bearer ${reg.body.accessToken}`).expect(200);
    expect(me.body.email).toBe('ana@teste.dev');
  });

  it('refresh rotaciona o token e a reutilização do antigo revoga a sessão', async () => {
    const reg = await register().expect(201);
    const first = refreshCookie(reg);

    const r1 = await ctx.http().post('/api/v1/auth/refresh').set('Cookie', first).expect(200);
    const second = refreshCookie(r1);
    expect(second).not.toBe(first);

    // Fora da janela de tolerância, reapresentar o token antigo é tratado como vazamento.
    await ctx.prisma.session.updateMany({ data: { lastUsedAt: new Date(Date.now() - 60_000) } });
    await ctx.http().post('/api/v1/auth/refresh').set('Cookie', first).expect(401);

    // A sessão inteira foi revogada: nem o token novo funciona mais.
    const r3 = await ctx.http().post('/api/v1/auth/refresh').set('Cookie', second).expect(401);
    expect(r3.body.code).toBe('INVALID_REFRESH_TOKEN');
    const session = await ctx.prisma.session.findFirstOrThrow();
    expect(session.revokedReason).toBe('refresh_token_reuse');
  });

  it('logout revoga a sessão e invalida o access token imediatamente', async () => {
    const reg = await register().expect(201);
    const auth = { Authorization: `Bearer ${reg.body.accessToken}` };
    await ctx.http().get('/api/v1/auth/me').set(auth).expect(200);

    await ctx.http().post('/api/v1/auth/logout').set('Cookie', refreshCookie(reg)).expect(204);
    await ctx.http().get('/api/v1/auth/me').set(auth).expect(401);
    await ctx.http().post('/api/v1/auth/refresh').set('Cookie', refreshCookie(reg)).expect(401);
  });

  it('aplica rate limiting no login', async () => {
    await register().expect(201);
    const attempts = [];
    for (let i = 0; i < 11; i++) {
      attempts.push(
        (await ctx.http().post('/api/v1/auth/login').send({ email: 'ana@teste.dev', password: 'errada-123' })).status,
      );
    }
    expect(attempts.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(attempts[10]).toBe(429);
  });

  it('propaga X-Request-Id e registra a requisição no log HTTP sem o corpo', async () => {
    const spy = jest.spyOn(Logger.prototype, 'log');
    try {
      const res = await ctx
        .http()
        .post('/api/v1/auth/login')
        .set('X-Request-Id', 'teste-request-123')
        .send({ email: 'ninguem@teste.dev', password: 'senha-secreta-xyz' })
        .expect(401);
      expect(res.headers['x-request-id']).toBe('teste-request-123');
      expect(res.body.requestId).toBe('teste-request-123');
      const generated = await ctx.http().get('/api/v1/auth/me').expect(401);
      expect(generated.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);

      const lines = spy.mock.calls.map((c) => String(c[0]));
      expect(lines).toContainEqual(expect.stringMatching(/^POST \/api\/v1\/auth\/login 401 - \d+ms \(requestId=teste-request-123\)$/));
      expect(lines.join('\n')).not.toContain('senha-secreta-xyz');
    } finally {
      spy.mockRestore();
    }
  });

  it('valida o corpo com erro padronizado por campo', async () => {
    const res = await ctx.http().post('/api/v1/auth/register').send({ email: 'x', password: '1' }).expect(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.details.fields.map((f: { field: string }) => f.field)).toEqual(
      expect.arrayContaining(['name', 'email', 'password']),
    );
  });
});
