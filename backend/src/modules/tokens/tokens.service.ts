import { randomBytes, randomUUID } from 'crypto';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CreateTokenDto } from './dto/create-token.dto.js';
import { CreatedTokenDto } from './dto/created-token.dto.js';
import { TokenResponseDto } from './dto/token-response.dto.js';
import {
  API_TOKEN_PREFIX,
  MAX_ACTIVE_TOKENS_PER_USER,
  PAT_EXPIRY_DAYS,
} from './tokens.constants.js';

@Injectable()
export class TokensService {
  private readonly logger = new Logger(TokensService.name);

  constructor(private prisma: PrismaService) {}

  async create(userId: string, dto: CreateTokenDto): Promise<CreatedTokenDto> {
    // Computed before the transaction: bcrypt.hash is CPU-bound (~50-100ms+
    // at cost 10) and doesn't touch any state the advisory lock protects.
    // Doing it inside the transaction would hold both the lock and a DB
    // connection for that whole duration - under concurrent load (see the
    // e2e concurrency test below) that's enough to exhaust Prisma's
    // connection pool and surface as an unrelated 500 (P2024, pool_timeout).
    const id = randomUUID();
    const secret = randomBytes(32).toString('base64url');
    const tokenHash = await bcrypt.hash(secret, 10);
    const expiresAt = new Date(
      Date.now() + PAT_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
    );

    const token = await this.prisma.$transaction(async (tx) => {
      // Serializes concurrent create() calls for the same user so two
      // simultaneous requests can't both pass the count check before either
      // inserts - pg_advisory_xact_lock is released automatically when the
      // transaction ends. Now that the hash above is precomputed, this
      // critical section is just lock + count + insert - fast, DB-only.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;

      const active = await tx.apiToken.count({
        where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      });
      if (active >= MAX_ACTIVE_TOKENS_PER_USER) {
        throw new BadRequestException(
          `Token limit reached (${MAX_ACTIVE_TOKENS_PER_USER}) — revoke an existing token first`,
        );
      }

      return tx.apiToken.create({
        data: { id, userId, name: dto.name, tokenHash, expiresAt },
      });
    });

    return {
      id: token.id,
      name: token.name,
      createdAt: token.createdAt,
      lastUsedAt: token.lastUsedAt,
      expiresAt: token.expiresAt,
      token: `${API_TOKEN_PREFIX}${id}.${secret}`,
    };
  }

  async findAll(userId: string): Promise<TokenResponseDto[]> {
    const tokens = await this.prisma.apiToken.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    return tokens.map(({ id, name, createdAt, lastUsedAt, expiresAt }) => ({
      id,
      name,
      createdAt,
      lastUsedAt,
      expiresAt,
    }));
  }

  async revoke(userId: string, tokenId: string): Promise<{ message: string }> {
    const { count } = await this.prisma.apiToken.updateMany({
      where: { id: tokenId, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (count === 0) throw new NotFoundException('Token not found');
    return { message: 'Token revoked' };
  }

  // Mirrors AuthService.cleanupExpiredRefreshTokens: rows past expiresAt are
  // deleted regardless of whether they were revoked early or ran out their
  // full PAT_EXPIRY_DAYS lifetime, so a revoke doesn't leave a row behind
  // forever - it just gets swept on its originally-scheduled expiry.
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async cleanupExpiredApiTokens() {
    const { count } = await this.prisma.apiToken.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    if (count > 0) {
      this.logger.log(`Cleaned up ${count} expired personal access token(s)`);
    }
  }
}
