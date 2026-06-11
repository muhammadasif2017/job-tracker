import { Test } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

jest.mock('bcrypt');

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  account: {
    findUnique: jest.fn(),
    create: jest.fn(),
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
      mockPrisma.user.update.mockResolvedValue({});

      const result = await service.register({
        email: 'a@b.com',
        password: 'pass12345',
        name: 'A',
      });

      expect(bcrypt.hash).toHaveBeenCalledWith('pass12345', 10);
      expect(result).toEqual({ accessToken: 'token', refreshToken: 'token' });
    });
  });

  describe('refresh', () => {
    it('throws ForbiddenException when no refresh token is stored', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ refreshToken: null });
      await expect(service.refresh('1', 'a@b.com', 'raw')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws ForbiddenException on token mismatch', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ refreshToken: 'oldhash' });
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);
      await expect(service.refresh('1', 'a@b.com', 'wrong')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('issues new token pair and rotates the stored hash', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ refreshToken: 'oldhash' });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      mockPrisma.user.update.mockResolvedValue({});

      const result = await service.refresh('1', 'a@b.com', 'rawtoken');

      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: '1' },
          data: { refreshToken: 'hashed' },
        }),
      );
      expect(result).toEqual({ accessToken: 'token', refreshToken: 'token' });
    });
  });

  describe('handleOAuthUser', () => {
    const args = ['google', 'gid-1', 'u@g.com', 'Test'] as const;

    it('returns tokens without DB writes when the Account already exists', async () => {
      mockPrisma.account.findUnique.mockResolvedValue({
        user: { id: 'u1', email: 'u@g.com' },
      });
      mockPrisma.user.update.mockResolvedValue({});

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
      mockPrisma.user.update.mockResolvedValue({});

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

    it('creates both a new User and Account when neither exists', async () => {
      mockPrisma.account.findUnique.mockResolvedValue(null);
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({ id: 'u2', email: 'u@g.com' });
      mockPrisma.account.create.mockResolvedValue({});
      mockPrisma.user.update.mockResolvedValue({});

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
    it('returns the correct tokens for a valid code', () => {
      const tokens = { accessToken: 'at', refreshToken: 'rt' };
      const code = service.storeOAuthCode(tokens);
      expect(service.exchangeOAuthCode(code)).toEqual(tokens);
    });

    it('throws ForbiddenException for an unknown code', () => {
      expect(() => service.exchangeOAuthCode('no-such-code')).toThrow(
        ForbiddenException,
      );
    });

    it('throws ForbiddenException for an expired code', () => {
      const code = service.storeOAuthCode({
        accessToken: 'at',
        refreshToken: 'rt',
      });
      // Force the entry to appear expired
      (service as any).oauthCodes.get(code).expiresAt = Date.now() - 1;
      expect(() => service.exchangeOAuthCode(code)).toThrow(ForbiddenException);
    });
  });
});
