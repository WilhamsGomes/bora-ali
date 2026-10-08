import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BillingProduct, OrderStatus, TripPlan } from '@prisma/client';
import { IsIn, IsUUID } from 'class-validator';

const PURCHASABLE = [TripPlan.PRO, TripPlan.PRO_AI] as const;

export class CreateCheckoutDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  tripId: string;

  @ApiProperty({
    enum: PURCHASABLE,
    description: 'Plano desejado. O servidor decide produto e preço (ex.: PRO → PRO_AI vira upgrade de R$10,00).',
  })
  @IsIn(PURCHASABLE)
  plan: (typeof PURCHASABLE)[number];
}

export class OrderDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  tripId: string | null;

  @ApiProperty({ enum: BillingProduct })
  product: BillingProduct;

  @ApiProperty({ enum: TripPlan })
  targetPlan: TripPlan;

  @ApiProperty({ example: 990, description: 'Centavos' })
  amount: number;

  @ApiProperty({ example: 'BRL' })
  currency: string;

  @ApiProperty({
    enum: OrderStatus,
    description:
      'OPEN: aguardando pagamento · PROCESSING: pagamento assíncrono pendente · PAID: benefício liberado · FAILED/EXPIRED/CANCELED: sem cobrança · REFUNDED/DISPUTED: benefício revertido',
  })
  status: OrderStatus;

  @ApiProperty({ type: String, nullable: true, description: 'URL do Stripe Checkout (somente enquanto OPEN)' })
  checkoutUrl: string | null;

  @ApiProperty({ type: Date, nullable: true })
  checkoutExpiresAt: Date | null;

  @ApiProperty({ type: Date, nullable: true })
  paidAt: Date | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  failureReason: string | null;

  @ApiProperty({ type: String, enum: TripPlan, nullable: true, description: 'Plano atual da viagem' })
  tripPlan: TripPlan | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class CheckoutResponseDto {
  @ApiProperty({ type: OrderDto })
  order: OrderDto;

  @ApiProperty({ description: 'Redirecione o usuário para esta URL' })
  checkoutUrl: string;

  @ApiProperty({ description: 'true quando uma sessão aberta equivalente foi reaproveitada' })
  reused: boolean;
}
