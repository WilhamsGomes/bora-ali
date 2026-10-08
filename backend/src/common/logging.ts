import { randomUUID } from 'node:crypto';
import { ConsoleLogger, Injectable, Logger, LogLevel, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import type { Env } from '../config/env';

declare module 'http' {
  interface IncomingMessage {
    /** ID da requisição (header X-Request-Id recebido ou gerado). */
    id?: string;
  }
}

const REQUEST_ID_RE = /^[A-Za-z0-9._-]{8,128}$/;

/** Níveis do Nest a partir de LOG_LEVEL (o nível escolhido e os mais graves). */
const LEVEL_ORDER: LogLevel[] = ['verbose', 'debug', 'log', 'warn', 'error', 'fatal'];

export function logLevelsFor(level: Env['LOG_LEVEL']): LogLevel[] {
  if (level === 'silent') return [];
  return LEVEL_ORDER.slice(LEVEL_ORDER.indexOf(level));
}

/**
 * Logger padrão do Nest (`[Nest] PID - data   LOG [Contexto] mensagem`, colorido).
 * LOG_FORMAT=json troca para uma linha JSON por evento (útil em agregadores de log).
 */
export function createAppLogger(env: Pick<Env, 'LOG_LEVEL' | 'LOG_FORMAT'>): ConsoleLogger {
  const json = env.LOG_FORMAT === 'json';
  return new ConsoleLogger({ logLevels: logLevelsFor(env.LOG_LEVEL), json, colors: !json });
}

/** "mensagem (chave=valor, ...)" — campos estruturados no formato de texto do Nest. */
export function withFields(message: string, fields: Record<string, unknown>): string {
  const parts = Object.entries(fields)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${v !== null && typeof v === 'object' ? JSON.stringify(v) : String(v)}`);
  return parts.length ? `${message} (${parts.join(', ')})` : message;
}

/** Esconde tokens que aparecem em caminhos de URL (link público) e em query strings. */
export function sanitizeUrl(url: string | undefined): string | undefined {
  if (!url) return url;
  return url
    .replace(/(\/public\/trips\/)[^/?#]+/, '$1[REDACTED]')
    .replace(/([?&](token|session_id|code)=)[^&#]*/gi, '$1[REDACTED]');
}

/**
 * Atribui o ID da requisição (X-Request-Id recebido, se válido, ou um UUID),
 * devolve-o no header e registra cada requisição concluída no contexto "HTTP".
 * Nunca registra corpo, headers ou tokens.
 */
@Injectable()
export class RequestLoggingMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(req: Request, res: Response, next: NextFunction) {
    const incoming = req.headers['x-request-id'];
    req.id = typeof incoming === 'string' && REQUEST_ID_RE.test(incoming) ? incoming : randomUUID();
    res.setHeader('X-Request-Id', req.id);

    const url = req.originalUrl ?? req.url;
    if (url.startsWith('/api/v1/health')) return next();

    const started = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      const line = `${req.method} ${sanitizeUrl(url)} ${res.statusCode} - ${ms.toFixed(0)}ms (requestId=${req.id})`;
      if (res.statusCode >= 500) this.logger.error(line);
      else this.logger.log(line);
    });
    next();
  }
}
