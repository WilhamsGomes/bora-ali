import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { configureApp, setupSwagger } from './app.setup';
import { createAppLogger } from './common/logging';
import { AppConfig } from './config/app-config.service';

async function bootstrap() {
  // rawBody: necessário para verificar a assinatura dos webhooks do Stripe.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true, bufferLogs: true });
  const config = app.get(AppConfig);
  // Logger padrão do Nest (colorido); LOG_FORMAT=json para uma linha JSON por evento.
  app.useLogger(createAppLogger({ LOG_LEVEL: config.get('LOG_LEVEL'), LOG_FORMAT: config.get('LOG_FORMAT') }));
  configureApp(app);
  setupSwagger(app);

  const port = config.get('PORT');
  await app.listen(port);
  const logger = new Logger('Bootstrap');
  logger.log(`BoraAli API ouvindo em http://localhost:${port}/api/v1`);
  logger.log(`Swagger em http://localhost:${port}/api/docs`);
}

void bootstrap();
