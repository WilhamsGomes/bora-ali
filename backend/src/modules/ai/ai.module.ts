import { Module } from '@nestjs/common';
import { AppConfig } from '../../config/app-config.service';
import { AiJobsService } from './ai-jobs.service';
import { AiProvider } from './ai-provider';
import { AiWorkerService } from './ai-worker.service';
import { AiController } from './ai.controller';
import { AnthropicProvider } from './anthropic.provider';
import { MockAiProvider } from './mock.provider';

@Module({
  controllers: [AiController],
  providers: [
    AiJobsService,
    AiWorkerService,
    {
      provide: AiProvider,
      inject: [AppConfig],
      // env.ts recusa AI_PROVIDER=mock em produção; aqui é só a seleção.
      useFactory: (config: AppConfig): AiProvider =>
        config.get('AI_PROVIDER') === 'mock' && !config.isProduction ? new MockAiProvider() : new AnthropicProvider(config),
    },
  ],
  exports: [AiWorkerService],
})
export class AiModule {}
