import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Env } from '../config/env.js';
import type { Role } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthUser } from '../common/decorators/current-user.decorator.js';
import type { TokensResponseDto } from './dto/login.dto.js';
import { verifyPassword } from './password.js';

export interface AccessTokenPayload {
  sub: string;
  email: string;
  role: Role;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Short-lived JWT access tokens plus opaque, rotating refresh tokens.
 *
 * A refresh token is "<id>.<secret>". Only a SHA-256 of the secret is stored, so a leaked
 * database doesn't leak usable tokens. Each refresh revokes the old token and issues a new one.
 * If a revoked token is used again, someone has a copy: we revoke every token of that user.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async login(email: string, password: string): Promise<TokensResponseDto> {
    const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    // Same answer for "no such user" and "wrong password": don't reveal which emails exist.
    if (!user || !(await verifyPassword(user.passwordHash, password))) {
      throw new UnauthorizedException('Invalid email or password');
    }
    return this.issueTokens({ id: user.id, email: user.email, role: user.role });
  }

  async refresh(refreshToken: string): Promise<TokensResponseDto> {
    const [id, secret] = refreshToken.split('.');
    if (!id || !secret || !isUuid(id)) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const stored = await this.prisma.refreshToken.findUnique({ where: { id }, include: { user: true } });
    if (!stored || !sameHash(stored.tokenHash, sha256(secret))) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (stored.revokedAt) {
      // A browser that sends two requests at once refreshes twice with the same token.
      // A reuse within a few seconds of the rotation is that, not theft: refuse it, but keep the sessions.
      const graceMs = this.config.get('REFRESH_REUSE_GRACE_SECONDS', { infer: true }) * 1000;
      if (Date.now() - stored.revokedAt.getTime() < graceMs) {
        throw new UnauthorizedException('Refresh token already used');
      }
      this.logger.warn(`Reuse of a revoked refresh token for user ${stored.userId}, revoking all sessions`);
      await this.prisma.refreshToken.updateMany({
        where: { userId: stored.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Invalid refresh token');
    }
    if (stored.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    // Revoke only if nobody revoked it in the meantime: two parallel refreshes can't both win.
    const { count } = await this.prisma.refreshToken.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (count === 0) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    return this.issueTokens({ id: stored.user.id, email: stored.user.email, role: stored.user.role });
  }

  async logout(refreshToken: string): Promise<void> {
    const [id] = refreshToken.split('.');
    if (id && isUuid(id)) {
      await this.prisma.refreshToken.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date() } });
    }
  }

  private async issueTokens(user: AuthUser): Promise<TokensResponseDto> {
    const expiresIn = this.config.get('JWT_ACCESS_TTL', { infer: true });
    const payload: AccessTokenPayload = { sub: String(user.id), email: user.email, role: user.role };
    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }),
      expiresIn: expiresIn as JwtSignOptions['expiresIn'],
    });

    const id = randomUUID();
    const secret = randomBytes(32).toString('base64url');
    const ttlDays = this.config.get('JWT_REFRESH_TTL_DAYS', { infer: true });
    await this.prisma.refreshToken.create({
      data: { id, userId: user.id, tokenHash: sha256(secret), expiresAt: new Date(Date.now() + ttlDays * DAY_MS) },
    });

    return { accessToken, refreshToken: `${id}.${secret}`, expiresIn };
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
