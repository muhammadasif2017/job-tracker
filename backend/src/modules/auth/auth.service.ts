import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import ms, { type StringValue } from 'ms';
import Redis from 'ioredis';
import { PrismaService } from '../../prisma/prisma.service.js';
import { RegisterDto } from './dto/register.dto.js';

const OAUTH_CODE_PREFIX = 'oauth_code:';
const OAUTH_CODE_TTL_SECONDS = 60;

@Injectable()
export class AuthService {
  private readonly redis: Redis;

  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
  ) {
    this.redis = new Redis(
      this.config.get<string>('REDIS_URL') ?? 'redis://localhost:6379',
      { maxRetriesPerRequest: null },
    );
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

  async refresh(
    userId: string,
    email: string,
    rawRefreshToken: string,
    jti: string,
  ) {
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
    await this.prisma.refreshToken.delete({ where: { id: jti } });
    return this.issueTokens(userId, email);
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

  private async issueTokens(userId: string, email: string) {
    const jti = randomUUID();
    const payload = { sub: userId, email };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(payload, {
        secret: this.config.get('JWT_SECRET'),
        expiresIn: this.config.get('JWT_EXPIRES_IN'),
      }),
      this.jwt.signAsync(
        { ...payload, jti },
        {
          secret: this.config.get('JWT_REFRESH_SECRET'),
          expiresIn: this.config.get('JWT_REFRESH_EXPIRES_IN'),
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
