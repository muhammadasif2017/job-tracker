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
    delete: jest.fn(),
    deleteMany: jest.fn(),
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

  describe('refresh', () => {
    it('throws ForbiddenException when no token row exists', async () => {
      mockPrisma.refreshToken.findUnique.mockResolvedValue(null);
      await expect(
        service.refresh('1', 'a@b.com', 'raw', 'jti-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException on token mismatch', async () => {
      mockPrisma.refreshToken.findUnique.mockResolvedValue({
        id: 'jti-1',
        userId: '1',
        tokenHash: 'oldhash',
        expiresAt: new Date(Date.now() + 10_000),
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);
      await expect(
        service.refresh('1', 'a@b.com', 'wrong', 'jti-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException for an expired token row', async () => {
      mockPrisma.refreshToken.findUnique.mockResolvedValue({
        id: 'jti-1',
        userId: '1',
        tokenHash: 'oldhash',
        expiresAt: new Date(Date.now() - 1),
      });
      await expect(
        service.refresh('1', 'a@b.com', 'raw', 'jti-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('deletes the old row, creates a new one, and returns a fresh token pair', async () => {
      mockPrisma.refreshToken.findUnique.mockResolvedValue({
        id: 'jti-1',
        userId: '1',
        tokenHash: 'oldhash',
        expiresAt: new Date(Date.now() + 10_000),
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      mockPrisma.refreshToken.delete.mockResolvedValue({});

      const result = await service.refresh('1', 'a@b.com', 'rawtoken', 'jti-1');

      expect(mockPrisma.refreshToken.delete).toHaveBeenCalledWith({
        where: { id: 'jti-1' },
      });
      expect(mockPrisma.refreshToken.create).toHaveBeenCalled();
      expect(result).toEqual({ accessToken: 'token', refreshToken: 'token' });
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
