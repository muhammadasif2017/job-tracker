import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, randomUUID, timingSafeEqual } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import ms, { type StringValue } from 'ms';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { RedisService } from '../../infrastructure/redis/redis.service.js';
import { runCronScan } from '../../common/cron-scan.helper.js';
import { isRedisUnavailable } from '../../infrastructure/redis/redis-errors.helper.js';
import { RegisterDto } from './dto/register.dto.js';
import { safeTimeZone } from '../../common/timezone.helper.js';
import {
  API_TOKEN_PREFIX,
  PAT_SCOPE,
  DUMMY_TOKEN_HASH,
} from '../tokens/tokens.constants.js';

/** Redis key prefix for one-time OAuth codes. */
const OAUTH_CODE_PREFIX = 'oauth_code:';
/** Lifetime of a one-time OAuth code, in seconds. */
const OAUTH_CODE_TTL_SECONDS = 60;
/**
 * The 503 message when the OAuth code store is unreachable. It says to sign
 * in again, not to retry: a `GETDEL` that timed out may still have spent the
 * code, so a retry of the same code can only get a 403, while a fresh OAuth
 * sign-in always works once Redis is back.
 */
export const OAUTH_UNAVAILABLE_MESSAGE =
  'Sign-in is temporarily unavailable. Please sign in again.';
/**
 * How long after an OAuth sign-up a returning sign-in still counts as that
 * sign-up for the timezone. The user and account rows are written before the
 * code store is reached, so a sign-up whose code could not be stored leaves
 * an account behind, and the retry finds it. Without this window that retry
 * reads as a returning user and the browser's timezone is never saved.
 */
export const OAUTH_SIGNUP_RETRY_WINDOW_MS = 15 * 60 * 1000;
/** The `User.timezone` column default: a zone nobody has confirmed yet. */
const DEFAULT_TIMEZONE = 'UTC';

/**
 * What an OAuth sign-in hands to the callback controller and parks behind
 * the one-time code. `userId` and `isNewUser` stay server-side:
 * `exchangeOAuthCode` uses them and returns only the tokens.
 */
export interface OAuthLoginResult {
  accessToken: string;
  refreshToken: string;
  userId?: string;
  isNewUser?: boolean;
}

/**
 * Refresh tokens are signed JWTs — long, high-entropy secrets, not
 * user-chosen passwords — so a fast digest is the right primitive here.
 *
 * bcrypt was not merely unnecessary, it was actively wrong: it silently
 * truncates its input at 72 bytes, and a JWT's first 72 bytes are the
 * header plus the opening of the payload. Every refresh token issued to the
 * same user therefore shared its hashed prefix and compared equal to every
 * other, so the stored hash bound nothing at all — only the signature check
 * in `JwtRefreshStrategy` stood between a forged token and the row lookup.
 * SHA-256 covers the whole token, including the jti and the signature.
 *
 * A slow KDF buys nothing on top of that: there is no low-entropy secret to
 * brute-force, and an attacker who can read this column has the database.
 */
function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Constant-time, and fails closed on anything that is not a 32-byte hex
 * digest — which includes the bcrypt-format hashes written before this
 * change, so rows issued by the old code are rejected rather than crashing
 * the compare.
 */
function refreshTokenMatches(rawToken: string, storedHash: string): boolean {
  const expected = Buffer.from(hashRefreshToken(rawToken), 'hex');
  const actual = Buffer.from(storedHash, 'hex');
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

/**
 * True when an OAuth account's user was created moments ago and still has
 * the default timezone: a sign-up whose first attempt failed after the rows
 * were written (see `OAUTH_SIGNUP_RETRY_WINDOW_MS`). The timezone check keeps
 * a zone the user already confirmed from being overwritten.
 */
function isUnfinishedSignup(user: {
  createdAt: Date;
  timezone: string;
}): boolean {
  return (
    user.timezone === DEFAULT_TIMEZONE &&
    Date.now() - user.createdAt.getTime() < OAUTH_SIGNUP_RETRY_WINDOW_MS
  );
}

/**
 * Issues and rotates the app's credentials: the 15-minute access JWT, the
 * 7-day refresh token behind an httpOnly cookie, the one-time code that
 * carries an OAuth sign-in back to the browser, and the exchange that turns
 * a personal access token into a scoped access JWT.
 *
 * The OAuth code lives in Redis through the shared `RedisService`, whose
 * commands fail fast during an outage (ADR-046). A Redis failure there
 * becomes a 503 instead of a hung sign-in.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
    private redis: RedisService,
  ) {}

  /**
   * Deletes refresh-token rows past their expiry. Both naturally expired
   * and soft-revoked rows accumulate until this runs, since rotation and
   * logout stamp `revokedAt` rather than deleting.
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async cleanupExpiredRefreshTokens() {
    await runCronScan('refresh-token-cleanup', async () => {
      const { count } = await this.prisma.refreshToken.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      });
      if (count > 0) {
        this.logger.log(`Cleaned up ${count} expired refresh token(s)`);
      }
    });
  }

  /**
   * Password sign-in check used by the local Passport strategy. Returns
   * null rather than throwing, and treats an OAuth-only account (no
   * password column) the same as a wrong password, so neither answer
   * reveals which emails are registered.
   */
  async validateLocalUser(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.password) return null;
    const matches = await bcrypt.compare(password, user.password);
    return matches ? user : null;
  }

  /** Creates a password account and signs it straight in. */
  async register(dto: RegisterDto) {
    const exists = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (exists) throw new BadRequestException('Email already in use');

    const hashed = await bcrypt.hash(dto.password, 10);
    const user = await this.prisma.user.create({
      data: {
        name: dto.name,
        email: dto.email,
        password: hashed,
        // safeTimeZone accepts any zone Intl can actually use (including the
        // modern names Intl.supportedValuesOf omits) and returns 'UTC' for
        // anything it can't, so a missing or junk value lands on the same
        // default the column would have used.
        timezone: safeTimeZone(dto.timezone),
      },
    });

    return this.issueTokens(user.id, user.email);
  }

  /**
   * Issues a token pair for a user the local strategy has already
   * authenticated.
   */
  async login(userId: string, email: string) {
    return this.issueTokens(userId, email);
  }

  /**
   * Rotates a refresh token: the presented row is revoked and a brand-new
   * pair issued, so a token is usable exactly once.
   *
   * Presenting an already-rotated token is treated as theft, not as a
   * mistake — the only way to hold a spent refresh token is to have
   * intercepted it — so every session for that user is dropped rather than
   * just this request refused.
   */
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

    if (!refreshTokenMatches(rawRefreshToken, stored.tokenHash)) {
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

  /**
   * Signs the user out everywhere by dropping all of their refresh tokens.
   * Access tokens already issued stay valid until they expire; they are
   * stateless by design and last 15 minutes.
   */
  async logout(userId: string): Promise<{ message: string }> {
    await this.prisma.refreshToken.deleteMany({ where: { userId } });
    return { message: 'Logged out successfully' };
  }

  /**
   * Runs one OAuth-code command, turning an unreachable Redis into a 503.
   * Without this an outage surfaced as an opaque 500 from the filter's
   * catch-all. Only unavailability is mapped: a permanent fault (wrong
   * password, a Redis too old for `GETDEL`) is rethrown and stays a logged
   * 500, so a misconfiguration is not disguised as a passing outage.
   */
  private async withOAuthCodeStore<T>(command: () => Promise<T>): Promise<T> {
    try {
      return await command();
    } catch (err) {
      if (!isRedisUnavailable(this.redis.client, err)) throw err;
      this.logger.error({ err }, 'OAuth code store unavailable');
      throw new ServiceUnavailableException(OAUTH_UNAVAILABLE_MESSAGE);
    }
  }

  /**
   * Parks a freshly minted token pair in Redis behind a single-use code
   * with a 60-second life. The provider redirect lands on a URL the browser
   * puts in its history, so the code travels there and the tokens do not.
   */
  async storeOAuthCode(tokens: OAuthLoginResult): Promise<string> {
    const code = randomUUID();
    try {
      await this.withOAuthCodeStore(() =>
        this.redis.client.set(
          OAUTH_CODE_PREFIX + code,
          JSON.stringify(tokens),
          'EX',
          OAUTH_CODE_TTL_SECONDS,
        ),
      );
    } catch (err) {
      // The code never reached the browser, so its refresh token never will
      // either. Revoke it now rather than leave a live 7-day credential row.
      await this.revokeUnusedRefreshToken(tokens);
      throw err;
    }
    return code;
  }

  /**
   * Revokes the refresh token of an OAuth sign-in that could not be handed
   * to the browser. Matched on user and hash, so only this token is revoked
   * and the user's other sessions are untouched. Best-effort: a failure is
   * logged, and the row still expires on its own.
   */
  private async revokeUnusedRefreshToken(tokens: OAuthLoginResult) {
    if (!tokens.userId) return;
    try {
      await this.prisma.refreshToken.updateMany({
        where: {
          userId: tokens.userId,
          tokenHash: hashRefreshToken(tokens.refreshToken),
          revokedAt: null,
        },
        data: { revokedAt: new Date() },
      });
    } catch (err) {
      this.logger.warn(
        {
          userId: tokens.userId,
          err,
        },
        'Could not revoke an undelivered OAuth refresh token',
      );
    }
  }

  /**
   * Trades the one-time code for the token pair it was standing in for. The
   * browser's timezone rides along, because this is the first request the
   * browser itself makes after an OAuth sign-in.
   */
  async exchangeOAuthCode(
    code: string,
    timezone?: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    // GETDEL (Redis 6.2+; prod runs 7.4) reads and removes the key in one
    // atomic command, so exactly one caller can ever be handed a given code.
    // A GET followed by a separate DEL let two concurrent requests both read
    // the value before either deleted it, and both walked away with a full
    // token pair minted from one single-use code — the same replay window
    // the refresh-token rotation CAS in refresh() above exists to close.
    const raw = await this.withOAuthCodeStore(() =>
      this.redis.client.getdel(OAUTH_CODE_PREFIX + code),
    );
    if (!raw) {
      throw new ForbiddenException('OAuth code expired or already used');
    }
    const { accessToken, refreshToken, userId, isNewUser } = JSON.parse(
      raw,
    ) as OAuthLoginResult;

    // The OAuth user row is created during the provider's server-side
    // redirect, where no browser timezone is available, so it starts on the
    // UTC column default. This exchange is the first request the browser
    // makes, so it carries the zone instead. Only a user this very sign-in
    // created is updated: an existing user keeps whatever zone they chose,
    // even when signing in from somewhere else. A failed write must not cost
    // the sign-in, since the code above is already spent.
    if (isNewUser && userId && timezone) {
      try {
        await this.prisma.user.update({
          where: { id: userId },
          data: { timezone: safeTimeZone(timezone) },
        });
      } catch (err) {
        this.logger.warn(
          { err, userId },
          'Could not store the signup timezone',
        );
      }
    }

    return { accessToken, refreshToken };
  }

  /**
   * Resolves a provider profile to a user, in three steps: an existing
   * linked account, then an existing user with this email, then a brand-new
   * user.
   *
   * The middle step refuses to link when that user has a password. Anyone
   * can claim an email at a provider, so silently attaching the identity
   * would hand them an account someone else registered — they are asked to
   * sign in with the password first and link from account settings.
   */
  async handleOAuthUser(
    provider: string,
    providerAccountId: string,
    email: string,
    name: string,
    avatarUrl?: string,
  ): Promise<OAuthLoginResult> {
    // 1. Find by provider account
    const account = await this.prisma.account.findUnique({
      where: { provider_providerAccountId: { provider, providerAccountId } },
      include: { user: true },
    });
    if (account) {
      const tokens = await this.issueTokens(
        account.user.id,
        account.user.email,
      );
      return {
        ...tokens,
        userId: account.user.id,
        isNewUser: isUnfinishedSignup(account.user),
      };
    }

    // 2. Find by email and link, or create new user
    let user = await this.prisma.user.findUnique({ where: { email } });
    if (user && user.password) {
      // Don't silently link an OAuth identity onto an account someone else
      // could have pre-registered with this email + a password.
      throw new ForbiddenException(
        'An account with this email already exists. Log in with your password first, then link this provider from account settings.',
      );
    }
    // Linking onto an existing password-less user is not a new user: they may
    // already have chosen a timezone.
    const isNewUser = !user;
    if (!user) {
      user = await this.prisma.user.create({
        data: { email, name, avatarUrl },
      });
    }

    await this.prisma.account.create({
      data: { provider, providerAccountId, userId: user.id },
    });

    const tokens = await this.issueTokens(user.id, user.email);
    return { ...tokens, userId: user.id, isNewUser };
  }

  /**
   * Exchanges a long-lived personal access token for a normal short-lived
   * access JWT — for clients that cannot hold the httpOnly refresh cookie,
   * currently the browser extension. Never issues a refresh token: the
   * caller re-exchanges the PAT once the access token expires.
   *
   * The bcrypt compare runs against a dummy hash when no row matches, so a
   * wrong token id takes the same time as a wrong secret and the endpoint
   * cannot be used to enumerate ids.
   */
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
    if (!token || token.revokedAt || token.expiresAt < new Date() || !valid) {
      throw invalid();
    }

    // Best-effort - a failed timestamp update shouldn't block the exchange.
    this.prisma.apiToken
      .update({ where: { id }, data: { lastUsedAt: new Date() } })
      .catch((err: Error) =>
        this.logger.warn({ err }, 'Failed to update apiToken.lastUsedAt'),
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

  /**
   * Signs an access JWT. The scope and PAT id are only present on tokens
   * minted from a personal access token; `PatScopeGuard` and `JwtStrategy`
   * read them to confine such a token to the few routes marked
   * `@PatAccessible()` and to honour a revocation immediately.
   */
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
      },
    );
  }

  /**
   * The single place a full credential pair is minted. The refresh token's
   * `jti` is also the primary key of the row storing its hash, which is
   * what lets rotation revoke exactly the token presented.
   */
  private async issueTokens(userId: string, email: string) {
    const jti = randomUUID();

    const [accessToken, refreshToken] = await Promise.all([
      this.signAccessToken(userId, email),
      this.jwt.signAsync(
        { sub: userId, email, jti },
        {
          secret: this.config.get('JWT_REFRESH_SECRET'),
          expiresIn: this.config.get('JWT_REFRESH_EXPIRES_IN'),
        },
      ),
    ]);

    const tokenHash = hashRefreshToken(refreshToken);
    const refreshExpiry =
      this.config.get<string>('JWT_REFRESH_EXPIRES_IN') ?? '7d';
    const expiresAt = new Date(Date.now() + ms(refreshExpiry as StringValue));
    await this.prisma.refreshToken.create({
      data: { id: jti, userId, tokenHash, expiresAt },
    });

    return { accessToken, refreshToken };
  }
}
