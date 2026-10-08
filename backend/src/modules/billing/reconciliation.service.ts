import { withFields } from '../../common/logging';
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OrderStatus } from '@prisma/client';
import { AppConfig } from '../../config/app-config.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentSyncService } from './payment-sync.service';
import { StripeGateway } from './stripe.gateway';

const MINUTE = 60_000;

/**
 * Rede de segurança para webhooks perdidos ou atrasados: revisita pedidos
 * presos e consulta o Stripe. Roda no worker (RUN_WORKERS=true).
 */
@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeGateway,
    private readonly sync: PaymentSyncService,
    private readonly config: AppConfig,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'billing-reconciliation' })
  async scheduled(): Promise<void> {
    if (!this.config.get('RUN_WORKERS') || !this.stripe.isConfigured || this.running) return;
    this.running = true;
    try {
      await this.reconcile();
    } catch (err) {
      this.logger.error(withFields('Falha na reconciliação de pedidos', { err: (err as Error).message }));
    } finally {
      this.running = false;
    }
  }

  async reconcile(now = new Date()): Promise<{ checked: number; interrupted: number }> {
    // Pedido gravado mas sessão nunca criada (processo caiu no meio): sem cobrança possível.
    const interrupted = await this.prisma.order.updateMany({
      where: { status: OrderStatus.CREATED, createdAt: { lt: new Date(now.getTime() - 10 * MINUTE) } },
      data: { status: OrderStatus.FAILED, failureReason: 'checkout_creation_interrupted' },
    });

    const stuck = await this.prisma.order.findMany({
      where: {
        stripeCheckoutSessionId: { not: null },
        OR: [
          // Sessão aberta já vencida, ou aberta há muito sem notícia.
          { status: OrderStatus.OPEN, checkoutExpiresAt: { lt: now } },
          { status: OrderStatus.OPEN, updatedAt: { lt: new Date(now.getTime() - 30 * MINUTE) } },
          // Pagamento assíncrono pendente: confere periodicamente.
          { status: OrderStatus.PROCESSING, OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lt: new Date(now.getTime() - 30 * MINUTE) } }] },
        ],
      },
      select: { id: true, stripeCheckoutSessionId: true },
      take: 100,
      orderBy: { updatedAt: 'asc' },
    });

    for (const order of stuck) {
      try {
        const outcome = await this.sync.syncCheckoutSession(order.stripeCheckoutSessionId!);
        this.logger.log(withFields('Pedido reconciliado', { orderId: order.id, outcome }));
      } catch (err) {
        this.logger.warn(withFields('Falha ao reconciliar pedido', { orderId: order.id, err: (err as Error).message }));
      }
    }

    const review = await this.prisma.order.count({ where: { requiresReview: true, status: OrderStatus.PAID } });
    if (review > 0) this.logger.warn(withFields('Há pedidos pagos aguardando revisão manual', { count: review }));
    return { checked: stuck.length, interrupted: interrupted.count };
  }
}
