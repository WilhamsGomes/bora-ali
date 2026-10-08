import { Injectable } from '@nestjs/common';
import Stripe from 'stripe';
import { AppConfig } from '../../config/app-config.service';

/**
 * Fronteira com o Stripe. Mantida fina de propósito: só traduz chamadas do SDK,
 * sem regras de negócio — e pode ser substituída por um fake nos testes.
 */
@Injectable()
export class StripeGateway {
  private readonly client: Stripe;
  readonly isConfigured: boolean;

  constructor(private readonly config: AppConfig) {
    const key = config.get('STRIPE_SECRET_KEY');
    this.isConfigured = Boolean(key && config.get('STRIPE_WEBHOOK_SECRET'));
    // Sem chave, o cliente existe apenas para verificar assinaturas; chamadas de API não são feitas.
    this.client = new Stripe(key ?? 'sk_test_unconfigured', {
      maxNetworkRetries: 2,
      timeout: 20_000,
      appInfo: { name: 'BoraAli', version: '0.1.0' },
    });
  }

  /** Verifica a assinatura com o corpo bruto da requisição. Lança se inválida. */
  constructEvent(rawBody: Buffer, signature: string): Stripe.Event {
    const secret = this.config.get('STRIPE_WEBHOOK_SECRET');
    if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET não configurado');
    return this.client.webhooks.constructEvent(rawBody, signature, secret);
  }

  createCustomer(params: Stripe.CustomerCreateParams, idempotencyKey: string): Promise<Stripe.Customer> {
    return this.client.customers.create(params, { idempotencyKey });
  }

  retrievePrice(priceId: string): Promise<Stripe.Price> {
    return this.client.prices.retrieve(priceId);
  }

  createCheckoutSession(
    params: Stripe.Checkout.SessionCreateParams,
    idempotencyKey: string,
  ): Promise<Stripe.Checkout.Session> {
    return this.client.checkout.sessions.create(params, { idempotencyKey });
  }

  retrieveCheckoutSession(sessionId: string): Promise<Stripe.Checkout.Session> {
    return this.client.checkout.sessions.retrieve(sessionId, { expand: ['payment_intent'] });
  }

  expireCheckoutSession(sessionId: string): Promise<Stripe.Checkout.Session> {
    return this.client.checkout.sessions.expire(sessionId);
  }

  retrieveCharge(chargeId: string): Promise<Stripe.Charge> {
    return this.client.charges.retrieve(chargeId);
  }

  retrieveDispute(disputeId: string): Promise<Stripe.Dispute> {
    return this.client.disputes.retrieve(disputeId);
  }
}

export type { Stripe };
