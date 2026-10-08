import { Module } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { CheckoutService } from './checkout.service';
import { PaymentSyncService } from './payment-sync.service';
import { ReconciliationService } from './reconciliation.service';
import { StripeGateway } from './stripe.gateway';
import { WebhookService } from './webhook.service';

@Module({
  controllers: [BillingController],
  providers: [StripeGateway, PaymentSyncService, CheckoutService, WebhookService, ReconciliationService],
  exports: [ReconciliationService],
})
export class BillingModule {}
