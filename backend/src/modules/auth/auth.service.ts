import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  OnModuleDestroy,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import ms, { type StringValue } from 'ms';
import Redis from 'ioredis';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service.js';
import { RegisterDto } from './dto/register.dto.js';
import {
  API_TOKEN_PREFIX,
  PAT_SCOPE,
  DUMMY_TOKEN_HASH,
} from '../tokens/tokens.constants.js';

const OAUTH_CODE_PREFIX = 'oauth_code:';
const OAUTH_CODE_TTL_SECONDS = 60;

@Injectable()
export class AuthService implements OnModuleDestroy {
  private readonly redis: Redis;
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
  ) {
    this.redis = new Redis(
      this.config.get<string>('REDIS_URL') ?? 'redis://localhost:6379',
      { maxRetriesPerRequest: null },
    );
    this.redis.on('error', (err) =>
      this.logger.error('Redis connection error', err),
    );
  }

  async onModuleDestroy() {
    await this.redis.quit();
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async cleanupExpiredRefreshTokens() {
    const { count } = await this.prisma.refreshToken.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    if (count > 0) {
      this.logger.log(`Cleaned up ${count} expired refresh token(s)`);
    }
  }

  async validateLocalUser(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.password) return null;
    const matches = await bcrypt.compare(password, user.password);
    return matches ? user : null;
  }

  async register(dto: RegisterDto) {
    const exists = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (exists) throw new BadRequestException('Email already in use');

    const hashed = await bcrypt.hash(dto.password, 10);
    const user = await this.prisma.user.create({
      data: { name: dto.name, email: dto.email, password: hashed },
    });

    return this.issueTokens(user.id, user.email);
  }

  async login(userId: string, email: string) {
    return this.issueTokens(userId, email);
  }

  async refresh(userId: string, rawRefreshToken: string, jti: string) {
    const stored = await this.prisma.refreshToken.findUnique({
      where: { id: jti },
    });
    if (!stored || stored.userId !== userId || stored.expiresAt < new Date()) {
      if (stored) {
        await this.prisma.refreshToken.deleteMany({ where: { id: jti } });
      }
      throw new ForbiddenException('Refresh token invalid or expired');
    }

    const valid = await bcrypt.compare(rawRefreshToken, stored.tokenHash);
    if (!valid) {
      throw new ForbiddenException('Refresh token invalid or expired');
    }

    // Atomic claim: only succeeds if this row is still unrevoked. This closes
    // the race where two concurrent requests both read revokedAt=null before
    // either writes - only one can match revokedAt: null here, since the
    // conditional update is serialized by the database's row lock.
    const { count } = await this.prisma.refreshToken.updateMany({
      where: { id: jti, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (count === 0) {
      // Lost the race, or this token was already rotated - somebody is
      // replaying a stale refresh token, which only happens if it leaked.
      // Kill every session for this user rather than just rejecting the
      // one request.
      await this.prisma.refreshToken.deleteMany({ where: { userId } });
      throw new ForbiddenException('Refresh token invalid or expired');
    }

    // Look up the current email rather than trusting the refresh token's
    // payload — that payload is only re-signed from itself on each rotation,
    // so a stale email would otherwise propagate indefinitely across
    // refreshes instead of self-correcting on the user's next login.
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    if (!user) {
      throw new ForbiddenException('Refresh token invalid or expired');
    }
    return this.issueTokens(userId, user.email);
  }

  async logout(userId: string): Promise<{ message: string }> {
    await this.prisma.refreshToken.deleteMany({ where: { userId } });
    return { message: 'Logged out successfully' };
  }

  async storeOAuthCode(tokens: {
    accessToken: string;
    refreshToken: string;
  }): Promise<string> {
    const code = randomUUID();
    await this.redis.set(
      OAUTH_CODE_PREFIX + code,
      JSON.stringify(tokens),
      'EX',
      OAUTH_CODE_TTL_SECONDS,
    );
    return code;
  }

  async exchangeOAuthCode(
    code: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const key = OAUTH_CODE_PREFIX + code;
    const raw = await this.redis.get(key);
    if (!raw) {
      throw new ForbiddenException('OAuth code expired or already used');
    }
    await this.redis.del(key);
    return JSON.parse(raw) as { accessToken: string; refreshToken: string };
  }

  async handleOAuthUser(
    provider: string,
    providerAccountId: string,
    email: string,
    name: string,
    avatarUrl?: string,
  ) {
    // 1. Find by provider account
    const account = await this.prisma.account.findUnique({
      where: { provider_providerAccountId: { provider, providerAccountId } },
      include: { user: true },
    });
    if (account) return this.issueTokens(account.user.id, account.user.email);

    // 2. Find by email and link, or create new user
    let user = await this.prisma.user.findUnique({ where: { email } });
    if (user && user.password) {
      // Don't silently link an OAuth identity onto an account someone else
      // could have pre-registered with this email + a password.
      throw new ForbiddenException(
        'An account with this email already exists. Log in with your password first, then link this provider from account settings.',
      );
    }
    if (!user) {
      user = await this.prisma.user.create({
        data: { email, name, avatarUrl },
      });
    }

    await this.prisma.account.create({
      data: { provider, providerAccountId, userId: user.id },
    });

    return this.issueTokens(user.id, user.email);
  }

  // Exchanges a long-lived personal access token (see TokensModule) for a
  // normal short-lived access JWT - used by clients that can't hold the
  // httpOnly refresh-token cookie (e.g. the browser extension). Never issues
  // a refresh token: the caller re-exchanges the PAT itself once the access
  // token expires.
  async exchangeApiToken(
    rawToken: string,
  ): Promise<{ accessToken: string; expiresIn: number }> {
    const invalid = () => new ForbiddenException('Invalid access token');
    if (!rawToken.startsWith(API_TOKEN_PREFIX)) throw invalid();

    const withoutPrefix = rawToken.slice(API_TOKEN_PREFIX.length);
    const dotIndex = withoutPrefix.indexOf('.');
    if (dotIndex === -1) throw invalid();

    const id = withoutPrefix.slice(0, dotIndex);
    const secret = withoutPrefix.slice(dotIndex + 1);

    const token = await this.prisma.apiToken.findUnique({
      where: { id },
      include: { user: { select: { email: true } } },
    });

    const valid = await bcrypt.compare(
      secret,
      token?.tokenHash ?? DUMMY_TOKEN_HASH,
    );
    if (
      !token ||
      token.revokedAt ||
      token.expiresAt < new Date() ||
      !valid
    ) {
      throw invalid();
    }

    // Best-effort - a failed timestamp update shouldn't block the exchange.
    this.prisma.apiToken
      .update({ where: { id }, data: { lastUsedAt: new Date() } })
      .catch((err: Error) =>
        this.logger.warn(`Failed to update apiToken.lastUsedAt: ${err.message}`),
      );

    const accessToken = await this.signAccessToken(
      token.userId,
      token.user.email,
      PAT_SCOPE,
      token.id,
    );
    const expiresIn = Math.floor(
      ms(this.config.get<string>('JWT_EXPIRES_IN') as StringValue) / 1000,
    );
    return { accessToken, expiresIn };
  }

  private async signAccessToken(
    userId: string,
    email: string,
    scope?: string,
    patId?: string,
  ) {
    return this.jwt.signAsync(
      scope ? { sub: userId, email, scope, patId } : { sub: userId, email },
      {
        secret: this.config.get('JWT_SECRET'),
        expiresIn: this.config.get('JWT_EXPIRES_IN'),
        algorithm: 'HS256',
      },
    );
  }

  private async issueTokens(userId: string, email: string) {
    const jti = randomUUID();

    const [accessToken, refreshToken] = await Promise.all([
      this.signAccessToken(userId, email),
      this.jwt.signAsync(
        { sub: userId, email, jti },
        {
          secret: this.config.get('JWT_REFRESH_SECRET'),
          expiresIn: this.config.get('JWT_REFRESH_EXPIRES_IN'),
          algorithm: 'HS256',
        },
      ),
    ]);

    const tokenHash = await bcrypt.hash(refreshToken, 10);
    const refreshExpiry =
      this.config.get<string>('JWT_REFRESH_EXPIRES_IN') ?? '7d';
    const expiresAt = new Date(Date.now() + ms(refreshExpiry as StringValue));
    await this.prisma.refreshToken.create({
      data: { id: jti, userId, tokenHash, expiresAt },
    });

    return { accessToken, refreshToken };
  }
}
