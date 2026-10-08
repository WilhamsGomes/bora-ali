import { Global, Module } from '@nestjs/common';
import { AiCostService } from './ai-cost.service';
import { AiQuotaService } from './ai-quota.service';
import { EntitlementsController } from './entitlements.controller';
import { EntitlementsService } from './entitlements.service';
import { TripAccessService } from './trip-access.service';

@Global()
@Module({
  controllers: [EntitlementsController],
  providers: [TripAccessService, AiQuotaService, AiCostService, EntitlementsService],
  exports: [TripAccessService, AiQuotaService, AiCostService, EntitlementsService],
})
export class EntitlementsModule {}
