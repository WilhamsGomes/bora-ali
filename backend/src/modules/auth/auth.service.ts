import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import { AppError, ErrorCode } from '../../common/errors/app-error';
import { generateToken, hashToken, safeEqual } from '../../common/utils/secure-token';
import { AppConfig } from '../../config/app-config.service';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import type { AuthResponseDto, LoginDto, RegisterDto } from './dto/auth.dto';

/** Parâmetros argon2id (recomendação OWASP: m=19 MiB, t=2, p=1). */
const ARGON2_OPTIONS = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } satisfies argon2.HashOptions;

/**
 * Janela em que o refresh token anterior ainda é tolerado sem derrubar a sessão
 * (duas abas renovando ao mesmo tempo). Fora dela, reutilização = token vazado → revoga.
 */
const REUSE_GRACE_MS = 15_000;

export interface ClientInfo {
  userAgent?: string;
  ipAddress?: string;
}

export interface IssuedTokens extends AuthResponseDto {
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

@Injectable()
export class AuthService {
  private dummyHash?: Promise<string>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: AppConfig,
  ) {}

  async register(dto: RegisterDto, client: ClientInfo): Promise<IssuedTokens> {
    const passwordHash = await argon2.hash(dto.password, ARGON2_OPTIONS);
    try {
      const user = await this.prisma.user.create({
        data: { email: dto.email, name: dto.name, passwordHash },
      });
      return this.startSession(user, client);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw AppError.conflict(ErrorCode.EMAIL_ALREADY_REGISTERED, 'Este e-mail já está cadastrado.');
      }
      throw err;
    }
  }

  async login(dto: LoginDto, client: ClientInfo): Promise<IssuedTokens> {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    // Sempre executa a verificação para não revelar por tempo de resposta se o e-mail existe.
    const hash = user?.passwordHash ?? (await this.getDummyHash());
    const valid = await argon2.verify(hash, dto.password).catch(() => false);
    if (!user || !valid) {
      throw AppError.unauthorized(ErrorCode.INVALID_CREDENTIALS, 'E-mail ou senha incorretos.');
    }
    return this.startSession(user, client);
  }

  /** Rotaciona o refresh token: o anterior deixa de valer imediatamente. */
  async refresh(presented: string | undefined, client: ClientInfo): Promise<IssuedTokens> {
    const invalid = () => AppError.unauthorized(ErrorCode.INVALID_REFRESH_TOKEN, 'Sessão expirada. Entre novamente.');
    const parsed = this.parseRefreshToken(presented);
    if (!parsed) throw invalid();

    const session = await this.prisma.session.findUnique({ where: { id: parsed.sessionId }, include: { user: true } });
    if (!session || session.revokedAt || session.expiresAt <= new Date()) throw invalid();

    const presentedHash = hashToken(parsed.token);
    if (!safeEqual(presentedHash, session.refreshTokenHash)) {
      if (session.previousTokenHash && safeEqual(presentedHash, session.previousTokenHash)) {
        const withinGrace = Date.now() - session.lastUsedAt.getTime() < REUSE_GRACE_MS;
        if (!withinGrace) {
          await this.prisma.session.update({
            where: { id: session.id },
            data: { revokedAt: new Date(), revokedReason: 'refresh_token_reuse' },
          });
        }
      }
      throw invalid();
    }

    const secret = generateToken();
    const newToken = `${session.id}.${secret}`;
    // Atualização condicional: só uma requisição concorrente consegue rotacionar este token.
    const rotated = await this.prisma.session.updateMany({
      where: { id: session.id, refreshTokenHash: presentedHash, revokedAt: null },
      data: {
        refreshTokenHash: hashToken(secret),
        previousTokenHash: presentedHash,
        lastUsedAt: new Date(),
        userAgent: client.userAgent?.slice(0, 300),
        ipAddress: client.ipAddress,
      },
    });
    if (rotated.count !== 1) throw invalid();

    return {
      ...(await this.issueAccessToken(session.user, session.id)),
      refreshToken: newToken,
      refreshTokenExpiresAt: session.expiresAt,
    };
  }

  async logout(sessionId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'logout' },
    });
  }

  /** Logout por cookie (sem access token válido). */
  async logoutByRefreshToken(presented: string | undefined): Promise<void> {
    const parsed = this.parseRefreshToken(presented);
    if (!parsed) return;
    const session = await this.prisma.session.findUnique({ where: { id: parsed.sessionId } });
    if (session && safeEqual(hashToken(parsed.token), session.refreshTokenHash)) {
      await this.logout(session.id);
    }
  }

  private async startSession(
    user: { id: string; email: string; name: string; createdAt: Date },
    client: ClientInfo,
  ): Promise<IssuedTokens> {
    const secret = generateToken();
    const expiresAt = new Date(Date.now() + this.config.get('REFRESH_TOKEN_TTL_DAYS') * 86_400_000);
    const session = await this.prisma.session.create({
      data: {
        userId: user.id,
        refreshTokenHash: hashToken(secret),
        expiresAt,
        userAgent: client.userAgent?.slice(0, 300),
        ipAddress: client.ipAddress,
      },
    });
    return {
      ...(await this.issueAccessToken(user, session.id)),
      refreshToken: `${session.id}.${secret}`,
      refreshTokenExpiresAt: expiresAt,
    };
  }

  private async issueAccessToken(
    user: { id: string; email: string; name: string; createdAt: Date },
    sessionId: string,
  ): Promise<AuthResponseDto> {
    const expiresIn = this.config.get('ACCESS_TOKEN_TTL_SECONDS');
    const accessToken = await this.jwt.signAsync({ sub: user.id, sid: sessionId, email: user.email }, { expiresIn });
    return { accessToken, expiresIn, user: UsersService.toDto(user) };
  }

  private parseRefreshToken(value: string | undefined): { sessionId: string; token: string } | null {
    if (!value || value.length > 200) return null;
    const [sessionId, token, extra] = value.split('.');
    if (!sessionId || !token || extra !== undefined) return null;
    if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return null;
    return { sessionId, token };
  }

  private getDummyHash(): Promise<string> {
    return (this.dummyHash ??= argon2.hash(generateToken(), ARGON2_OPTIONS));
  }
}
