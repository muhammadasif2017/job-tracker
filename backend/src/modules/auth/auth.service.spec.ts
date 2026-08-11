import { Test } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
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
            tokenHash: 'hashed',
          }),
        }),
      );
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

    it('returns a short-lived access token and touches lastUsedAt on success', async () => {
      configFor();
      mockPrisma.apiToken.findUnique.mockResolvedValue(activeToken());
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.exchangeApiToken('jt_pat_id-1.secret');

      expect(mockJwt.signAsync).toHaveBeenCalledWith(
        { sub: 'u-1', email: 'a@b.com', scope: 'pat' },
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
        tokenHash: 'oldhash',
        expiresAt: new Date(Date.now() + 10_000),
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);
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
        tokenHash: 'oldhash',
        expiresAt: new Date(Date.now() + 10_000),
        revokedAt: null,
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
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

    it('revokes every session for the user when a rotated (already-used) token is replayed', async () => {
      mockPrisma.refreshToken.findUnique.mockResolvedValue({
        id: 'jti-1',
        userId: '1',
        tokenHash: 'oldhash',
        expiresAt: new Date(Date.now() + 10_000),
        revokedAt: new Date(Date.now() - 5_000),
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
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
  });
});
