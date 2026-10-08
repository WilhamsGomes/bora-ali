import { Global, Logger, Module } from '@nestjs/common';
import { AppConfig } from '../../config/app-config.service';
import { DevOutboxController } from './dev-outbox.controller';
import { DevOutboxMailSender, MailSender, UnconfiguredMailSender } from './mail.service';
import { ResendMailSender } from './resend.mail-sender';

/**
 * Escolhe o adaptador de e-mail:
 * - `resend`: exige RESEND_API_KEY e EMAIL_FROM; sem eles, nada é enviado
 *   (convites respondem EMAIL_DELIVERY_UNAVAILABLE).
 * - `dev`: caixa de saída em memória — nunca em produção.
 * - `none`: sem envio.
 */
export function createMailSender(config: AppConfig): MailSender {
  const logger = new Logger('MailModule');
  const provider = config.get('EMAIL_PROVIDER');
  if (provider === 'dev' && !config.isProduction) return new DevOutboxMailSender();
  if (provider === 'resend') {
    const apiKey = config.get('RESEND_API_KEY');
    const from = config.get('EMAIL_FROM');
    if (apiKey && from) return ResendMailSender.fromApiKey(apiKey, { from });
    logger.warn('EMAIL_PROVIDER=resend sem RESEND_API_KEY/EMAIL_FROM: envio de e-mails indisponível');
  }
  return new UnconfiguredMailSender();
}

@Global()
@Module({
  controllers: [DevOutboxController],
  providers: [{ provide: MailSender, inject: [AppConfig], useFactory: createMailSender }],
  exports: [MailSender],
})
export class MailModule {}
