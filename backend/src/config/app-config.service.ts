import { Injectable } from '@nestjs/common';
import { Env, validateEnv } from './env';

/**
 * Acesso tipado à configuração validada em `env.ts`.
 *
 * Lê o objeto já transformado pelo zod (e não `ConfigService.get`), porque o
 * ConfigService recorre ao `process.env` cru quando o valor validado é
 * `undefined` — devolvendo, por exemplo, `''` para uma chave opcional vazia.
 * O ConfigModule continua responsável por carregar o `.env` em `process.env`.
 */
@Injectable()
export class AppConfig {
  private readonly env: Env = validateEnv(process.env);

  get<K extends keyof Env>(key: K): Env[K] {
    return this.env[key];
  }

  get isProduction(): boolean {
    return this.env.NODE_ENV === 'production';
  }

  get isTest(): boolean {
    return this.env.NODE_ENV === 'test';
  }
}
