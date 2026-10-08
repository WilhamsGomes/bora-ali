import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppConfigModule } from './config/config.module';
import { AiModule } from './modules/ai/ai.module';
import { AuthModule } from './modules/auth/auth.module';
import { BillingModule } from './modules/billing/billing.module';
import { JwtAuthGuard } from './modules/auth/jwt-auth.guard';
import { EntitlementsModule } from './modules/entitlements/entitlements.module';
import { HealthController } from './modules/health/health.controller';
import { InvitationsModule } from './modules/invitations/invitations.module';
import { LocationsModule } from './modules/locations/locations.module';
import { ItineraryModule } from './modules/itinerary/itinerary.module';
import { MailModule } from './modules/mail/mail.module';
import { SharingModule } from './modules/sharing/sharing.module';
import { TripsModule } from './modules/trips/trips.module';
import { UsersModule } from './modules/users/users.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    AppConfigModule,
    // Limite padrão por IP; rotas sensíveis definem limites próprios com @Throttle.
    // Armazenamento em memória: com várias instâncias, troque por um storage compartilhado (ex.: Redis).
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 120 }]),
    // Jobs agendados (reconciliação) só executam quando RUN_WORKERS=true.
    ScheduleModule.forRoot(),
    PrismaModule,
    MailModule,
    AuthModule,
    UsersModule,
    EntitlementsModule,
    TripsModule,
    ItineraryModule,
    LocationsModule,
    InvitationsModule,
    SharingModule,
    BillingModule,
    AiModule,
  ],
  controllers: [HealthController],
  providers: [
    // Ordem importa: rate limiting antes da autenticação.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useExisting: JwtAuthGuard },
  ],
})
export class AppModule {}
