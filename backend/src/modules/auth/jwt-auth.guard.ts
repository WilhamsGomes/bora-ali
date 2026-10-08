import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { AppError, ErrorCode } from '../../common/errors/app-error';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser, IS_PUBLIC_KEY } from './auth.decorators';

interface AccessTokenPayload {
  sub: string;
  sid: string;
  email: string;
}

/**
 * Guard global: exige `Authorization: Bearer <access token>` e confere que a
 * sessão não foi revogada (logout tem efeito imediato, não só no vencimento do token).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw AppError.unauthorized(ErrorCode.UNAUTHENTICATED, 'Autenticação necessária.');
    }

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(header.slice(7));
    } catch {
      throw AppError.unauthorized(ErrorCode.UNAUTHENTICATED, 'Token de acesso inválido ou expirado.');
    }

    const session = await this.prisma.session.findUnique({
      where: { id: payload.sid },
      select: { userId: true, revokedAt: true, expiresAt: true },
    });
    if (!session || session.userId !== payload.sub || session.revokedAt || session.expiresAt <= new Date()) {
      throw AppError.unauthorized(ErrorCode.UNAUTHENTICATED, 'Sessão encerrada.');
    }

    req.user = { id: payload.sub, email: payload.email, sessionId: payload.sid };
    return true;
  }
}
