import { Injectable, Logger } from '@nestjs/common';

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Rótulos não sensíveis para rastreio no provedor (ex.: tipo do e-mail). */
  tags?: Record<string, string>;
}

export interface SendOptions {
  /**
   * Chave de idempotência do envio. Repetir a mesma chave (com o mesmo conteúdo)
   * nunca gera um segundo e-mail. Ex.: `invitation/<id>/send-<n>`.
   */
  idempotencyKey: string;
}

export interface SendResult {
  /** ID da mensagem no provedor. Aceite pelo provedor não garante entrega ao destinatário. */
  providerMessageId: string | null;
}

/**
 * Falha de envio. `retryable` indica se tentar de novo (com a mesma chave) faz
 * sentido; `sameKeyUnusable` indica que a chave não pode mais ser reaproveitada
 * (ex.: conteúdo mudou desde a primeira tentativa).
 */
export class MailDeliveryError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly options: { retryAfterMs?: number | null; httpStatus?: number | null; sameKeyUnusable?: boolean } = {},
  ) {
    super(message);
    this.name = 'MailDeliveryError';
  }
}

/**
 * Porta de envio de e-mail. `send` resolve quando o provedor ACEITOU a mensagem
 * para entrega; lança MailDeliveryError caso contrário.
 */
export abstract class MailSender {
  abstract readonly provider: string;
  abstract readonly isConfigured: boolean;
  abstract send(email: OutgoingEmail, options: SendOptions): Promise<SendResult>;
}

export interface OutboxEntry extends OutgoingEmail {
  idempotencyKey: string;
  sentAt: Date;
}

/**
 * Adaptador de desenvolvimento: guarda as mensagens em memória (caixa de saída
 * consultável em /api/v1/dev/outbox, indisponível em produção). Respeita a
 * chave de idempotência como um provedor real. Não registra conteúdo em log,
 * pois convites carregam tokens.
 */
@Injectable()
export class DevOutboxMailSender extends MailSender {
  readonly provider = 'dev-outbox';
  readonly isConfigured = true;
  private readonly logger = new Logger('DevOutbox');
  private readonly outbox: OutboxEntry[] = [];

  async send(email: OutgoingEmail, options: SendOptions): Promise<SendResult> {
    const existing = this.outbox.find((e) => e.idempotencyKey === options.idempotencyKey);
    if (existing) return { providerMessageId: `dev-${options.idempotencyKey}` };
    this.outbox.unshift({ ...email, idempotencyKey: options.idempotencyKey, sentAt: new Date() });
    this.outbox.splice(50);
    this.logger.log(`E-mail de desenvolvimento armazenado (tipo: ${email.tags?.type ?? 'n/d'})`);
    return { providerMessageId: `dev-${options.idempotencyKey}` };
  }

  list(): OutboxEntry[] {
    return this.outbox;
  }

  clear() {
    this.outbox.length = 0;
  }
}

/** Sem provedor configurado: falha explicitamente em vez de simular sucesso. */
@Injectable()
export class UnconfiguredMailSender extends MailSender {
  readonly provider = 'none';
  readonly isConfigured = false;

  async send(): Promise<SendResult> {
    throw new MailDeliveryError('EMAIL_DELIVERY_UNAVAILABLE', 'Nenhum provedor de e-mail configurado.', false);
  }
}
