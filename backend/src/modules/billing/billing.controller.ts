import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { ErrorResponseDto } from '../../common/errors/error-response.dto';
import { AuthUser, CurrentUser, Public } from '../auth/auth.decorators';
import { CheckoutService } from './checkout.service';
import { CheckoutResponseDto, CreateCheckoutDto, OrderDto } from './dto/billing.dto';
import { WebhookResult, WebhookService } from './webhook.service';

@ApiTags('billing')
@Controller()
export class BillingController {
  constructor(
    private readonly checkout: CheckoutService,
    private readonly webhooks: WebhookService,
  ) {}

  @Post('billing/checkout')
  @ApiBearerAuth()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Inicia o Stripe Checkout para a viagem (somente OWNER)',
    description:
      'FREE → PRO (R$9,90) ou PRO_AI (R$19,90); PRO → PRO_AI (upgrade R$10,00). O benefício só é liberado após confirmação do pagamento via webhook/consulta ao Stripe.',
  })
  @ApiCreatedResponse({ type: CheckoutResponseDto })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'PLAN_ALREADY_ACTIVE / PAYMENT_PENDING' })
  @ApiUnprocessableEntityResponse({ type: ErrorResponseDto, description: 'PLAN_NOT_ELIGIBLE' })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: 'FORBIDDEN (não é o proprietário)' })
  @ApiServiceUnavailableResponse({ type: ErrorResponseDto, description: 'BILLING_UNAVAILABLE / BILLING_MISCONFIGURED' })
  createCheckout(@CurrentUser() user: AuthUser, @Body() dto: CreateCheckoutDto): Promise<CheckoutResponseDto> {
    return this.checkout.createCheckout(user.id, user.email, dto);
  }

  @Get('billing/orders/:orderId')
  @ApiBearerAuth()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Status do pedido (para acompanhar a confirmação após o checkout)',
    description: 'Faça polling até PAID/FAILED/EXPIRED. Pedidos pendentes são conferidos diretamente na API do Stripe.',
  })
  @ApiOkResponse({ type: OrderDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'ORDER_NOT_FOUND' })
  getOrder(@CurrentUser() user: AuthUser, @Param('orderId', ParseUUIDPipe) orderId: string): Promise<OrderDto> {
    return this.checkout.getOrder(user.id, orderId);
  }

  @Get('trips/:tripId/orders')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Histórico de pedidos da viagem (OWNER)' })
  @ApiOkResponse({ type: [OrderDto] })
  listTripOrders(@CurrentUser() user: AuthUser, @Param('tripId', ParseUUIDPipe) tripId: string): Promise<OrderDto[]> {
    return this.checkout.listTripOrders(user.id, tripId);
  }

  @Public()
  @SkipThrottle()
  @Post('billing/webhooks/stripe')
  @HttpCode(HttpStatus.OK)
  @ApiHeader({ name: 'Stripe-Signature', required: true })
  @ApiOperation({ summary: 'Webhook do Stripe (assinatura verificada com o corpo bruto)' })
  @ApiOkResponse({ schema: { example: { received: true, outcome: 'paid' } } })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'WEBHOOK_SIGNATURE_INVALID' })
  stripeWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string | undefined,
  ): Promise<WebhookResult> {
    return this.webhooks.handle(req.rawBody, signature);
  }
}
