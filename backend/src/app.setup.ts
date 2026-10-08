import { INestApplication } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AllExceptionsFilter } from './common/errors/all-exceptions.filter';
import { RequestLoggingMiddleware } from './common/logging';
import { createValidationPipe } from './common/validation';
import { AppConfig } from './config/app-config.service';

export const API_PREFIX = 'api/v1';

/** Configuração HTTP compartilhada entre `main.ts` e os testes e2e. */
export function configureApp(app: NestExpressApplication): void {
  const config = app.get(AppConfig);

  app.set('trust proxy', config.get('TRUST_PROXY'));
  app.disable('x-powered-by');
  // Request ID (X-Request-Id) + log de cada requisição no contexto "HTTP".
  const requestLogging = new RequestLoggingMiddleware();
  app.use(requestLogging.use.bind(requestLogging));
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({
    origin: config.get('CORS_ORIGINS'),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id'],
    maxAge: 600,
  });
  app.setGlobalPrefix(API_PREFIX);
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();
}

export function setupSwagger(app: INestApplication): void {
  const doc = new DocumentBuilder()
    .setTitle('BoraAli API')
    .setDescription(
      [
        'API REST do BoraAli: roteiros de viagem com planejamento manual, colaboração, compartilhamento, ',
        'pagamento único por viagem (Stripe) e geração com IA.\n\n',
        '**Erros** seguem o formato `{ code, message, details?, requestId }`. Decida pelo `code`.\n\n',
        '**Autenticação**: `Authorization: Bearer <accessToken>`; o refresh token trafega apenas em cookie httpOnly.',
      ].join(''),
    )
    .setVersion('1.0.0')
    .addBearerAuth()
    .addCookieAuth('boraali_rt')
    .build();
  const document = SwaggerModule.createDocument(app, doc);
  SwaggerModule.setup('api/docs', app, document, { jsonDocumentUrl: 'api/docs/openapi.json' });
}
