import { Test } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { createHash } from 'crypto';

// The service stores a plain SHA-256 of the refresh token, so tests build the
// stored hash the same way rather than mocking the comparison away — that
// keeps them honest about what actually has to match.
const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');
import { AuthService } from './auth.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';

jest.mock('bcrypt');
jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => {
    const store = new Map<string, string>();
    return {
      set: jest.fn((key: string, value: string) => {
        store.set(key, value);
        return Promise.resolve('OK');
      }),
      get: jest.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
      // Mirrors the real GETDEL: one command that both reads and removes.
      getdel: jest.fn((key: string) => {
        const value = store.get(key) ?? null;
        store.delete(key);
        return Promise.resolve(value);
      }),
      del: jest.fn((key: string) => {
        store.delete(key);
        return Promise.resolve(1);
      }),
      on: jest.fn(),
      quit: jest.fn().mockResolvedValue('OK'),
    };
  });
});

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    create: jest.fn(),
  },
  account: {
    findUnique: jest.fn(),
    create: jest.fn(),
  },
  refreshToken: {
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
  },
  apiToken: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
};

const mockJwt = { signAsync: jest.fn() };
const mockConfig = { get: jest.fn().mockReturnValue('secret') };

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    jest.clearAllMocks();
    (bcrypt.hash as jest.Mock).mockResolvedValue('hashed');
    mockJwt.signAsync.mockResolvedValue('token');
    mockPrisma.refreshToken.create.mockResolvedValue({});
    mockPrisma.apiToken.update.mockResolvedValue({});

    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: JwtService, useValue: mockJwt },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  describe('validateLocalUser', () => {
    it('returns null when user does not exist', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      expect(await service.validateLocalUser('a@b.com', 'pass')).toBeNull();
    });

    it('returns null for OAuth-only accounts (no password)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: '1', password: null });
      expect(await service.validateLocalUser('a@b.com', 'pass')).toBeNull();
    });

    it('returns null on password mismatch', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: '1',
        password: 'hash',
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);
      expect(await service.validateLocalUser('a@b.com', 'wrong')).toBeNull();
    });

    it('returns user on valid credentials', async () => {
      const user = { id: '1', password: 'hash', email: 'a@b.com' };
      mockPrisma.user.findUnique.mockResolvedValue(user);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      expect(await service.validateLocalUser('a@b.com', 'pass')).toBe(user);
    });
  });

  describe('login', () => {
    it('returns an access/refresh token pair for the given user', async () => {
      const result = await service.login('u-1', 'a@b.com');

      expect(result).toEqual({ accessToken: 'token', refreshToken: 'token' });
    });

    it('signs the access and refresh tokens with their own secret and expiry', async () => {
      mockConfig.get.mockImplementation(
        (key: string) =>
          ({
            JWT_SECRET: 'access-secret',
            JWT_EXPIRES_IN: '15m',
            JWT_REFRESH_SECRET: 'refresh-secret',
            JWT_REFRESH_EXPIRES_IN: '7d',
          })[key],
      );

      await service.login('u-1', 'a@b.com');

      expect(mockJwt.signAsync).toHaveBeenCalledWith(
        { sub: 'u-1', email: 'a@b.com' },
        { secret: 'access-secret', expiresIn: '15m' },
      );
      expect(mockJwt.signAsync).toHaveBeenCalledWith(
        expect.objectContaining({ sub: 'u-1', email: 'a@b.com' }),
        { secret: 'refresh-secret', expiresIn: '7d' },
      );
    });

    it('persists a hashed refresh token row scoped to the user', async () => {
      await service.login('u-1', 'a@b.com');

      expect(mockPrisma.refreshToken.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'u-1',
            // The signed token the JWT mock returns, digested whole.
            tokenHash: sha256('token'),
          }),
        }),
      );
    });

    it('stores a digest of the refresh token, never the token itself', async () => {
      await service.login('u-1', 'a@b.com');

      const { tokenHash } = (
        mockPrisma.refreshToken.create.mock.calls[0][0] as {
          data: { tokenHash: string };
        }
      ).data;
      expect(tokenHash).not.toBe('token');
      expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('register', () => {
    it('throws BadRequestException for a duplicate email', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: '1' });
      await expect(
        service.register({
          email: 'a@b.com',
          password: 'pass12345',
          name: 'A',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('hashes the password and returns token pair', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({ id: '1', email: 'a@b.com' });

      const result = await service.register({
        email: 'a@b.com',
        password: 'pass12345',
        name: 'A',
      });

      expect(bcrypt.hash).toHaveBeenCalledWith('pass12345', 10);
      expect(mockPrisma.refreshToken.create).toHaveBeenCalled();
      expect(result).toEqual({ accessToken: 'token', refreshToken: 'token' });
    });
  });

  describe('exchangeApiToken', () => {
    const configFor = (overrides: Record<string, string> = {}) =>
      mockConfig.get.mockImplementation(
        (key: string) =>
          ({
            JWT_SECRET: 'access-secret',
            JWT_EXPIRES_IN: '15m',
            ...overrides,
          })[key],
      );

    const activeToken = (overrides: Record<string, unknown> = {}) => ({
      id: 'id-1',
      userId: 'u-1',
      tokenHash: 'hash',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 10_000),
      user: { email: 'a@b.com' },
      ...overrides,
    });

    it('rejects a token missing the expected prefix', async () => {
      await expect(service.exchangeApiToken('not-a-token')).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockPrisma.apiToken.findUnique).not.toHaveBeenCalled();
    });

    it('rejects a malformed token with no id/secret separator', async () => {
      await expect(
        service.exchangeApiToken('jt_pat_no-dot-here'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects when the token id does not exist, comparing against a dummy hash to avoid a timing oracle', async () => {
      mockPrisma.apiToken.findUnique.mockResolvedValue(null);
      await expect(
        service.exchangeApiToken('jt_pat_id-1.secret'),
      ).rejects.toThrow(ForbiddenException);
      expect(bcrypt.compare).toHaveBeenCalledWith(
        'secret',
        expect.stringMatching(/^\$2b\$10\$/),
      );
    });

    it('rejects a revoked token after still comparing the secret', async () => {
      mockPrisma.apiToken.findUnique.mockResolvedValue(
        activeToken({ revokedAt: new Date() }),
      );
      await expect(
        service.exchangeApiToken('jt_pat_id-1.secret'),
      ).rejects.toThrow(ForbiddenException);
      expect(bcrypt.compare).toHaveBeenCalledWith('secret', 'hash');
    });

    it('rejects when the secret does not match the stored hash', async () => {
      mockPrisma.apiToken.findUnique.mockResolvedValue(activeToken());
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);
      await expect(
        service.exchangeApiToken('jt_pat_id-1.secret'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects an expired token after still comparing the secret', async () => {
      mockPrisma.apiToken.findUnique.mockResolvedValue(
        activeToken({ expiresAt: new Date(Date.now() - 1) }),
      );
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      await expect(
        service.exchangeApiToken('jt_pat_id-1.secret'),
      ).rejects.toThrow(ForbiddenException);
      expect(bcrypt.compare).toHaveBeenCalledWith('secret', 'hash');
    });

    it('returns a short-lived access token and touches lastUsedAt on success', async () => {
      configFor();
      mockPrisma.apiToken.findUnique.mockResolvedValue(activeToken());
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.exchangeApiToken('jt_pat_id-1.secret');

      expect(mockJwt.signAsync).toHaveBeenCalledWith(
        { sub: 'u-1', email: 'a@b.com', scope: 'pat', patId: 'id-1' },
        { secret: 'access-secret', expiresIn: '15m' },
      );
      expect(mockPrisma.apiToken.update).toHaveBeenCalledWith({
        where: { id: 'id-1' },
        data: { lastUsedAt: expect.any(Date) },
      });
      expect(result).toEqual({ accessToken: 'token', expiresIn: 900 });
    });

    it('splits id/secret on the first dot only, tolerating dots in the secret', async () => {
      mockPrisma.apiToken.findUnique.mockResolvedValue(activeToken());
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      await service.exchangeApiToken('jt_pat_id-1.sec.ret');

      expect(mockPrisma.apiToken.findUnique).toHaveBeenCalledWith({
        where: { id: 'id-1' },
        include: { user: { select: { email: true } } },
      });
      expect(bcrypt.compare).toHaveBeenCalledWith('sec.ret', 'hash');
    });
  });

  describe('refresh', () => {
    it('throws ForbiddenException when no token row exists', async () => {
      mockPrisma.refreshToken.findUnique.mockResolvedValue(null);
      await expect(service.refresh('1', 'raw', 'jti-1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws ForbiddenException on token mismatch', async () => {
      mockPrisma.refreshToken.findUnique.mockResolvedValue({
        id: 'jti-1',
        userId: '1',
        tokenHash: sha256('the-real-token'),
        expiresAt: new Date(Date.now() + 10_000),
      });
      await expect(service.refresh('1', 'wrong', 'jti-1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws ForbiddenException for an expired token row', async () => {
      mockPrisma.refreshToken.findUnique.mockResolvedValue({
        id: 'jti-1',
        userId: '1',
        tokenHash: 'oldhash',
        expiresAt: new Date(Date.now() - 1),
      });
      await expect(service.refresh('1', 'raw', 'jti-1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('marks the old row revoked, creates a new one, and returns a fresh token pair', async () => {
      mockPrisma.refreshToken.findUnique.mockResolvedValue({
        id: 'jti-1',
        userId: '1',
        tokenHash: sha256('rawtoken'),
        expiresAt: new Date(Date.now() + 10_000),
        revokedAt: null,
      });
      mockPrisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });
      // DB-fresh email, deliberately different from whatever the refresh
      // token's own (potentially stale) payload might have carried — the
      // reissued pair must reflect this, not a stale claim.
      mockPrisma.user.findUnique.mockResolvedValue({ email: 'fresh@b.com' });

      const result = await service.refresh('1', 'rawtoken', 'jti-1');

      expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { id: 'jti-1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
      expect(mockPrisma.refreshToken.create).toHaveBeenCalled();
      expect(mockPrisma.refreshToken.deleteMany).not.toHaveBeenCalled();
      expect(result).toEqual({ accessToken: 'token', refreshToken: 'token' });
      expect(mockJwt.signAsync).toHaveBeenCalledWith(
        expect.objectContaining({ sub: '1', email: 'fresh@b.com' }),
        expect.anything(),
      );
    });

    // The defect this replaced: bcrypt truncates at 72 bytes, and a JWT's
    // first 72 bytes are the header plus the start of the payload — identical
    // across every token issued to one user. Two distinct tokens sharing that
    // prefix hashed equal, so the stored hash bound nothing.
    it('rejects a different token that shares the first 72 bytes of the stored one', async () => {
      const issued = 'a'.repeat(72) + '.signature-one';
      const forged = 'a'.repeat(72) + '.signature-two';
      mockPrisma.refreshToken.findUnique.mockResolvedValue({
        id: 'jti-1',
        userId: '1',
        tokenHash: sha256(issued),
        expiresAt: new Date(Date.now() + 10_000),
        revokedAt: null,
      });

      await expect(service.refresh('1', forged, 'jti-1')).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockPrisma.refreshToken.updateMany).not.toHaveBeenCalled();
    });

    // Rows written by the old code hold a bcrypt string, which is not valid
    // hex — the compare must reject them rather than throw.
    it('rejects a legacy bcrypt-format hash without throwing', async () => {
      mockPrisma.refreshToken.findUnique.mockResolvedValue({
        id: 'jti-1',
        userId: '1',
        tokenHash: '$2b$10$abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMN',
        expiresAt: new Date(Date.now() + 10_000),
        revokedAt: null,
      });

      await expect(service.refresh('1', 'rawtoken', 'jti-1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('revokes every session for the user when a rotated (already-used) token is replayed', async () => {
      mockPrisma.refreshToken.findUnique.mockResolvedValue({
        id: 'jti-1',
        userId: '1',
        tokenHash: sha256('rawtoken'),
        expiresAt: new Date(Date.now() + 10_000),
        revokedAt: new Date(Date.now() - 5_000),
      });
      // Already revoked, so the conditional update matches nothing.
      mockPrisma.refreshToken.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.refresh('1', 'rawtoken', 'jti-1')).rejects.toThrow(
        ForbiddenException,
      );

      expect(mockPrisma.refreshToken.deleteMany).toHaveBeenCalledWith({
        where: { userId: '1' },
      });
      expect(mockPrisma.refreshToken.create).not.toHaveBeenCalled();
    });
  });

  describe('handleOAuthUser', () => {
    const args = ['google', 'gid-1', 'u@g.com', 'Test'] as const;

    it('returns tokens without DB writes when the Account already exists', async () => {
      mockPrisma.account.findUnique.mockResolvedValue({
        user: { id: 'u1', email: 'u@g.com' },
      });

      await service.handleOAuthUser(...args);

      expect(mockPrisma.user.create).not.toHaveBeenCalled();
      expect(mockPrisma.account.create).not.toHaveBeenCalled();
    });

    it('links a new Account to an existing User when email matches', async () => {
      mockPrisma.account.findUnique.mockResolvedValue(null);
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        email: 'u@g.com',
      });
      mockPrisma.account.create.mockResolvedValue({});

      await service.handleOAuthUser(...args);

      expect(mockPrisma.user.create).not.toHaveBeenCalled();
      expect(mockPrisma.account.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            provider: 'google',
            providerAccountId: 'gid-1',
            userId: 'u1',
          }),
        }),
      );
    });

    it('throws ForbiddenException when the matching User already has a password', async () => {
      mockPrisma.account.findUnique.mockResolvedValue(null);
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        email: 'u@g.com',
        password: 'hashed',
      });

      await expect(service.handleOAuthUser(...args)).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockPrisma.account.create).not.toHaveBeenCalled();
    });

    it('creates both a new User and Account when neither exists', async () => {
      mockPrisma.account.findUnique.mockResolvedValue(null);
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({ id: 'u2', email: 'u@g.com' });
      mockPrisma.account.create.mockResolvedValue({});

      await service.handleOAuthUser(...args);

      expect(mockPrisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ email: 'u@g.com', name: 'Test' }),
        }),
      );
      expect(mockPrisma.account.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            provider: 'google',
            providerAccountId: 'gid-1',
            userId: 'u2',
          }),
        }),
      );
    });
  });

  describe('storeOAuthCode / exchangeOAuthCode', () => {
    it('returns the correct tokens for a valid code', async () => {
      const tokens = { accessToken: 'at', refreshToken: 'rt' };
      const code = await service.storeOAuthCode(tokens);
      expect(await service.exchangeOAuthCode(code)).toEqual(tokens);
    });

    it('throws ForbiddenException for an unknown code', async () => {
      await expect(service.exchangeOAuthCode('no-such-code')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws ForbiddenException when a code is exchanged twice (single-use)', async () => {
      const code = await service.storeOAuthCode({
        accessToken: 'at',
        refreshToken: 'rt',
      });
      await service.exchangeOAuthCode(code);
      await expect(service.exchangeOAuthCode(code)).rejects.toThrow(
        ForbiddenException,
      );
    });

    // Single-use has to hold under concurrency, not just in sequence. A GET
    // followed by a separate DEL leaves a window where two simultaneous
    // requests both read the code before either clears it, and both receive
    // tokens. Asserted at the command level because a mocked store cannot
    // reproduce the interleaving: reading and deleting must be ONE command.
    it('claims the code with a single atomic GETDEL, never a separate GET then DEL', async () => {
      const redis = (service as unknown as { redis: Record<string, jest.Mock> })
        .redis;
      const code = await service.storeOAuthCode({
        accessToken: 'at',
        refreshToken: 'rt',
      });
      redis.get.mockClear();
      redis.del.mockClear();
      redis.getdel.mockClear();

      await service.exchangeOAuthCode(code);

      expect(redis.getdel).toHaveBeenCalledTimes(1);
      expect(redis.get).not.toHaveBeenCalled();
      expect(redis.del).not.toHaveBeenCalled();
    });
  });
});
