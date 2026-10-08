import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AppConfig } from '../../config/app-config.service';
import { LocationsService } from './locations.service';

/** Apaga diariamente as buscas vencidas do cache persistente. Roda no worker (RUN_WORKERS=true). */
@Injectable()
export class PlaceCacheCleanupService {
  private readonly logger = new Logger(PlaceCacheCleanupService.name);

  constructor(
    private readonly locations: LocationsService,
    private readonly config: AppConfig,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_4AM, { name: 'place-search-cache-cleanup' })
  async scheduled(): Promise<void> {
    if (!this.config.get('RUN_WORKERS')) return;
    try {
      const removed = await this.locations.purgeExpired();
      if (removed) this.logger.log(`Cache de buscas: ${removed} entrada(s) vencida(s) removida(s)`);
    } catch (e) {
      this.logger.warn(`Falha ao limpar o cache de buscas: ${(e as Error).message}`);
    }
  }
}
