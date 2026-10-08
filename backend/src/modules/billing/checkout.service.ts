import { withFields } from '../../common/logging';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { BillingProduct, Order, OrderStatus, Prisma, TripPlan, TripRole } from '@prisma/client';
import { AppError, ErrorCode } from '../../common/errors/app-error';
import { AppConfig } from '../../config/app-config.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CURRENCY, decidePurchase, PRODUCT_CATALOG } from '../entitlements/plan-policy';
import { TripAccessService } from '../entitlements/trip-access.service';
import type { CheckoutResponseDto, CreateCheckoutDto, OrderDto } from './dto/billing.dto';
import { PaymentSyncService } from './payment-sync.service';
import { StripeGateway } from './stripe.gateway';

const ACTIVE: OrderStatus[] = [OrderStatus.CREATED, OrderStatus.OPEN, OrderStatus.PROCESSING];
/** Uma sessão aberta só é reaproveitada se ainda tiver folga razoável antes de expirar. */
const REUSE_MIN_REMAINING_MS = 5 * 60_000;
/** Pedido CREATED mais antigo que isto foi interrompido (falha entre gravar o pedido e criar a sessão). */
const STALE_CREATED_MS = 2 * 60_000;
/** Intervalo mínimo entre consultas ao Stripe disparadas pelo polling do frontend. */
const POLL_SYNC_INTERVAL_MS = 15_000;

export function toOrderDto(order: Order, tripPlan: TripPlan | null): OrderDto {
  return {
    id: order.id,
    tripId: order.tripId,
    product: order.product,
    targetPlan: order.targetPlan,
    amount: order.amount,
    currency: order.currency.toUpperCase(),
    status: order.status,
    checkoutUrl: order.status === OrderStatus.OPEN ? order.checkoutUrl : null,
    checkoutExpiresAt: order.checkoutExpiresAt,
    paidAt: order.paidAt,
    failureReason: order.failureReason,
    tripPlan,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}

@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);
  private readonly verifiedPrices = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: TripAccessService,
    private readonly stripe: StripeGateway,
    private readonly sync: PaymentSyncService,
    private readonly config: AppConfig,
  ) {}

  /**
   * Inicia a compra. O cliente informa apenas viagem e plano desejado; o servidor
   * decide produto, preço e elegibilidade. Um índice parcial garante um único
   * pedido ativo por viagem, evitando compras duplicadas concorrentes.
   */
  async createCheckout(userId: string, email: string, dto: CreateCheckoutDto): Promise<CheckoutResponseDto> {
    if (!this.stripe.isConfigured) {
      throw AppError.unavailable(ErrorCode.BILLING_UNAVAILABLE, 'Pagamentos não estão configurados neste ambiente.');
    }

    for (let attempt = 0; attempt < 2; attempt++) {
      const step = await this.reserveOrder(userId, dto);
      if (step.kind === 'reuse') {
        return { order: toOrderDto(step.order, step.tripPlan), checkoutUrl: step.order.checkoutUrl!, reused: true };
      }
      if (step.kind === 'replace') {
        // Sessão aberta de outro produto (ou perto de expirar): expira no Stripe e tenta de novo.
        await this.retireOpenOrder(step.order);
        continue;
      }
      return this.openCheckoutSession(step.order, userId, email);
    }
    throw AppError.conflict(ErrorCode.PAYMENT_PENDING, 'Já existe um pagamento em andamento para esta viagem.');
  }

  async getOrder(userId: string, orderId: string): Promise<OrderDto> {
    let order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw AppError.notFound(ErrorCode.ORDER_NOT_FOUND, 'Pedido não encontrado.');
    if (order.buyerId !== userId) {
      // O proprietário atual da viagem também pode acompanhar; os demais recebem 404.
      const owner = order.tripId
        ? await this.prisma.tripMember.findFirst({ where: { tripId: order.tripId, userId, role: TripRole.OWNER } })
        : null;
      if (!owner) throw AppError.notFound(ErrorCode.ORDER_NOT_FOUND, 'Pedido não encontrado.');
    }

    // Enquanto pendente, consulta o Stripe (servidor → API do Stripe) para não depender só do webhook.
    // Nunca usa parâmetros do redirect de sucesso.
    const stale = !order.lastSyncedAt || Date.now() - order.lastSyncedAt.getTime() > POLL_SYNC_INTERVAL_MS;
    if (ACTIVE.includes(order.status) && order.stripeCheckoutSessionId && stale && this.stripe.isConfigured) {
      try {
        await this.sync.syncCheckoutSession(order.stripeCheckoutSessionId);
        order = await this.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
      } catch (err) {
        this.logger.warn(withFields('Falha ao sincronizar pedido com o Stripe', { orderId, err: (err as Error).message }));
      }
    }
    return toOrderDto(order, await this.tripPlan(order.tripId));
  }

  async listTripOrders(userId: string, tripId: string): Promise<OrderDto[]> {
    const { trip } = await this.access.require(userId, tripId, 'billing:purchase');
    const orders = await this.prisma.order.findMany({ where: { tripId }, orderBy: { createdAt: 'desc' } });
    return orders.map((o) => toOrderDto(o, trip.plan));
  }

  // ───────────────────────────── Etapas ─────────────────────────────

  private async reserveOrder(
    userId: string,
    dto: CreateCheckoutDto,
  ): Promise<
    | { kind: 'reuse'; order: Order; tripPlan: TripPlan }
    | { kind: 'replace'; order: Order }
    | { kind: 'create'; order: Order }
  > {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const { trip } = await this.access.require(userId, dto.tripId, 'billing:purchase', tx);
        await this.prisma.lockRows(tx, 'Trip', [trip.id]);
        const current = await tx.trip.findUniqueOrThrow({ where: { id: trip.id }, select: { plan: true } });

        const decision = decidePurchase(current.plan, dto.plan);
        if (!decision.ok) {
          throw decision.reason === 'PLAN_ALREADY_ACTIVE'
            ? AppError.conflict(ErrorCode.PLAN_ALREADY_ACTIVE, 'A viagem já possui este plano.', { plan: current.plan })
            : AppError.unprocessable(ErrorCode.PLAN_NOT_ELIGIBLE, 'Esta compra não está disponível para o plano atual.', {
                currentPlan: current.plan,
                requestedPlan: dto.plan,
              });
        }

        const active = await tx.order.findFirst({ where: { tripId: trip.id, status: { in: ACTIVE } } });
        if (active) {
          if (active.status === OrderStatus.PROCESSING) {
            throw AppError.conflict(ErrorCode.PAYMENT_PENDING, 'Há um pagamento em processamento para esta viagem.', {
              orderId: active.id,
            });
          }
          if (active.status === OrderStatus.CREATED) {
            if (Date.now() - active.createdAt.getTime() < STALE_CREATED_MS) {
              throw AppError.conflict(ErrorCode.PAYMENT_PENDING, 'Um checkout está sendo criado. Tente novamente em instantes.', {
                orderId: active.id,
              });
            }
            await tx.order.update({
              where: { id: active.id },
              data: { status: OrderStatus.FAILED, failureReason: 'checkout_creation_interrupted' },
            });
          } else {
            const reusable =
              active.product === decision.product &&
              active.buyerId === userId &&
              !!active.checkoutUrl &&
              !!active.checkoutExpiresAt &&
              active.checkoutExpiresAt.getTime() - Date.now() > REUSE_MIN_REMAINING_MS;
            return reusable ? { kind: 'reuse', order: active, tripPlan: current.plan } : { kind: 'replace', order: active };
          }
        }

        const priceId = this.priceIdFor(decision.product);
        const order = await tx.order.create({
          data: {
            tripId: trip.id,
            buyerId: userId,
            product: decision.product,
            targetPlan: decision.targetPlan,
            amount: decision.amount,
            currency: CURRENCY,
            stripePriceId: priceId,
            status: OrderStatus.CREATED,
          },
        });
        return { kind: 'create', order };
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw AppError.conflict(ErrorCode.PAYMENT_PENDING, 'Já existe um pagamento em andamento para esta viagem.');
      }
      throw err;
    }
  }

  private async openCheckoutSession(order: Order, userId: string, email: string): Promise<CheckoutResponseDto> {
    try {
      await this.assertPrice(order.product, order.stripePriceId);
      const customer = await this.getOrCreateCustomer(userId, email);
      const frontend = this.config.get('FRONTEND_URL');
      const expiresAt = Math.floor(Date.now() / 1000) + this.config.get('CHECKOUT_SESSION_TTL_MINUTES') * 60;
      const metadata = { orderId: order.id, tripId: order.tripId!, product: order.product };

      const session = await this.stripe.createCheckoutSession(
        {
          mode: 'payment',
          line_items: [{ price: order.stripePriceId, quantity: 1 }],
          customer,
          client_reference_id: order.id,
          metadata,
          payment_intent_data: { metadata, description: PRODUCT_CATALOG[order.product].label },
          expires_at: expiresAt,
          locale: 'pt-BR',
          // O frontend usa `pedido` para consultar GET /billing/orders/:id; nada é liberado pelo redirect.
          success_url: `${frontend}/app/viagens/${order.tripId}/pagamento?pedido=${order.id}`,
          cancel_url: `${frontend}/app/viagens/${order.tripId}?pagamento=cancelado`,
        },
        `checkout:${order.id}`,
      );
      if (!session.url) throw new Error('Sessão de checkout sem URL');

      const updated = await this.prisma.order.update({
        where: { id: order.id },
        data: {
          status: OrderStatus.OPEN,
          stripeCheckoutSessionId: session.id,
          checkoutUrl: session.url,
          checkoutExpiresAt: new Date(session.expires_at * 1000),
          lastSyncedAt: new Date(),
        },
      });
      return { order: toOrderDto(updated, await this.tripPlan(order.tripId)), checkoutUrl: session.url, reused: false };
    } catch (err) {
      // Libera o "slot" de pedido ativo para que o usuário possa tentar de novo.
      await this.prisma.order.updateMany({
        where: { id: order.id, status: OrderStatus.CREATED },
        data: { status: OrderStatus.FAILED, failureReason: 'checkout_creation_failed' },
      });
      if (err instanceof AppError) throw err;
      this.logger.error(withFields('Falha ao criar sessão de checkout', { orderId: order.id, err: (err as Error).message }));
      throw new AppError(
        HttpStatus.BAD_GATEWAY,
        ErrorCode.PAYMENT_PROVIDER_ERROR,
        'Não foi possível iniciar o pagamento. Tente novamente.',
      );
    }
  }

  /** Expira a sessão aberta anterior. Se ela já tiver sido paga, a sincronização registra isso. */
  private async retireOpenOrder(order: Order): Promise<void> {
    if (order.stripeCheckoutSessionId) {
      try {
        await this.stripe.expireCheckoutSession(order.stripeCheckoutSessionId);
      } catch (err) {
        this.logger.warn(withFields('Não foi possível expirar a sessão anterior', { orderId: order.id, err: (err as Error).message }));
      }
      const outcome = await this.sync.syncCheckoutSession(order.stripeCheckoutSessionId);
      if (outcome === 'paid' || outcome === 'processing') {
        throw AppError.conflict(ErrorCode.PAYMENT_PENDING, 'O pagamento anterior desta viagem já foi concluído ou está em processamento.', {
          orderId: order.id,
        });
      }
      if (outcome === 'expired') return;
    }
    await this.prisma.order.updateMany({
      where: { id: order.id, status: { in: [OrderStatus.CREATED, OrderStatus.OPEN] } },
      data: { status: OrderStatus.CANCELED, failureReason: 'replaced_by_new_checkout', checkoutUrl: null },
    });
  }

  private async getOrCreateCustomer(userId: string, email: string): Promise<string> {
    const existing = await this.prisma.billingCustomer.findUnique({ where: { userId } });
    if (existing) return existing.stripeCustomerId;
    const customer = await this.stripe.createCustomer({ email, metadata: { userId } }, `customer:${userId}`);
    try {
      await this.prisma.billingCustomer.create({ data: { userId, stripeCustomerId: customer.id } });
      return customer.id;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return (await this.prisma.billingCustomer.findUniqueOrThrow({ where: { userId } })).stripeCustomerId;
      }
      throw err;
    }
  }

  private priceIdFor(product: BillingProduct): string {
    const ids: Record<BillingProduct, string | undefined> = {
      PRO: this.config.get('STRIPE_PRICE_PRO'),
      PRO_AI: this.config.get('STRIPE_PRICE_PRO_AI'),
      UPGRADE_PRO_AI: this.config.get('STRIPE_PRICE_UPGRADE_PRO_AI'),
    };
    const id = ids[product];
    if (!id) {
      throw AppError.unavailable(ErrorCode.BILLING_MISCONFIGURED, 'Preço do produto não configurado.', { product });
    }
    return id;
  }

  /** Confere que o preço do Stripe bate com o catálogo interno (valor, moeda, pagamento único, ativo). */
  private async assertPrice(product: BillingProduct, priceId: string): Promise<void> {
    const expected = PRODUCT_CATALOG[product].amount;
    if (this.verifiedPrices.get(priceId) === expected) return;
    const price = await this.stripe.retrievePrice(priceId);
    const ok = price.active && price.type === 'one_time' && price.currency === CURRENCY && price.unit_amount === expected;
    if (!ok) {
      this.logger.error(withFields('Preço do Stripe diverge do catálogo interno', { product, priceId }));
      throw AppError.unavailable(ErrorCode.BILLING_MISCONFIGURED, 'Configuração de preço inválida. Tente mais tarde.', {
        product,
      });
    }
    this.verifiedPrices.set(priceId, expected);
  }

  private async tripPlan(tripId: string | null): Promise<TripPlan | null> {
    if (!tripId) return null;
    return (await this.prisma.trip.findUnique({ where: { id: tripId }, select: { plan: true } }))?.plan ?? null;
  }
}
