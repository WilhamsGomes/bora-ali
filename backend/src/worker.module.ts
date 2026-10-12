import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AppConfigModule } from './config/config.module';
import { AiModule } from './modules/ai/ai.module';
import { EntitlementsModule } from './modules/entitlements/entitlements.module';
import { LocationsModule } from './modules/locations/locations.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    AppConfigModule,
    ScheduleModule.forRoot(),
    PrismaModule,
    EntitlementsModule,
    AiModule,
    // Limpeza diária do cache persistente de buscas de lugares
    LocationsModule,
  ],
})
export class WorkerModule {}
