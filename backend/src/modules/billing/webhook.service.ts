import { withFields } from '../../common/logging';
import { Injectable, Logger } from '@nestjs/common';
import { WebhookEventStatus } from '@prisma/client';
import { AppError, ErrorCode } from '../../common/errors/app-error';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentSyncService, SyncOutcome } from './payment-sync.service';
import { Stripe, StripeGateway } from './stripe.gateway';

const CHECKOUT_EVENTS = new Set([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'checkout.session.expired',
]);
const CHARGE_EVENTS = new Set(['charge.refunded']);
const DISPUTE_EVENTS = new Set(['charge.dispute.created', 'charge.dispute.updated', 'charge.dispute.closed']);

export interface WebhookResult {
  received: true;
  duplicate?: boolean;
  outcome?: SyncOutcome | 'ignored';
}

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeGateway,
    private readonly sync: PaymentSyncService,
  ) {}

  /**
   * 1. Verifica a assinatura com o corpo bruto.
   * 2. Registra o evento (idempotência por event.id).
   * 3. Processa consultando o estado atual no Stripe (independe da ordem de chegada).
   * Falhas retornam 5xx para o Stripe reenviar; eventos já processados retornam 200 sem efeito.
   */
  async handle(rawBody: Buffer | undefined, signature: string | undefined): Promise<WebhookResult> {
    if (!rawBody || !signature) {
      throw AppError.badRequest(ErrorCode.WEBHOOK_SIGNATURE_INVALID, 'Assinatura ausente.');
    }
    let event: Stripe.Event;
    try {
      event = this.stripe.constructEvent(rawBody, signature);
    } catch {
      throw AppError.badRequest(ErrorCode.WEBHOOK_SIGNATURE_INVALID, 'Assinatura do webhook inválida.');
    }

    const objectId = (event.data.object as { id?: string }).id ?? null;
    const record = await this.prisma.stripeWebhookEvent.upsert({
      where: { id: event.id },
      create: { id: event.id, type: event.type, objectId },
      update: { attempts: { increment: 1 } },
    });
    if (record.status === WebhookEventStatus.PROCESSED || record.status === WebhookEventStatus.IGNORED) {
      return { received: true, duplicate: true };
    }

    try {
      const outcome = await this.dispatch(event.type, objectId);
      await this.prisma.stripeWebhookEvent.update({
        where: { id: event.id },
        data: {
          status: outcome === 'ignored' ? WebhookEventStatus.IGNORED : WebhookEventStatus.PROCESSED,
          processedAt: new Date(),
          lastError: null,
        },
      });
      this.logger.log(withFields('Webhook do Stripe processado', { eventId: event.id, type: event.type, outcome }));
      return { received: true, outcome };
    } catch (err) {
      const message = (err as Error).message?.slice(0, 500) ?? 'erro desconhecido';
      await this.prisma.stripeWebhookEvent.update({
        where: { id: event.id },
        data: { status: WebhookEventStatus.FAILED, lastError: message },
      });
      this.logger.error(withFields('Falha ao processar webhook do Stripe', { eventId: event.id, type: event.type, err: message }));
      throw err; // 5xx → o Stripe tenta novamente
    }
  }

  private async dispatch(type: string, objectId: string | null): Promise<SyncOutcome | 'ignored'> {
    if (!objectId) return 'ignored';
    if (CHECKOUT_EVENTS.has(type)) return this.sync.syncCheckoutSession(objectId);
    if (CHARGE_EVENTS.has(type)) return this.sync.syncCharge(objectId);
    if (DISPUTE_EVENTS.has(type)) return this.sync.syncDispute(objectId);
    return 'ignored';
  }
}
