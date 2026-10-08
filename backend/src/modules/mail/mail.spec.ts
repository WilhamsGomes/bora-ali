import { NotFoundException } from '@nestjs/common';
import { AppConfig } from '../../config/app-config.service';
import { DevOutboxController } from './dev-outbox.controller';
import { createMailSender } from './mail.module';
import { DevOutboxMailSender, MailDeliveryError, UnconfiguredMailSender } from './mail.service';
import { ResendLikeClient, ResendMailSender } from './resend.mail-sender';
import { escapeHtml, renderInvitationEmail } from './templates/invitation.template';

function config(env: Record<string, string>) {
  const saved = { ...process.env };
  process.env = { DATABASE_URL: 'postgresql://x', JWT_ACCESS_SECRET: 'x'.repeat(32), AI_PROVIDER: 'mock', ...env };
  try {
    return new AppConfig();
  } finally {
    process.env = saved;
  }
}

describe('seleção do provedor de e-mail', () => {
  it('outbox de desenvolvimento nunca é usada em produção', () => {
    // env.ts já recusa EMAIL_PROVIDER=dev em produção; a fábrica também se protege.
    const prodLike = Object.assign(Object.create(AppConfig.prototype) as AppConfig, {
      get: (k: string) => ({ EMAIL_PROVIDER: 'dev', NODE_ENV: 'production' })[k],
    });
    Object.defineProperty(prodLike, 'isProduction', { value: true });
    expect(createMailSender(prodLike)).toBeInstanceOf(UnconfiguredMailSender);
    expect(() => config({ NODE_ENV: 'production', EMAIL_PROVIDER: 'dev', AI_PROVIDER: 'anthropic' })).toThrow(/EMAIL_PROVIDER/);
  });

  it('endpoint da outbox responde 404 em produção', () => {
    const prod = Object.assign(Object.create(AppConfig.prototype) as AppConfig, {});
    Object.defineProperty(prod, 'isProduction', { value: true });
    const controller = new DevOutboxController(new DevOutboxMailSender(), prod);
    expect(() => controller.list()).toThrow(NotFoundException);
    expect(() => controller.clear()).toThrow(NotFoundException);
  });

  it('resend sem chave ou remetente fica indisponível; completo usa o Resend', () => {
    expect(createMailSender(config({ EMAIL_PROVIDER: 'resend' }))).toBeInstanceOf(UnconfiguredMailSender);
    expect(createMailSender(config({ EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 're_test' }))).toBeInstanceOf(UnconfiguredMailSender);
    expect(
      createMailSender(config({ EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 're_test', EMAIL_FROM: 'BoraAli <a@b.dev>' })),
    ).toBeInstanceOf(ResendMailSender);
    expect(createMailSender(config({ EMAIL_PROVIDER: 'none' }))).toBeInstanceOf(UnconfiguredMailSender);
  });
});

describe('ResendMailSender', () => {
  const email = { to: 'a@b.dev', subject: 's', text: 't', html: '<p>h</p>' };
  const clientReturning = (...responses: object[]) => {
    const send = jest.fn();
    responses.forEach((r) => send.mockResolvedValueOnce(r));
    return { client: { emails: { send } } as unknown as ResendLikeClient, send };
  };

  it('erro definitivo não é repetido', async () => {
    const { client, send } = clientReturning({ data: null, error: { name: 'validation_error', message: 'x', statusCode: 422 }, headers: {} });
    const sender = new ResendMailSender(client, { from: 'x <x@b.dev>', sleep: async () => {} });
    await expect(sender.send(email, { idempotencyKey: 'k' })).rejects.toMatchObject({ code: 'validation_error', retryable: false });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('chave reutilizada com conteúdo diferente não pode ser reaproveitada', async () => {
    const { client } = clientReturning({ data: null, error: { name: 'invalid_idempotent_request', message: 'x', statusCode: 409 }, headers: {} });
    const sender = new ResendMailSender(client, { from: 'x <x@b.dev>', sleep: async () => {} });
    const err = await sender.send(email, { idempotencyKey: 'k' }).catch((e: MailDeliveryError) => e);
    expect(err).toBeInstanceOf(MailDeliveryError);
    expect((err as MailDeliveryError).options.sameKeyUnusable).toBe(true);
  });

  it('falha de rede é repetida com a mesma chave', async () => {
    const send = jest.fn().mockRejectedValueOnce(new Error('ECONNRESET')).mockResolvedValueOnce({ data: { id: 'e1' }, error: null, headers: {} });
    const sender = new ResendMailSender({ emails: { send } } as unknown as ResendLikeClient, { from: 'x <x@b.dev>', sleep: async () => {} });
    await expect(sender.send(email, { idempotencyKey: 'k-net' })).resolves.toEqual({ providerMessageId: 'e1' });
    expect(send.mock.calls.map((c) => c[1])).toEqual([{ idempotencyKey: 'k-net' }, { idempotencyKey: 'k-net' }]);
  });
});

describe('template de convite', () => {
  const params = {
    tripName: '<img src=x onerror=alert(1)>',
    destination: 'Rio & Niterói',
    inviterName: "O'Neil",
    role: 'VIEWER' as const,
    expiresAt: new Date('2026-12-01T15:00:00Z'),
    acceptUrl: 'http://localhost:3000/convites/abc?x="1"',
  };

  it('escapa conteúdo de usuários no HTML e gera texto simples', () => {
    const { html, text, subject } = renderInvitationEmail(params);
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('Rio &amp; Niterói');
    expect(html).toContain('O&#39;Neil');
    expect(html).toContain('href="http://localhost:3000/convites/abc?x=&quot;1&quot;"');
    expect(text).toContain('visualizar o roteiro');
    expect(text).toContain('1 de dezembro de 2026');
    expect(text).toContain(params.acceptUrl);
    expect(subject).not.toMatch(/[\r\n]/);
  });

  it('escapeHtml cobre os caracteres especiais', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });
});
