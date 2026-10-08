import { Controller, Delete, Get, HttpCode, HttpStatus, NotFoundException } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { AppConfig } from '../../config/app-config.service';
import { Public } from '../auth/auth.decorators';
import { DevOutboxMailSender, MailSender } from './mail.service';

/** Somente development/test: inspeciona e-mails "enviados" pelo adaptador de desenvolvimento. */
@ApiExcludeController()
@Public()
@Controller('dev/outbox')
export class DevOutboxController {
  constructor(
    private readonly mail: MailSender,
    private readonly config: AppConfig,
  ) {}

  @Get()
  list() {
    return this.outbox().list();
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  clear() {
    this.outbox().clear();
  }

  private outbox(): DevOutboxMailSender {
    if (this.config.isProduction || !(this.mail instanceof DevOutboxMailSender)) throw new NotFoundException();
    return this.mail;
  }
}
