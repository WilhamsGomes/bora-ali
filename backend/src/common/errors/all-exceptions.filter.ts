import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { withFields } from '../logging';
import { AppError, ErrorCode } from './app-error';

interface ErrorBody {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  requestId: string;
}

const HTTP_CODE_MAP: Partial<Record<number, ErrorCode>> = {
  [HttpStatus.BAD_REQUEST]: ErrorCode.VALIDATION_ERROR,
  [HttpStatus.UNAUTHORIZED]: ErrorCode.UNAUTHENTICATED,
  [HttpStatus.FORBIDDEN]: ErrorCode.FORBIDDEN,
  [HttpStatus.NOT_FOUND]: ErrorCode.NOT_FOUND,
  [HttpStatus.CONFLICT]: ErrorCode.CONFLICT,
  [HttpStatus.TOO_MANY_REQUESTS]: ErrorCode.RATE_LIMITED,
  [HttpStatus.PAYLOAD_TOO_LARGE]: ErrorCode.VALIDATION_ERROR,
};

/** Converte qualquer exceção no formato padrão `{ code, message, details, requestId }`. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();
    const requestId = String(req.id ?? '');

    const { status, body } = this.toResponse(exception, requestId);
    if (status >= 500) {
      // Mensagem e stack apenas; nunca o corpo da requisição.
      this.logger.error(
        withFields('Erro não tratado', { requestId }),
        exception instanceof Error ? exception.stack : String(exception),
      );
    }
    if (!res.headersSent) res.status(status).json(body);
  }

  private toResponse(exception: unknown, requestId: string): { status: number; body: ErrorBody } {
    if (exception instanceof AppError) {
      return {
        status: exception.status,
        body: { code: exception.code, message: exception.message, details: exception.details, requestId },
      };
    }

    if (exception instanceof ThrottlerException) {
      return {
        status: HttpStatus.TOO_MANY_REQUESTS,
        body: { code: ErrorCode.RATE_LIMITED, message: 'Muitas requisições. Tente novamente em instantes.', requestId },
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      const code = HTTP_CODE_MAP[status] ?? (status >= 500 ? ErrorCode.INTERNAL_ERROR : ErrorCode.VALIDATION_ERROR);
      if (typeof response === 'object' && response !== null && 'errors' in response) {
        // Erros do ValidationPipe (ver validation.ts)
        return {
          status,
          body: {
            code: ErrorCode.VALIDATION_ERROR,
            message: 'Dados inválidos.',
            details: { fields: (response as { errors: unknown }).errors },
            requestId,
          },
        };
      }
      const message =
        typeof response === 'string'
          ? response
          : typeof (response as { message?: unknown }).message === 'string'
            ? (response as { message: string }).message
            : exception.message;
      return { status, body: { code, message, requestId } };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        return {
          status: HttpStatus.CONFLICT,
          body: { code: ErrorCode.CONFLICT, message: 'Registro duplicado.', requestId },
        };
      }
      if (exception.code === 'P2025') {
        return { status: HttpStatus.NOT_FOUND, body: { code: ErrorCode.NOT_FOUND, message: 'Não encontrado.', requestId } };
      }
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: { code: ErrorCode.INTERNAL_ERROR, message: 'Erro interno. Tente novamente.', requestId },
    };
  }
}
