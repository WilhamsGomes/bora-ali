import { withFields } from '../../common/logging';
import { Logger } from '@nestjs/common';
import { Resend } from 'resend';
import { MailDeliveryError, MailSender, OutgoingEmail, SendOptions, SendResult } from './mail.service';

/** Subconjunto do SDK do Resend usado aqui (facilita substituir nos testes). */
export interface ResendLikeClient {
  emails: {
    send: Resend['emails']['send'];
  };
}

/** Códigos do Resend em que vale tentar de novo com a mesma chave (docs: API reference → Errors). */
const RETRYABLE = new Set([
  'rate_limit_exceeded',
  'concurrent_idempotent_requests',
  'application_error',
  'internal_server_error',
]);

export interface ResendSenderOptions {
  from: string;
  /** Novas tentativas automáticas para erros transitórios (mesma chave de idempotência). */
  maxRetries?: number;
  /** Espera máxima aceita entre tentativas (a requisição do usuário está aberta). */
  maxWaitMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Adaptador do Resend (`resend.emails.send(payload, { idempotencyKey })`).
 * O SDK não lança exceções: devolve `{ data, error, headers }`.
 * Nunca registra conteúdo, destinatário ou chave de API em log.
 */
export class ResendMailSender extends MailSender {
  readonly provider = 'resend';
  readonly isConfigured = true;
  private readonly logger = new Logger('ResendMailSender');
  private readonly maxRetries: number;
  private readonly maxWaitMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly client: ResendLikeClient,
    private readonly options: ResendSenderOptions,
  ) {
    super();
    this.maxRetries = options.maxRetries ?? 2;
    this.maxWaitMs = options.maxWaitMs ?? 5_000;
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  static fromApiKey(apiKey: string, options: ResendSenderOptions): ResendMailSender {
    return new ResendMailSender(new Resend(apiKey), options);
  }

  async send(email: OutgoingEmail, { idempotencyKey }: SendOptions): Promise<SendResult> {
    for (let attempt = 0; ; attempt++) {
      let response: Awaited<ReturnType<ResendLikeClient['emails']['send']>>;
      try {
        response = await this.client.emails.send(
          {
            from: this.options.from,
            to: [email.to],
            subject: email.subject,
            html: email.html,
            text: email.text,
            tags: Object.entries(email.tags ?? {}).map(([name, value]) => ({ name, value })),
          },
          { idempotencyKey },
        );
      } catch {
        // Falha de rede antes de obter resposta: o e-mail pode ou não ter sido aceito.
        // Repetir com a MESMA chave é seguro (o Resend deduplica por 24 h).
        response = {
          data: null,
          error: { name: 'application_error', message: 'Falha de rede', statusCode: null },
          headers: null,
        };
      }

      if (!response.error) {
        return { providerMessageId: response.data?.id ?? null };
      }

      const { name, statusCode } = response.error;
      const retryable = RETRYABLE.has(name);
      const retryAfterMs = parseRetryAfter(response.headers?.['retry-after']);
      this.logger.warn(withFields('Falha ao enviar e-mail pelo Resend', { code: name, httpStatus: statusCode, attempt: attempt + 1, retryable }));

      const wait = retryAfterMs ?? 500 * 2 ** attempt;
      if (retryable && attempt < this.maxRetries && wait <= this.maxWaitMs) {
        await this.sleep(wait);
        continue;
      }
      throw new MailDeliveryError(name, 'O provedor de e-mail não aceitou a mensagem.', retryable, {
        retryAfterMs,
        httpStatus: statusCode,
        // Mesma chave com conteúdo diferente: a chave não pode mais ser usada.
        sameKeyUnusable: name === 'invalid_idempotent_request' || name === 'invalid_idempotency_key',
      });
    }
  }
}

function parseRetryAfter(value: string | undefined): number | null {
  if (!value) return null;
  const seconds = Number(value);
  return Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : null;
}
