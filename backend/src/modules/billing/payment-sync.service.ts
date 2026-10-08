import { withFields } from '../../common/logging';
import { Injectable, Logger } from '@nestjs/common';
import { Order, OrderStatus, TripPlan } from '@prisma/client';
import { PrismaService, Tx } from '../../prisma/prisma.service';
import { PLAN_RANK, planFromPaidProducts } from '../entitlements/plan-policy';
import { Stripe, StripeGateway } from './stripe.gateway';

export type SyncOutcome =
  | 'paid'
  | 'already_paid'
  | 'processing'
  | 'failed'
  | 'expired'
  | 'open'
  | 'refunded'
  | 'disputed'
  | 'dispute_won'
  | 'rejected'
  | 'unknown_order'
  | 'no_change';

/** Status que ainda podem evoluir para pago (inclui pedidos expirados localmente que o Stripe confirmar depois). */
const PAYABLE: OrderStatus[] = [
  OrderStatus.CREATED,
  OrderStatus.OPEN,
  OrderStatus.PROCESSING,
  OrderStatus.FAILED,
  OrderStatus.EXPIRED,
  OrderStatus.CANCELED,
];
const PENDING: OrderStatus[] = [OrderStatus.CREATED, OrderStatus.OPEN];

/**
 * Reconcilia pedidos com o estado do Stripe. Todos os caminhos (webhook,
 * reconciliação agendada e consulta do pedido) passam por aqui e sempre
 * consultam o objeto atual na API do Stripe — nunca dados vindos do navegador.
 *
 * Idempotente e tolerante a eventos repetidos/fora de ordem: as transições são
 * monotônicas, feitas sob bloqueio da linha do pedido, e o plano da viagem é
 * recalculado a partir dos pedidos pagos.
 */
@Injectable()
export class PaymentSyncService {
  private readonly logger = new Logger(PaymentSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeGateway,
  ) {}

  async syncCheckoutSession(sessionId: string): Promise<SyncOutcome> {
    const session = await this.stripe.retrieveCheckoutSession(sessionId);
    const orderId = session.metadata?.orderId ?? session.client_reference_id;
    if (!orderId) return 'unknown_order';

    return this.prisma.$transaction(async (tx) => {
      await this.prisma.lockRows(tx, 'Order', [orderId]);
      const order = await tx.order.findUnique({ where: { id: orderId } });
      if (!order) return 'unknown_order';

      const mismatch = this.validateSession(order, session);
      if (mismatch) {
        // Não libera nada: sessão não corresponde ao pedido (valor, moeda, referência...).
        this.logger.warn(withFields('Sessão de checkout não confere com o pedido', { orderId: order.id, mismatch }));
        await tx.order.update({
          where: { id: order.id },
          data: { requiresReview: true, failureReason: `validation_mismatch:${mismatch}`, lastSyncedAt: new Date() },
        });
        return 'rejected';
      }

      const paymentIntent = session.payment_intent as Stripe.PaymentIntent | string | null;
      const paymentIntentId = typeof paymentIntent === 'string' ? paymentIntent : (paymentIntent?.id ?? null);
      const base = {
        stripeCheckoutSessionId: session.id,
        lastSyncedAt: new Date(),
        ...(paymentIntentId ? { stripePaymentIntentId: paymentIntentId } : {}),
      };

      if (session.status === 'complete' && session.payment_status === 'paid') {
        if (!PAYABLE.includes(order.status)) {
          await tx.order.update({ where: { id: order.id }, data: base });
          return 'already_paid'; // PAID, ou já revertido (REFUNDED/DISPUTED): nunca reaplica
        }
        await tx.order.update({
          where: { id: order.id },
          data: { ...base, status: OrderStatus.PAID, paidAt: new Date(), checkoutUrl: null, failureReason: null },
        });
        const plan = await this.applyTripPlan(tx, order.tripId, 'grant');
        const noEffect = !plan || PLAN_RANK[plan.after] < PLAN_RANK[order.targetPlan];
        const duplicate = plan !== null && PLAN_RANK[plan.before] >= PLAN_RANK[order.targetPlan];
        if (noEffect || duplicate) {
          // Pago sem efeito (viagem excluída, upgrade sem PRO vigente) ou em duplicidade: revisão/reembolso manual.
          const reason = noEffect ? 'paid_without_effect' : 'duplicate_payment';
          await tx.order.update({ where: { id: order.id }, data: { requiresReview: true, failureReason: reason } });
          this.logger.warn(withFields('Pagamento confirmado requer revisão', { orderId: order.id, reason }));
        }
        return 'paid';
      }

      if (session.status === 'complete') {
        // Checkout concluído, mas pagamento assíncrono ainda não confirmado (ou falhou).
        const piStatus = typeof paymentIntent === 'object' ? paymentIntent?.status : undefined;
        const failed = piStatus === 'requires_payment_method' || piStatus === 'canceled';
        if (failed) {
          if ([...PENDING, OrderStatus.PROCESSING].includes(order.status)) {
            await tx.order.update({
              where: { id: order.id },
              data: { ...base, status: OrderStatus.FAILED, failureReason: 'async_payment_failed', checkoutUrl: null },
            });
            return 'failed';
          }
          return 'no_change';
        }
        if (PENDING.includes(order.status)) {
          await tx.order.update({
            where: { id: order.id },
            data: { ...base, status: OrderStatus.PROCESSING, checkoutUrl: null },
          });
          return 'processing';
        }
        await tx.order.update({ where: { id: order.id }, data: base });
        return order.status === OrderStatus.PROCESSING ? 'processing' : 'no_change';
      }

      if (session.status === 'expired') {
        if (PENDING.includes(order.status)) {
          await tx.order.update({
            where: { id: order.id },
            data: { ...base, status: OrderStatus.EXPIRED, checkoutUrl: null, failureReason: 'checkout_expired' },
          });
          return 'expired';
        }
        return 'no_change';
      }

      await tx.order.update({ where: { id: order.id }, data: base });
      return 'open';
    });
  }

  /** Reembolso total revoga o benefício. Reembolso parcial não altera o plano. */
  async syncCharge(chargeId: string): Promise<SyncOutcome> {
    const charge = await this.stripe.retrieveCharge(chargeId);
    const piId = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;
    if (!piId) return 'unknown_order';
    if (!charge.refunded) return 'no_change';

    return this.withOrderByPaymentIntent(piId, async (tx, order) => {
      if (order.status !== OrderStatus.PAID && order.status !== OrderStatus.DISPUTED) return 'no_change';
      await tx.order.update({
        where: { id: order.id },
        data: { status: OrderStatus.REFUNDED, refundedAt: new Date(), lastSyncedAt: new Date() },
      });
      await this.applyTripPlan(tx, order.tripId, 'recompute');
      return 'refunded';
    });
  }

  /**
   * Disputa aberta suspende o benefício; disputa ganha restaura; perdida mantém revogado.
   * Consultas (warning_*) não alteram nada.
   */
  async syncDispute(disputeId: string): Promise<SyncOutcome> {
    const dispute = await this.stripe.retrieveDispute(disputeId);
    const piId = typeof dispute.payment_intent === 'string' ? dispute.payment_intent : dispute.payment_intent?.id;
    if (!piId) return 'unknown_order';

    return this.withOrderByPaymentIntent(piId, async (tx, order) => {
      if (dispute.status.startsWith('warning_')) return 'no_change';
      if (dispute.status === 'won') {
        if (order.status !== OrderStatus.DISPUTED) return 'no_change';
        await tx.order.update({ where: { id: order.id }, data: { status: OrderStatus.PAID, lastSyncedAt: new Date() } });
        await this.applyTripPlan(tx, order.tripId, 'recompute');
        return 'dispute_won';
      }
      if (order.status !== OrderStatus.PAID) return 'no_change';
      await tx.order.update({ where: { id: order.id }, data: { status: OrderStatus.DISPUTED, lastSyncedAt: new Date() } });
      await this.applyTripPlan(tx, order.tripId, 'recompute');
      return 'disputed';
    });
  }

  private async withOrderByPaymentIntent(
    paymentIntentId: string,
    fn: (tx: Tx, order: Order) => Promise<SyncOutcome>,
  ): Promise<SyncOutcome> {
    return this.prisma.$transaction(async (tx) => {
      const found = await tx.order.findUnique({ where: { stripePaymentIntentId: paymentIntentId }, select: { id: true } });
      if (!found) return 'unknown_order';
      await this.prisma.lockRows(tx, 'Order', [found.id]);
      return fn(tx, await tx.order.findUniqueOrThrow({ where: { id: found.id } }));
    });
  }

  /**
   * Recalcula o plano a partir dos pedidos PAID da viagem.
   * - grant: nunca rebaixa (max entre o plano atual e o derivado).
   * - recompute: usado em reversões; pode rebaixar. Atividades nunca são apagadas.
   */
  private async applyTripPlan(
    tx: Tx,
    tripId: string | null,
    mode: 'grant' | 'recompute',
  ): Promise<{ before: TripPlan; after: TripPlan } | null> {
    if (!tripId) return null;
    await this.prisma.lockRows(tx, 'Trip', [tripId]);
    const trip = await tx.trip.findUnique({ where: { id: tripId }, select: { plan: true } });
    if (!trip) return null;
    const paid = await tx.order.findMany({ where: { tripId, status: OrderStatus.PAID }, select: { product: true } });
    const derived = planFromPaidProducts(paid.map((o) => o.product));
    const next = mode === 'grant' && PLAN_RANK[trip.plan] > PLAN_RANK[derived] ? trip.plan : derived;
    if (next !== trip.plan) {
      await tx.trip.update({ where: { id: tripId }, data: { plan: next } });
      this.logger.log(withFields('Plano da viagem atualizado', { tripId, from: trip.plan, to: next, mode }));
    }
    return { before: trip.plan, after: next };
  }

  private validateSession(order: Order, session: Stripe.Checkout.Session): string | null {
    if (order.stripeCheckoutSessionId && order.stripeCheckoutSessionId !== session.id) return 'session_id';
    if (session.client_reference_id !== order.id) return 'client_reference_id';
    if (session.metadata?.orderId !== order.id) return 'metadata.orderId';
    if (session.mode !== 'payment') return 'mode';
    if ((session.currency ?? '').toLowerCase() !== order.currency) return 'currency';
    if (session.amount_total !== order.amount) return 'amount';
    return null;
  }
}
