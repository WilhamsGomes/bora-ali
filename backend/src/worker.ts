import './worker-env';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { createAppLogger } from './common/logging';
import { AppConfig } from './config/app-config.service';
import { WorkerModule } from './worker.module';

/**
 * Processo dedicado a trabalhos em segundo plano: fila de IA e reconciliação de
 * pagamentos. Não abre porta HTTP. Força RUN_WORKERS=true (ver worker-env.ts).
 */
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
  const config = app.get(AppConfig);
  app.useLogger(createAppLogger({ LOG_LEVEL: config.get('LOG_LEVEL'), LOG_FORMAT: config.get('LOG_FORMAT') }));
  app.enableShutdownHooks();
  new Logger('Bootstrap').log('BoraAli worker iniciado');
}

void bootstrap();
